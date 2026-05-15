---
title: Chat Interface
description: Everything you need to know about the conversation interface.
---

## Chat and Work Modes

The conversation interface operates in two modes. Chat mode is for straightforward question-and-answer exchanges. Work mode is for multi-step tasks where the agent plans, executes, and reports progress autonomously.

| | Chat | Work |
|---|---|---|
| Best for | Quick questions, translations, summaries | Code generation, research, multi-file edits |
| Agent behavior | Responds to each message individually | Breaks the task into steps, executes them in sequence |
| Progress display | None | Progress panel with step-by-step status |

Click the mode button above the input bar → select the desired mode.

> [!NOTE] Screenshot placeholder.

## Input Bar

The input bar is where you compose messages and control how the agent processes them.

### Persona and Model Selection

Different personas give the agent different behavior and expertise. Different models trade speed for capability. Click the PersonaModelBar above the input bar → choose a persona → choose a model.

> [!NOTE] Screenshot placeholder.

### Slash Commands

Typing `/` in the input bar triggers slash commands:

| Command | Action |
|---------|--------|
| `/plan` | Enter plan mode — the agent outlines its approach before executing |
| `/setup` | Open project settings |

### File Attachments

Attach files for the agent to read. Drag a file onto the input bar, or click the attachment button to browse.

### Voice Input

Click the microphone button to dictate your message. This requires ASR credentials to be configured in Settings.

### Reasoning Effort

Reasoning effort controls how deeply the agent thinks before responding. Higher effort produces more thorough answers but takes longer.

| Level | Behavior |
|-------|----------|
| Off | No reasoning step, fastest response |
| Minimal | Brief reasoning, good for simple tasks |
| Low | Short reasoning chain |
| Medium | Balanced depth and speed |
| High | Extended reasoning for complex problems |
| Max | Deepest reasoning, longest wait |

Set the reasoning effort via the control in the input bar.

### Auto-resizing Input

The text input expands as you type and collapses back when empty. For long messages, it grows up to a maximum height and then scrolls internally.

## Message Actions

Each message in a conversation offers a set of actions.

### Copy and Edit

Copy a message to your clipboard via the copy button on the message. Edit a previously sent message by clicking the edit button → modify the text → resend. The agent will regenerate its response from that point.

### Report a Message

If a response is problematic, click the report button → choose a reason:

| Reason | Meaning |
|--------|---------|
| Inaccurate | Contains factual errors |
| Out of date | Information is no longer correct |
| Too short | Response is insufficiently detailed |
| Too long | Response is unnecessarily verbose |
| Harmful | Content is dangerous or offensive |
| Wrong sources | Citations do not support the claims |

### Star and Pin

Star a conversation to mark it as important. Pin a conversation to keep it at the top of the sidebar. Both are toggles — click again to undo.

### Incognito Mode

Incognito conversations are not saved to history and are permanently deleted after 24 hours. Enable incognito mode when you want a private exchange without leaving a trace.

### Share, Rename, Delete

Share a conversation to generate a link others can view. Rename a conversation to make it easier to find later. Delete a conversation to remove it permanently. All three actions are available from the conversation header menu.

### Interrupt and Retry

If the agent is taking too long or heading in the wrong direction, click the stop button to interrupt. Click retry to regenerate the last response with a fresh sample.

## Cop Timeline

The cop timeline is the execution trace shown inside each AI reply. It reveals what the agent did behind the scenes to produce its answer.

### Thinking Blocks

When reasoning effort is enabled, the timeline shows a thinking block with a duration counter and a rotating hint such as "Thinking..." or "Analyzing code...". Click to expand and read the reasoning.

### Tool Calls

Each tool invocation appears as a card in the timeline:

| Tool | Display |
|------|---------|
| Shell execution | Command, output, and success/failure status |
| Web fetch | Retrieved content summary |
| Code execution | Output from the sandbox |

### Sources

When the agent cites external material, a source list appears at the bottom of the reply. Each source links to the original content.

### Expand and Collapse

Long timelines start collapsed. Click "Show more" to expand the full trace, or "Show fewer" to collapse it again.

> [!NOTE] Screenshot placeholder.

## Special Cards

Certain actions and results render as rich content cards inside the conversation.

| Card | Purpose |
|------|---------|
| TodoListCard | Track task progress with checkable items |
| CodeExecutionCard / CodeExecutionPanel | Display sandbox code execution output |
| SubAgentBlock | Show sub-agent status: Spawning, Running, Completed, Failed, Closed |
| Artifact preview | Render HTML, SVG, image, or stream blocks inline |
| UserInputCard | Agent requests additional input from you mid-task |
| MemoryActionBlock | Show memory operations: write, search, read, delete |
| MermaidBlock | Render Mermaid diagrams |
| MindmapBlock | Render mind maps |
| GeoGebraBlock | Render GeoGebra interactive math figures |
| ContextCompactBar | Show automatic context compression progress |

> [!NOTE] Screenshot placeholder.

## Right Panel

The right panel is a switchable area next to the conversation. Toggle between panels using the tabs at the top.

### Browser Panel

A built-in browser for previewing web pages. Navigate with forward, back, and refresh controls. Manage bookmarks and view browsing history.

### Files Panel

A local file browser. Navigate your project directory and open files for the agent to reference.

### Resource Panel

Preview resources such as Markdown documents, source code, and original reference files.

> [!NOTE] Screenshot placeholder.

## Sidebar

The sidebar lists all your conversations and provides navigation.

### Normal Mode

Conversations are listed in chronological order, most recent first.

### GTD Mode

Conversations are organized into action groups:

| Group | Meaning |
|-------|--------|
| Backlog | Not yet started |
| Next | Ready to work on |
| Waiting | Blocked on something external |
| Someday | Deferred indefinitely |
| Archived | Completed and stored |

Drag a conversation between groups to reclassify it.

### Pinned Section

Pinned conversations appear in a separate section at the top of the sidebar for quick access.

### Project Groups

When a conversation belongs to a project, it is nested under that project's heading. Collapse or expand a project group by clicking its header.

### Search and New Conversation

Use the search field at the top of the sidebar to find a conversation by name. Click the new conversation button to start a fresh thread.

> [!NOTE] Screenshot placeholder.
