package syncer

import (
	"context"
	"fmt"
	"log"
	"path/filepath"

	"arkloop/services/activity-record/internal/sources/chrome"
	"arkloop/services/activity-record/internal/sources/codex"
	"arkloop/services/activity-record/internal/store"
)

type Options struct {
	DataDir string
	Sources []string
}

type Source interface {
	Name() string
	Sync(context.Context, *store.Store) (int, error)
}

func Sync(ctx context.Context, opts Options) error {
	if opts.DataDir == "" {
		return fmt.Errorf("data dir is required")
	}
	db, err := store.Open(filepath.Join(opts.DataDir, "activity.db"))
	if err != nil {
		return err
	}
	defer db.Close()

	for _, sourceName := range opts.Sources {
		source, err := buildSource(sourceName)
		if err != nil {
			return err
		}
		count, err := source.Sync(ctx, db)
		if err != nil {
			return fmt.Errorf("%s: %w", source.Name(), err)
		}
		log.Printf("source=%s events=%d", source.Name(), count)
	}
	return nil
}

func buildSource(name string) (Source, error) {
	switch name {
	case "codex":
		return codex.NewDefault()
	case "chrome":
		return chrome.NewDefault()
	default:
		return nil, fmt.Errorf("unknown source %q", name)
	}
}
