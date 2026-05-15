---
title: 频道集成
description: 将 Arkloop 连接到 Telegram、Discord、飞书、QQ 和微信。
---

Arkloop 可以连接到外部消息平台，让 Agent 直接在私聊和群聊里响应。绑定频道后，平台消息会被当作一次对话轮次处理 —— 与你在 Web 端配置的 persona、工具和记忆保持一致。

## 支持的平台

| 平台 | 模式 | 备注 |
|---|---|---|
| Telegram | 私聊 + 群聊 | 群聊支持 Heartbeat |
| Discord | Server + Channel | 通过 server ID 和 channel ID 限制 |
| Feishu / Lark | 私聊 + 群聊 | 支持触发关键词，可切换飞书 / Lark 域名 |
| QQ Official | 私聊 + 群聊 | 使用 QQ 官方 Bot 账号 |
| QQ OneBot | 私聊 + 群聊 | 自托管 OneBot v11 后端 |
| WeChat | 私聊 + 群聊 | 个人号扫码登录 |

> [!NOTE] Screenshot placeholder.

## 通用概念

### Bot Token

每个频道都需要上游平台颁发的凭据（Bot Token、App Secret 或扫码登录），用来告诉 Arkloop 以哪个 bot 身份运行。各平台具体字段见 Channel Settings。

### 访问控制

频道接受用户和群组的白名单。白名单为空时频道是关闭的 —— 只有显式加入的 ID 才能和 Agent 对话。私聊、群聊、server ID、channel ID 一视同仁。

### Persona 绑定

一个频道同一时间绑定一个 persona。不同频道可以跑不同的 persona，因此同一个 Arkloop 账号能在多个平台上呈现不同的 bot 身份。

### Heartbeat

群聊活跃时，Heartbeat 按设定间隔触发一次合成轮次。每次触发由 Agent 自己决定是否回复、要不要带上记忆片段。通过 persona 的 `heartbeat_enabled` 和 `heartbeat_interval_minutes` 配置。目前用于 Telegram 群聊。

### /bind 命令

群成员通过 `/bind` 把自己的平台身份（如 Telegram user ID）绑定到 Arkloop 账号。绑定后，该成员的消息在查记忆和算额度时会解析到对应账号。

### 记忆归属

所有记忆都归属于 bot owner —— 配置频道的 Arkloop 用户。群成员不是 Arkloop 用户，在 bot 的记忆里只是 identity（名字 + 平台 ID）。同一 owner 下切换 persona 不改变记忆归属。
