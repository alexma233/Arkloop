---
title: Advanced
description: Data, network, usage, logs, and module management.
---

Advanced groups everything that touches the runtime, the network, and your stored data.

> [!NOTE]
> Screenshot placeholder: Advanced settings landing page.

## Data

Export and import selectively. You decide which categories travel with you.

Categories:

- Settings
- Providers
- Chat history
- Personas
- Projects
- MCP servers
- Themes

Path: `Settings -> Advanced -> Data -> Import` / `Export`

## Network

- Proxy: HTTP / HTTPS / SOCKS5, with optional auth
- Timeouts: per-request and per-stream
- Retry policy: max attempts and backoff
- User-Agent: override the string sent to providers

Use this when you sit behind a corporate proxy or need to reach providers via a regional gateway.

## Usage

- Monthly snapshots
- Per-model breakdown of token spend
- Activity heatmap by day and hour
- Spending trends over time

All data is computed locally from your run history.

## Logs

- Main process: the Desktop shell
- Sidecar logs: API, Worker, Bridge, and module sidecars

Search by text, filter by level, and copy a slice for bug reports.

## Modules

Optional sidecars that unlock extra capabilities. Each can be installed, uninstalled, or updated independently.

- Sandbox: code execution
- Memory (OpenViking): semantic memory
- SearXNG: meta-search backend
- Firecrawl: web fetch and crawl
- Agent Browser: headless browser for agents

Modules consume disk and RAM. Install only the ones you use.
