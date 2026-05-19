# AIContext

Use AIContext when the user asks about their browser history, Codex history, Claude Code history, or previously ingested local activity context.

AIContext stores data in `~/.aicontext/data/activity.db` and exposes the read-only query helper at `~/.aicontext/skill/scripts/query.py` after `aicontext install` has been completed.

Prefer SQL queries through the helper:

```bash
python3 ~/.aicontext/skill/scripts/query.py "SELECT timestamp, source, service, action, title, ref_type, ref_id FROM activity ORDER BY timestamp DESC LIMIT 20"
```

If the helper or database is missing, report that AIContext has not been initialized yet.
