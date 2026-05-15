---
title: Provider 设置
description: 连接 LLM 服务商和管理模型。
---

Provider 是驱动 Agent 的 LLM 服务。Arkloop 支持同时接入多个服务商——可以在同一安装中混用 OpenAI、Anthropic、Gemini 等。

## 添加 Provider

设置 → Provider → 添加 Provider

1. **Vendor** — 从下拉列表选择：OpenAI、Anthropic、Gemini 等。
2. **API Key** — 粘贴从服务商控制台获取的密钥。
3. **Base URL** — 预填服务商默认端点。仅在使用代理或自建网关时才需修改。
4. **Headers**（可选）— 如代理需要认证或路由元数据，添加自定义 HTTP 头。
5. **验证** — 点击验证按钮，在保存前测试 API 连通性。会发送一个轻量请求确认密钥和端点有效。
6. **保存**。

> [!NOTE] 此处待添加截图。

## 模型管理

添加 Provider 后，管理其模型：

| 操作 | 方法 |
|------|------|
| 导入模型 | 点击导入，获取当前 API Key 下可用的模型列表 |
| 启用 / 隐藏 | 切换模型可见性——隐藏的模型不出现在 Persona 选择器中 |
| 搜索 | 按名称筛选模型 |

### 模型选项标记

每个模型可携带描述其能力的标记：

| 标记 | 含义 |
|------|------|
| Vision | 接受图片输入 |
| Embedding | 生成向量嵌入 |
| Tool Calling | 支持函数/工具调用 |
| Reasoning | 具备链式推理能力 |
| Context Window | 最大输入上下文长度 |
| Max Output | 最大输出 token 数 |
| Temperature | 是否可配置温度参数 |

## 嵌入模型

必须至少标记一个模型为 **Embedding**，Memory（OpenViking）才能正常工作。嵌入模型将文本转换为向量，用于语义搜索和检索。

如果未标记嵌入模型，Memory 配置页面会显示警告，向量操作将失败。

> [!NOTE] 此处待添加截图。

## 多 Provider

可以添加同一服务商的多个 Provider——例如两个 OpenAI 条目使用不同 API Key（个人 vs. 工作区）。每个 Provider 维护独立的模型列表和凭证。

当同一模型名称出现在多个 Provider 下时，Persona 选择器只显示一次该模型，并通过第一个匹配的 Provider 路由。如需改变路由优先级，在设置中调整 Provider 顺序。
