---
title: General
description: Language, timezone, startup, and notifications.
---

General controls how Arkloop boots, how it talks to the OS, and when it interrupts you.

> [!NOTE]
> Screenshot placeholder: General settings panel.

## Language and timezone

Interface language is independent from the language your agents speak. Timezone is used for timestamps in chat history, scheduled triggers, and usage charts.

Path: `Settings -> General -> Language` / `Timezone`

## Startup behavior

- Launch at login: start Arkloop when the OS logs in
- Open window on launch: show the main window, or stay in the tray

## Close behavior

- Keep running in background: closing the window keeps the runtime alive so heartbeats and channel bots stay connected
- Quit on close: closing the window shuts down all sidecars

## Desktop notifications

Shown when long-running agent work completes. Useful when you switch tabs while an agent is iterating on tools.

## Update notifications

Notify when a new Desktop release is available. Updates are not auto-installed.

## Keep screen awake during active sessions

Prevents the OS from sleeping while a run is in progress. Disabled by default.
