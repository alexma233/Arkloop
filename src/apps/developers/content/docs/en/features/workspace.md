---
title: Workspace
description: The file space your agent can read and write.
---

## What it is

A workspace is a file space your agent can access through built-in tools — `read`, `write_file`, `edit`, `glob`, `grep`. Anything the agent reads from or writes to disk lives here. Each thread is associated with a workspace.

Files are stored as an immutable manifest plus content-addressed blobs. You don't need to think about this — it just means every change is versioned and old revisions are recoverable.

## Browsing files

Open the right panel and switch to the **Files** tab to browse the current thread's workspace.

> [!NOTE]
> Screenshot: right panel → Files tab showing a file tree.

## Resource preview

Selecting a file opens an inline preview:

| File type | Behavior |
|---|---|
| Image | Rendered inline |
| HTML | Rendered as a live page |
| Text / code | Syntax-highlighted preview |
| Binary | Download button |

The same component (`WorkspaceResource`) is used when the agent references a file in chat, so previews stay consistent across the UI.

## Thread ↔ workspace

Each thread is bound to a single workspace. When you start a new thread you can:

- Start from a clean workspace, or
- Inherit the workspace of an existing project (files carry over)

Switching threads switches workspaces — the Files tab always reflects what the current agent can see.
