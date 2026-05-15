---
title: MCP Settings
description: Connect external tools through MCP servers.
---

## What is MCP

MCP (Model Context Protocol) is a standard protocol for connecting external tools and data sources to your agent. Instead of building every capability into Arkloop, MCP lets you plug in third-party services — databases, APIs, internal tools — and have the agent use them as if they were native.

Once an MCP server is connected, all tools it exposes become available to your agent automatically.

## Add an MCP Server

Settings → MCP → Add Server.

Each server requires:

- **Display Name** — a human-readable label for the server
- **Transport type** — how Arkloop communicates with the server

### HTTP Mode

Use HTTP mode for remote MCP servers accessible over the network.

| Field | Description |
|-------|-------------|
| URL | Server endpoint (e.g. `https://mcp.example.com/sse`) |
| Headers | Custom HTTP headers (key-value pairs) |
| Bearer Token | Authentication token sent in the `Authorization` header |
| Timeout | Request timeout in seconds |

### Stdio Mode

Use Stdio mode for local MCP servers that run as a process on your machine.

| Field | Description |
|-------|-------------|
| Command | The executable to launch (e.g. `npx`, `python`) |
| Args | Command-line arguments passed to the executable |
| Working Dir | Directory where the process runs |
| Env JSON | Environment variables as a JSON object |
| Timeout | Process startup timeout in seconds |

> [!NOTE] Screenshot placeholder.

## Sync Mode

Sync mode controls when Arkloop fetches the tool list from an MCP server.

| Mode | Behavior |
|------|---------|
| Before each conversation | Refresh the tool list every time a new conversation starts |
| On first connection | Fetch the tool list once when the server is first connected, then cache it |

Use "before each conversation" if the server's tool list changes frequently. Use "on first connection" for stable servers to reduce startup latency.

## Discovery / Scan / Import

Arkloop can detect existing MCP configurations on your system.

- **Discovery** — scan for MCP servers already running on your machine
- **Scan** — search common configuration locations (e.g. Claude Desktop config, VS Code settings) for MCP entries
- **Import** — add a detected configuration directly without re-entering details

Settings → MCP → Scan to start.

> [!NOTE] Screenshot placeholder.

## After Adding

Once an MCP server is added, its tools appear in the agent's tool list and can be invoked during conversations. No restart is required. The agent decides when to use them based on context.
