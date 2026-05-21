package chrome

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"arkloop/services/activity-record/internal/store"
	_ "modernc.org/sqlite"
)

const chromeEpochOffsetMicros = 11644473600 * 1000 * 1000

type Source struct {
	profiles []profile
}

type profile struct {
	Name string
	Path string
}

type cursor struct {
	Profiles map[string]profileCursor `json:"profiles"`
}

type profileCursor struct {
	MaxVisitTime    int64 `json:"max_visit_time"`
	MaxDownloadTime int64 `json:"max_download_time"`
}

func NewDefault() (*Source, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	candidates := []profile{
		{Name: "chrome", Path: filepath.Join(home, "Library", "Application Support", "Google", "Chrome", "Default", "History")},
		{Name: "chrome-canary", Path: filepath.Join(home, "Library", "Application Support", "Google", "Chrome Canary", "Default", "History")},
	}
	profiles := make([]profile, 0, len(candidates))
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate.Path); err == nil {
			profiles = append(profiles, candidate)
		}
	}
	return &Source{profiles: profiles}, nil
}

func (s *Source) Name() string {
	return "chrome"
}

func (s *Source) Sync(ctx context.Context, db *store.Store) (int, error) {
	var cur cursor
	if err := db.Cursor(ctx, s.Name(), &cur); err != nil {
		return 0, err
	}
	if cur.Profiles == nil {
		cur.Profiles = map[string]profileCursor{}
	}
	events := make([]store.Event, 0)
	for _, profile := range s.profiles {
		select {
		case <-ctx.Done():
			return 0, ctx.Err()
		default:
		}
		profileCur := cur.Profiles[profile.Name]
		nextCur, profileEvents, err := syncProfile(ctx, profile, profileCur)
		if err != nil {
			_ = db.SaveCursor(ctx, s.Name(), cur, err)
			return 0, err
		}
		cur.Profiles[profile.Name] = nextCur
		events = append(events, profileEvents...)
	}
	inserted, err := db.UpsertEvents(ctx, events)
	if err != nil {
		_ = db.SaveCursor(ctx, s.Name(), cur, err)
		return 0, err
	}
	if err := db.SaveCursor(ctx, s.Name(), cur, nil); err != nil {
		return 0, err
	}
	return inserted, nil
}

func syncProfile(ctx context.Context, profile profile, cur profileCursor) (profileCursor, []store.Event, error) {
	tmp, err := copyHistory(profile.Path)
	if err != nil {
		return cur, nil, err
	}
	defer os.Remove(tmp)

	db, err := sql.Open("sqlite", "file:"+tmp+"?mode=ro&immutable=1")
	if err != nil {
		return cur, nil, err
	}
	defer db.Close()

	events := make([]store.Event, 0)
	next := cur

	visitRows, err := db.QueryContext(ctx, `
SELECT v.id, v.visit_time, v.visit_duration, u.url, u.title, COALESCE(ca.total_foreground_duration, 0)
  FROM visits v
  JOIN urls u ON v.url = u.id
  LEFT JOIN context_annotations ca ON ca.visit_id = v.id
 WHERE v.visit_time > ?
 ORDER BY v.visit_time ASC
`, cur.MaxVisitTime)
	if err != nil {
		return cur, nil, err
	}
	for visitRows.Next() {
		var id int64
		var visitTime int64
		var duration sql.NullInt64
		var url sql.NullString
		var title sql.NullString
		var foreground sql.NullInt64
		if err := visitRows.Scan(&id, &visitTime, &duration, &url, &title, &foreground); err != nil {
			visitRows.Close()
			return cur, nil, err
		}
		if title.String == "" {
			continue
		}
		if visitTime > next.MaxVisitTime {
			next.MaxVisitTime = visitTime
		}
		events = append(events, store.Event{
			Source:        "chrome",
			SourceEventID: fmt.Sprintf("%s:visit:%d", profile.Name, id),
			OccurredAt:    chromeTime(visitTime),
			App:           profile.Name,
			URL:           url.String,
			Action:        "visited",
			Title:         title.String,
			Metadata: map[string]any{
				"profile":        profile.Name,
				"duration_sec":   secondsFromNullableMicros(duration),
				"foreground_sec": secondsFromNullableMicros(foreground),
			},
			RefKind: "url",
			RefKey:  url.String,
		})
	}
	if err := visitRows.Close(); err != nil {
		return cur, nil, err
	}

	downloadRows, err := db.QueryContext(ctx, `
SELECT id, start_time, target_path, tab_url, total_bytes, mime_type
  FROM downloads
 WHERE start_time > ?
 ORDER BY start_time ASC
`, cur.MaxDownloadTime)
	if err != nil {
		return cur, nil, err
	}
	for downloadRows.Next() {
		var id int64
		var startTime int64
		var targetPath sql.NullString
		var tabURL sql.NullString
		var totalBytes sql.NullInt64
		var mimeType sql.NullString
		if err := downloadRows.Scan(&id, &startTime, &targetPath, &tabURL, &totalBytes, &mimeType); err != nil {
			downloadRows.Close()
			return cur, nil, err
		}
		if targetPath.String == "" {
			continue
		}
		if startTime > next.MaxDownloadTime {
			next.MaxDownloadTime = startTime
		}
		events = append(events, store.Event{
			Source:        "chrome",
			SourceEventID: fmt.Sprintf("%s:download:%d", profile.Name, id),
			OccurredAt:    chromeTime(startTime),
			App:           profile.Name,
			URL:           tabURL.String,
			Action:        "downloaded",
			Title:         filepath.Base(targetPath.String),
			Metadata: map[string]any{
				"profile":    profile.Name,
				"path":       targetPath.String,
				"size_bytes": nullableInt64(totalBytes),
				"mime_type":  mimeType.String,
			},
			RefKind: "url",
			RefKey:  tabURL.String,
		})
	}
	if err := downloadRows.Close(); err != nil {
		return cur, nil, err
	}
	return next, events, nil
}

func copyHistory(path string) (string, error) {
	input, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer input.Close()
	tmp, err := os.CreateTemp("", "arkloop-chrome-history-*.sqlite")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()
	if _, err := io.Copy(tmp, input); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return "", err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return "", err
	}
	return tmpPath, nil
}

func chromeTime(value int64) time.Time {
	return time.UnixMicro(value - chromeEpochOffsetMicros).UTC()
}

func secondsFromMicros(value int64) float64 {
	if value <= 0 {
		return 0
	}
	return float64(value) / 1000000
}

func secondsFromNullableMicros(value sql.NullInt64) float64 {
	if !value.Valid {
		return 0
	}
	return secondsFromMicros(value.Int64)
}

func nullableInt64(value sql.NullInt64) int64 {
	if !value.Valid {
		return 0
	}
	return value.Int64
}
