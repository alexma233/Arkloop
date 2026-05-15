---
title: Tools & Skills
description: Built-in tools, MCP integration, and skill packages.
---

Arkloop agents operate through tools — callable capabilities that let them read files, search the web, execute code, and more. Tools come from three sources: built-in tools available to every agent, MCP tools connected through external servers, and skill packages that extend the agent with specialized abilities.

## Built-in Tools

Built-in tools are available to every agent without configuration. They are grouped by purpose.

### File Operations

| Tool | Purpose |
|------|---------|
| `read` | Read file contents |
| `write_file` | Create or overwrite a file |
| `edit` | Apply targeted edits to an existing file |
| `glob` | Find files by name pattern |
| `grep` | Search file contents by pattern |

### Web

| Tool | Providers |
|------|-----------|
| `web_search` | Basic / Tavily / Exa / SearXNG |
| `web_fetch` | Basic / Jina / Firecrawl |

Search provider is configured in Settings → Providers. Fetch provider determines how web pages are retrieved and parsed.

### Code Execution

| Tool | Purpose |
|------|---------|
| `sandbox` | Run code in an isolated execution environment |

The sandbox provides a secure, ephemeral container for running user or agent-generated code. Output and errors are returned to the conversation.

### Task Management

| Tool | Purpose |
|------|---------|
| `todo_write` | Create or update a task checklist |
| `enter_plan_mode` | Switch the agent to planning mode — outline steps before executing |
| `exit_plan_mode` | Return the agent to execution mode |

### Sub-agents

| Tool | Purpose |
|------|---------|
| `spawn_agent` | Delegate a sub-task to a child agent that runs in parallel |

Sub-agents appear in the conversation as SubAgentBlocks, showing their status from spawn through completion.

### User Interaction

| Tool | Purpose |
|------|---------|
| `askuser` | Agent asks for your input mid-task |
| `show_widget` | Render an interactive widget in the conversation |

### Other

| Tool | Purpose |
|------|---------|
| `summarize_thread` | Generate a summary of the current conversation |
| `arkloop_help` | Look up Arkloop product documentation and help articles |

> [!NOTE] Screenshot placeholder.

## MCP Tools

MCP (Model Context Protocol) tools are third-party capabilities connected through MCP servers. They are not available by default — you add them through Settings → MCP.

Once an MCP server is configured, every tool it exposes becomes available to your agent automatically. The agent decides when to call them based on the conversation context.

See [MCP Settings](/docs/settings/mcp) for configuration details.

## Skills (Skill Packages)

Skills are installable tool packages that give your agent new capabilities. They bundle prompts, tools, and sometimes data into a single unit.

### ClawHub Marketplace

Browse and install community-published skills from the ClawHub registry. Skills range from niche utilities to full workflow integrations.

### Local Skills

Import skills from a GitHub repository or upload them directly from your file system.

### Built-in Skills

Several skills ship with Arkloop:

| Skill | Capability |
|-------|-----------|
| `opencli` | OpenCLI command execution |
| `geogebra-drawing` | GeoGebra interactive math figures |

Once a skill is installed, the agent automatically gains the corresponding tool capabilities. No manual wiring is needed.

## Platform Management

The `platform_manage` tool is exclusive to the Platform Agent. It provides 40+ management actions covering projects, personas, threads, billing, and administrative operations. Regular agents do not have access to this tool.

> [!NOTE] Screenshot placeholder.
