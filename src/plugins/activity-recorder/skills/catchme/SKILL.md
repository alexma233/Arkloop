# CatchMe

Use CatchMe when the user asks what they clicked, copied, typed, viewed, or did in local desktop activity history.

CatchMe runs as an event-driven recorder. It records window, keyboard, mouse, clipboard, idle, notification, and click/scroll screenshots into `~/.catchme/data.db`.

Prefer the CatchMe MCP server when available. For direct inspection, query the local SQLite database:

```bash
sqlite3 ~/.catchme/data.db "SELECT datetime(ts, 'unixepoch', 'localtime'), kind, substr(data, 1, 300), blob FROM events_raw ORDER BY ts DESC LIMIT 20"
```

Use screenshot blob paths only when the user asks for visual evidence.
