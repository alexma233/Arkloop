---
title: Channel Integration
description: Connect Arkloop to Telegram, Discord, Feishu, QQ, and WeChat.
---

Arkloop can connect to external messaging platforms so your agent answers directly in private chats and group conversations. Once a channel is bound, the agent treats incoming messages as conversation turns — the same persona, tools, and memory you configured in the chat UI apply.

## Supported Platforms

| Platform | Mode | Notes |
|---|---|---|
| Telegram | Private + Group | Supports Heartbeat in group chats |
| Discord | Server + Channel | Limit by server ID and channel ID |
| Feishu (Lark) | Private + Group | Trigger keywords, switch between Feishu / Lark domains |
| QQ Official | Private + Group | Uses the official QQ Bot account |
| QQ OneBot | Private + Group | Self-hosted OneBot v11 backend |
| WeChat | Private + Group | QR-code login from a personal account |

> [!NOTE] Screenshot placeholder.

## Common Concepts

### Bot Token

Every channel needs a credential issued by the upstream platform (Bot Token, App Secret, or QR-code login). The token tells Arkloop which bot identity to act as. See platform-specific fields in Channel Settings.

### Access Control

Channels accept an allowlist of users and groups. When an allowlist is empty the channel is closed — only IDs you explicitly add can talk to the agent. This applies uniformly to private chats, group chats, server IDs, and channel IDs.

### Persona Binding

A channel is bound to one persona at a time. Different channels can run different personas, so the same Arkloop account can present several bot identities across platforms.

### Heartbeat

Heartbeat fires periodic synthetic turns while a group chat is active. At each interval the agent decides whether to reply or stay silent, optionally surfacing memory fragments. Configure `heartbeat_enabled` and `heartbeat_interval_minutes` per persona. Currently used by Telegram group chats.

### /bind Command

Group members run `/bind` to associate their platform identity (e.g. Telegram user ID) with an Arkloop account. After binding, messages from that member resolve to the bound account when the agent looks up memory and credits.

### Memory Ownership

All memory belongs to the bot owner — the Arkloop user who configured the channel. Group members are not Arkloop users; they appear in the bot's memory only as identities (display name + platform ID). Switching personas under the same owner does not change memory ownership.
