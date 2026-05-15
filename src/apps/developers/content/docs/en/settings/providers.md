---
title: Provider Settings
description: Connect LLM providers and manage models.
---

Providers are the LLM services that power your agents. Arkloop supports multiple vendors simultaneously — you can mix OpenAI, Anthropic, Gemini, and others in the same installation.

## Add a Provider

Settings → Providers → Add Provider

1. **Vendor** — Select from the dropdown: OpenAI, Anthropic, Gemini, etc.
2. **API Key** — Paste your key from the vendor dashboard.
3. **Base URL** — Pre-filled with the vendor's default endpoint. Change it only if you use a proxy or self-hosted gateway.
4. **Headers** (optional) — Add custom HTTP headers if your proxy requires authentication or routing metadata.
5. **Verify** — Click the Verify button to test API connectivity before saving. This sends a lightweight request to confirm the key and endpoint are valid.
6. **Save**.

> [!NOTE] Screenshot placeholder.

## Model Management

After adding a provider, manage its models:

| Action | How |
|--------|-----|
| Import models | Click Import to fetch the list of models available under your API key |
| Enable / Hide | Toggle visibility for each model — hidden models do not appear in the persona selector |
| Search | Filter models by name |

### Model Option Flags

Each model can carry flags that describe its capabilities:

| Flag | Meaning |
|------|---------|
| Vision | Accepts image inputs |
| Embedding | Generates vector embeddings |
| Tool Calling | Supports function / tool calling |
| Reasoning | Capable of chain-of-thought reasoning |
| Context Window | Maximum input context length |
| Max Output | Maximum output token count |
| Temperature | Whether temperature is configurable |

## Embedding Models

At least one model must be tagged as **Embedding** for Memory (OpenViking) to function. The embedding model converts text into vectors for semantic search and retrieval.

If no embedding model is marked, the Memory configuration page will show a warning and vector operations will fail.

> [!NOTE] Screenshot placeholder.

## Multiple Providers

You can add multiple providers of the same vendor type — for example, two OpenAI entries with different API keys (personal vs. workspace). Each provider maintains its own model list and credentials.

When the same model name appears under multiple providers, the persona selector shows the model once and routes through the first matching provider. Reorder providers in Settings if you need to change routing priority.
