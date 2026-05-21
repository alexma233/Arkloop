//go:build darwin

package screentime

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"arkloop/services/activity-record/internal/store"
	_ "modernc.org/sqlite"
)

type Source struct {
	dbPath string
}

type cursor struct {
	MaxStartDate float64 `json:"max_start_date"`
}

func NewDefault() (*Source, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	dbPath := filepath.Join(home, "Library", "Application Support", "Knowledge", "knowledgeC.db")
	if _, err := os.Stat(dbPath); err != nil {
		return nil, fmt.Errorf("knowledgeC.db not accessible (Full Disk Access required): %w", err)
	}
	return &Source{dbPath: dbPath}, nil
}

func (s *Source) Name() string {
	return "screentime"
}

func (s *Source) Sync(ctx context.Context, db *store.Store) (int, error) {
	var cur cursor
	if err := db.Cursor(ctx, s.Name(), &cur); err != nil {
		return 0, err
	}
	tmp, err := copyDB(s.dbPath)
	if err != nil {
		return 0, fmt.Errorf("copy knowledgeC.db: %w", err)
	}
	defer os.Remove(tmp)

	srcDB, err := sql.Open("sqlite", "file:"+tmp+"?mode=ro&immutable=1")
	if err != nil {
		return 0, err
	}
	defer srcDB.Close()

	rows, err := srcDB.QueryContext(ctx, `
SELECT
  ZOBJECT.Z_PK,
  ZOBJECT.ZSTARTDATE,
  ZOBJECT.ZENDDATE,
  ZOBJECT.ZVALUESTRING,
  COALESCE(ZSOURCE.ZBUNDLEID, ''),
  COALESCE(ZSOURCE.ZDEVICEID, '')
FROM ZOBJECT
LEFT JOIN ZSOURCE ON ZSOURCE.Z_PK = ZOBJECT.ZSOURCE
WHERE ZOBJECT.ZSTREAMNAME = '/app/usage'
  AND ZOBJECT.ZSTARTDATE > ?
ORDER BY ZOBJECT.ZSTARTDATE ASC
`, cur.MaxStartDate)
	if err != nil {
		return 0, fmt.Errorf("query knowledgeC.db: %w", err)
	}

	var events []store.Event
	next := cur
	for rows.Next() {
		var pk int64
		var startDate, endDate float64
		var valueString sql.NullString
		var bundleID, deviceID string
		if err := rows.Scan(&pk, &startDate, &endDate, &valueString, &bundleID, &deviceID); err != nil {
			rows.Close()
			return 0, err
		}
		if !valueString.Valid || valueString.String == "" {
			continue
		}
		if startDate > next.MaxStartDate {
			next.MaxStartDate = startDate
		}
		duration := endDate - startDate
		if duration < 0 {
			duration = 0
		}
		appName := readableAppName(valueString.String)
		events = append(events, store.Event{
			Source:        "screentime",
			SourceEventID: fmt.Sprintf("screentime:%d", pk),
			OccurredAt:    cocoaTime(startDate),
			App:           appName,
			Action:        "app_used",
			Title:         appName,
			Metadata: map[string]any{
				"bundle_id":    valueString.String,
				"source_bundle": bundleID,
				"device_id":    deviceID,
				"duration_sec": duration,
			},
			RefKind: "bundle_id",
			RefKey:  valueString.String,
		})
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}

	inserted, err := db.UpsertEvents(ctx, events)
	if err != nil {
		_ = db.SaveCursor(ctx, s.Name(), cur, err)
		return 0, err
	}
	if err := db.SaveCursor(ctx, s.Name(), next, nil); err != nil {
		return 0, err
	}
	return inserted, nil
}

// macOS Core Data "Cocoa" timestamp: seconds since 2001-01-01 00:00:00 UTC
var cocoaEpoch = time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)

func cocoaTime(seconds float64) time.Time {
	return cocoaEpoch.Add(time.Duration(seconds * float64(time.Second))).UTC()
}

func readableAppName(bundleID string) string {
	parts := strings.Split(bundleID, ".")
	if len(parts) == 0 {
		return bundleID
	}
	return parts[len(parts)-1]
}

func copyDB(path string) (string, error) {
	input, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer input.Close()
	tmp, err := os.CreateTemp("", "arkloop-screentime-*.sqlite")
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
