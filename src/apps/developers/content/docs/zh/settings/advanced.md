---
title: 高级
description: 数据、网络、用量、日志和模块管理。
---

Advanced 集中了与运行时、网络和本地数据相关的全部入口。

> [!NOTE]
> 截图占位：高级设置首页。

## 数据

按类别选择性导入导出，迁移时由你决定带走什么。

可选类别：

- 设置
- Providers
- 聊天记录
- Personas
- Projects
- MCP 服务器
- 主题

路径：`Settings -> Advanced -> Data -> Import` / `Export`

## 网络

- 代理：HTTP / HTTPS / SOCKS5，可选鉴权
- 超时：单请求与流式各自配置
- 重试策略：最大次数与退避
- User-Agent：覆盖发往 provider 的 UA 字符串

公司代理或需要走区域网关访问 provider 时使用。

## 用量

- 月度快照
- 按模型拆分的 token 消耗
- 按日 / 小时的活跃热力图
- 消费趋势曲线

数据全部从本地 run 历史计算得出。

## 日志

- 主进程：Desktop 外壳
- Sidecar 日志：API、Worker、Bridge 以及各模块 sidecar

支持文本搜索和级别过滤，可复制片段用于 bug 反馈。

## 模块

可选的 sidecar，提供额外能力，可独立安装、卸载、更新。

- Sandbox：代码执行
- Memory (OpenViking)：语义记忆
- SearXNG：元搜索后端
- Firecrawl：网页抓取与爬取
- Agent Browser：供 agent 使用的无头浏览器

模块占用磁盘和内存，按需安装。
