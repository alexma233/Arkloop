---
title: Quick Start
description: Get started with Arkloop in under five minutes.
---

The first time you launch Arkloop, a setup wizard walks you through a few steps. The only required manual step is configuring an LLM provider — everything else is optional or automatic.

## Welcome

A short animation plays on first launch, followed by a greeting. Click **Get Started** to begin.

## Appearance

Choose your interface language and a theme preset. Seven presets are available:

| Preset | Style |
|--------|-------|
| default | Clean neutral |
| terra | Warm earth tones (selected by default) |
| github | GitHub-inspired |
| nord | Cool blue-gray |
| catppuccin | Soft pastel |
| tokyo-night | Dark purple-blue |
| retina-burn | High-contrast dark |

You can change these later in Settings at any time.

## Import (Optional)

If Arkloop detects an existing configuration from compatible tools, it offers to import data automatically:

- **Hermes** — detected from `~/.hermes/config.yaml`
- **OpenClaw** — detected from `~/.openclaw/openclaw.json`

When found, you can selectively import:

- Identity / SOUL.md
- Skills
- MCP servers
- Providers

Skip this step if you are starting fresh.

## Auto-Detected Providers (Optional)

Arkloop scans for locally installed CLI tools (Claude Code, Codex). If a compatible provider is found, you can use it directly without manual configuration — skip ahead to the completion step.

## Provider Setup (Required)

This is the only step you must complete manually (unless you imported or auto-detected a provider).

1. **Select Vendor** — OpenAI, Anthropic, or Gemini
2. **Enter API Key** — paste your key from the vendor dashboard
3. **Base URL** — pre-filled with the vendor default; change only if you use a proxy or custom endpoint
4. **Verify** — click the Verify button to confirm connectivity
5. **Select Models** — after verification, pick the models you want to use from the list
6. **Confirm** — save the provider configuration

> [!TIP] You can add more providers later in Settings. The wizard only needs one working provider to get started.

## Complete

Click **Start Chatting** to finish onboarding. Three built-in agents are already available:

| Agent | Purpose |
|-------|---------|
| Normal | General-purpose conversation |
| Work | Structured task execution |
| Extended Search | Deep research with web search |

Memory defaults to **Notebook** mode, which works without any additional configuration. No external services are needed.

From here you can start a conversation immediately, or explore Settings to configure additional modules.
