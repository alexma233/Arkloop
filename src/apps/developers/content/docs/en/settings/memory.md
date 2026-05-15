---
title: Memory Settings
description: Configure how Arkloop stores and recalls information.
---

Memory settings control how Arkloop stores, organizes, and retrieves information across conversations.

## Global Toggle

The master switch enables or disables the entire memory subsystem. When disabled, no memory is stored or recalled. Settings → Memory → Enable Memory.

## Auto-summarize

"Summarize after each turn" is a toggle that controls whether the AI automatically distills conversation content into memory after every response. When off, memory updates only happen when the AI explicitly decides to write. Settings → Memory → Summarize after each turn.

## Provider Selection

Three provider cards are available. Selecting a provider determines what configuration is required.

| Provider | Configuration |
|----------|---------------|
| Notebook | None — works immediately |
| OpenViking | Extraction model + Embedding model + Optional rerank model |
| Nowledge | Base URL + API Key + Timeout |

Choose a provider: Settings → Memory → Select provider card.

> [!NOTE] Screenshot placeholder.

## OpenViking Configuration

When OpenViking is selected, the MemoryConfigModal opens.

### Module Status

A status card shows the Installer Bridge state (online or offline) and the OpenViking module state (running, stopped, or not installed).

- Not installed: an "Install" button starts the installation process.
- Installed but stopped: a "Start" button brings the module online.
- Running: configuration is available.

### Model Configuration

When the module is running, a form presents dropdowns for each model:

- **Extraction model** — the model that decides what to store from conversations.
- **Embedding model** — the model that vectorizes stored content for retrieval.
- **Rerank model** (optional) — improves retrieval accuracy by re-scoring candidates.

Click "Save & Configure" to apply.

> [!NOTE] Screenshot placeholder.

## Nowledge Configuration

When Nowledge is selected, provide:

- **Base URL** — the root address of your Nowledge instance.
- **API Key** — authentication credential for the instance.
- **Timeout** — request timeout in seconds.

A "Detect local instance" button scans localhost for a running Nowledge service and auto-fills the Base URL if found.

> [!NOTE] Screenshot placeholder.

## Impression

Impression (labeled "Impression Profile" in the UI) is the AI's overall understanding of you. It accumulates across all conversations.

- **View**: read the current impression content.
- **Rebuild**: regenerate the impression from scratch using all available conversation history.

Settings → Memory → Impression → View or Rebuild.

> [!NOTE] Screenshot placeholder.

## Snapshot

Snapshot (labeled "Memories" in the UI) shows the current memory entries organized by depth level.

- **L1** — concise summary entries.
- **L2** — detailed entries with richer context.

You can browse entries at each level, view individual items, or rebuild the snapshot from raw conversation data.

Settings → Memory → Memories → View or Rebuild.

> [!NOTE] Screenshot placeholder.

## Error Log

If memory operations encounter failures, a notice appears: "Recent memory errors detected." Click to open the error log, which lists timestamps and error messages for each failed operation. Use this to diagnose configuration issues or backend connectivity problems.
