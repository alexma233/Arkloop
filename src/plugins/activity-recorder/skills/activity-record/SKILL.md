---
name: activity-record
description: Query Arkloop Activity Record local activity data from SQLite. Use this when Activity Recorder needs local Codex, Chrome, or desktop activity facts without starting external runtimes.
---

# Activity Record

Activity Record stores normalized local activity facts in:

```bash
~/.Arkloop/activity-record/activity.db
```

Use bounded SQL queries. Always include a time range or `LIMIT`.

## Tables

### `activity_events`

Core columns:

- `occurred_at`: RFC3339 timestamp
- `source`: source key, for example `codex` or `chrome`
- `source_event_id`: stable source event id
- `app`: app or profile name
- `window_title`: active window title when available
- `url`: URL when available
- `action`: event action, for example `prompted`, `received`, `visited`, `downloaded`
- `title`: short event title
- `text`: longer text when available
- `metadata_json`: source-specific JSON metadata
- `ref_kind`, `ref_key`: optional reference pointer

### `source_cursors`

Incremental sync state per source. Use this for diagnostics only.

### `activity_refs`

Optional reference files. First version may not write refs for every event.

## Examples

Recent activity:

```sql
SELECT occurred_at, source, action, title, url
FROM activity_events
ORDER BY occurred_at DESC
LIMIT 50;
```

Recent Codex prompts:

```sql
SELECT occurred_at, action, substr(title, 1, 160) AS text
FROM activity_events
WHERE source = 'codex'
  AND occurred_at >= datetime('now', '-1 day')
ORDER BY occurred_at DESC
LIMIT 50;
```

Recent browser visits:

```sql
SELECT occurred_at, app, title, url
FROM activity_events
WHERE source = 'chrome'
  AND action = 'visited'
  AND occurred_at >= datetime('now', '-1 day')
ORDER BY occurred_at DESC
LIMIT 50;
```
