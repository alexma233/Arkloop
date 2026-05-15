---
title: Memory System
description: How Arkloop remembers — Notebook, Memory, and Nowledge.
---

Arkloop provides three layers of memory, each serving a different purpose. You can use them independently or combine them for full coverage.

## Notebook — Leave notes for your AI

Notebook is a manual note-taking system. You write notes, and they are injected into every conversation the agent holds. No model configuration is needed — it works out of the box.

Best for fixed information the AI should always know: personal preferences, project background, role settings, coding conventions, or any context you want guaranteed present in every turn.

Operations: Settings → Notebook → Add / Edit / Delete / Search notes.

## Memory — Your AI's autonomous brain

Memory is a semantic memory system. The AI automatically organizes important information from conversations and recalls it only when relevant. You do not write or manage entries yourself — the AI decides what to store and when to retrieve it.

Best for dynamic information you do not want to manually manage but want the AI to remember across conversations: past decisions, evolving preferences, contextual facts that surface over time.

Requires configuration: an extraction model and an embedding model. An optional rerank model improves retrieval accuracy. Backend options: OpenViking (built-in vector storage) or Nowledge (external knowledge graph).

Operations: Settings → Memory → Enable → Choose backend → Configure models.

## Nowledge — Knowledge graph backend

Nowledge is an alternative backend for Memory. It replaces OpenViking's vector storage with a knowledge graph that supports Working Memory, recalled memories, and thread-level history retrieval. You can browse knowledge graph connections and view a timeline of stored facts.

Best for advanced users who self-host a Nowledge instance and want graph-structured recall instead of flat vector search.

Configuration: Base URL + API Key + Timeout. Supports detecting a locally running Nowledge instance.

## Notebook vs Memory

| | Notebook | Memory |
|---|---|---|
| Who manages | You write manually | AI auto-organizes |
| When injected | Every conversation | Only when relevant |
| Configuration needed | None | Extraction + embedding models |
| Best for | Fixed information | Dynamic information |

## How you notice memory at work

During a conversation, the MemoryActionBlock panel in chat shows real-time memory operations — write, search, read, and delete. The AI also demonstrates memory indirectly by referencing information from previous conversations without being reminded.

> [!NOTE] Screenshot placeholder.

## Impression and Snapshot

Impression is the AI's overall profile of you — a summary it maintains across all conversations. You can view and rebuild it in Settings → Memory.

Snapshot (labeled "Memories" in the UI) shows the current memory entries at L1 and L2 depth levels. L1 is a concise summary; L2 provides deeper detail. You can view and rebuild snapshots in Settings → Memory.

> [!NOTE] Screenshot placeholder.
