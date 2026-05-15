---
title: Scheduled Jobs
description: Trigger your agent on a schedule.
---

## What it is

Scheduled jobs run an agent on a recurring schedule without you being present. Use them for daily reports, periodic monitoring, check-ins, or any task that should fire on a clock instead of from a chat message.

## Create a job

Settings → **Scheduled Jobs** → **New**.

> [!NOTE]
> Screenshot: scheduled job creation form.

## Configuration

Basic fields:

- **Name** and **Description**
- **Persona** — which persona executes the job
- **Model** — the model used for this run
- **Thinking Effort** — reasoning depth
- **Thread** — start a new thread per run, or reuse a fixed thread so context accumulates

## Schedule types

| Type | Behavior |
|---|---|
| Interval | Every N minutes / hours |
| Daily | Every day at a specific time |
| Weekdays | Mon–Fri only |
| Weekly | Specific day(s) of week |
| Monthly | Specific day of month |
| One-time | Single execution |
| Cron | Full cron expression |

## Advanced

- **Working Directory** — workspace path the agent starts in
- **Timeout** — maximum run duration
- **Delete after execution** — remove the job once it has run (useful for one-time jobs)

## Enable / pause

Each job has an enable toggle. Pausing a job stops future triggers without deleting its configuration or history.
