---
title: 定时任务
description: 按计划触发代理。
---

## 是什么

定时任务让代理按计划周期性运行，无需你在场。适合日报、定期监控、定时签到，以及任何应由时钟触发而非聊天消息触发的工作。

## 创建任务

Settings → **Scheduled Jobs** → **New**。

> [!NOTE]
> 截图占位：定时任务创建表单。

## 配置项

基础字段：

- **Name** 与 **Description**
- **Persona** —— 执行任务的人格
- **Model** —— 本次运行使用的模型
- **Thinking Effort** —— 推理深度
- **Thread** —— 每次运行新建会话，或复用同一会话以累积上下文

## 调度类型

| 类型 | 行为 |
|---|---|
| Interval | 每 N 分钟 / 小时 |
| Daily | 每天某个时刻 |
| Weekdays | 仅周一至周五 |
| Weekly | 每周指定的星期几 |
| Monthly | 每月指定的日期 |
| One-time | 仅执行一次 |
| Cron | 完整 cron 表达式 |

## 高级选项

- **Working Directory** —— 代理启动时所在的工作区路径
- **Timeout** —— 最大运行时长
- **Delete after execution** —— 执行后删除任务（适合一次性任务）

## 启用 / 暂停

每个任务都有启用开关。暂停只停止后续触发，不会删除配置和历史。
