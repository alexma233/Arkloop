---
title: 快速开始
description: 五分钟内开始使用 Arkloop。
---

首次启动 Arkloop 后，设置向导会引导你完成初始配置。

## 1. 欢迎页

Logo 绘制动画 → 问候语出现 → 点击"开始使用"。

## 2. 外观设置

选择界面语言和主题。

提供 7 种主题预设：

| 主题 | 风格 |
|------|------|
| default | 明亮中性 |
| terra | 暖色大地（默认选中） |
| github | GitHub 风格 |
| nord | 北极冷色 |
| catppuccin | 柔和粉彩 |
| tokyo-night | 深色霓虹 |
| retina-burn | 高对比深色 |

可随时在设置中更换。

## 3. 可选导入

如果检测到已有配置，向导会显示导入选项：

- **Hermes**（`~/.hermes/config.yaml`）
- **OpenClaw**（`~/.openclaw/openclaw.json`）

可导入的内容（勾选）：

- 身份 / SOUL.md
- 技能
- MCP 服务器
- Provider

没有检测到配置时此步骤自动跳过。也可手动跳过。

## 4. 自动检测 Provider

向导会扫描本地是否已配置 Claude Code 或 Codex 的 Provider。如果找到，可直接使用，跳过手动配置。

> [!TIP] 如果自动检测到了可用的 Provider，你不需要再手动输入 API Key。

## 5. Provider 配置

这是唯一必须手动完成的步骤（除非已导入或自动检测到）。

配置流程：

选择 Vendor（OpenAI / Anthropic / Gemini）→ 输入 API Key → 输入 Base URL（有默认值）→ 点击"验证" → 从列表选择模型 → 确认

> [!NOTE] API Key 仅存储在本地，不会上传至任何服务器。

## 6. 完成

点击"开始对话"进入主界面。

三个内置 Agent 已就绪：

| Agent | 用途 |
|-------|------|
| Normal | 日常对话 |
| Work | 结构化任务 |
| Extended Search | 深度检索 |

无需手动创建 Agent，开箱即用。

> [!TIP] 记忆系统默认以 Notebook 模式运行，无需额外配置。后续如需启用语义记忆，可在设置中开启。

完成向导后，所有设置均可随时在设置面板中修改。
