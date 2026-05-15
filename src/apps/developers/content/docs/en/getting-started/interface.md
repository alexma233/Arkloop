---
title: Interface Overview
description: A tour of the Arkloop desktop interface.
---

Arkloop has three main areas: a sidebar for navigation, a central chat area, and an optional right panel for auxiliary views.

> [!NOTE] Add a screenshot here showing the annotated interface.

## Sidebar

The sidebar on the left organizes your sessions and provides quick access to key actions.

**Session list** — two viewing modes:

| Mode | Description |
|------|-------------|
| Timeline | Chronological list of all sessions |
| GTD | Grouped into Backlog, Next, Waiting, Someday, Archived |

**Pinned** — sessions you pin stay at the top for quick access.

**Projects** — sessions can be grouped under projects for organization.

The bottom of the sidebar has a search field and a button to create a new session.

> [!NOTE] Add a screenshot here showing the sidebar in Timeline and GTD modes.

## Chat Area

The center of the window is the conversation space.

### Input Bar

At the bottom of the chat area:

- **Persona / Model selector** — pick which agent and which LLM model to use
- **Text input** — type your message
- **Slash commands** — `/plan` for structured planning, `/setup` for configuration adjustments
- **Attachments** — attach files to the current message
- **Voice input** — dictate instead of typing
- **Reasoning effort** — control how deeply the agent reasons before responding

### Message Display

Agent responses include rich content blocks:

| Block | What it shows |
|-------|---------------|
| Thinking | The agent's internal reasoning steps |
| Tool Calls | External tool invocations and their results |
| Sources | Referenced documents or web pages |
| TodoList | A structured task checklist |
| CodeExecution | Code that ran in the sandbox, with output |
| SubAgent | A delegated sub-task running in parallel |
| Artifact | A rendered preview (chart, diagram, document) |
| MemoryAction | A memory read, write, or edit operation |

> [!NOTE] Add a screenshot here showing a message with thinking blocks and tool calls.

## Right Panel

The right panel is hidden by default. Toggle it from the toolbar or a keyboard shortcut.

| Tab | Purpose |
|-----|---------|
| Browser | In-app web preview with navigation and bookmarks |
| Files | Browse local files attached to the current project |
| Resource | Preview markdown, code, or documents referenced in the conversation |

> [!NOTE] Add a screenshot here showing the right panel with the Browser tab open.

## Settings

Access Settings from the gear icon in the sidebar or the top bar. Settings covers providers, personas, memory, themes, keyboard shortcuts, and more — detailed in the Settings section of this documentation.
