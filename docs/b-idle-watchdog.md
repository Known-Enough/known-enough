# B monitor: recover idle work, never interrupt active work

User clarification, 2026-10-07: the existing 30-minute monitor should act only when B is not doing a task. Thirty minutes is a watchdog cadence, not a work or documentation deadline.

## Evidence and limits

Older instructions require reporting on every scheduled wake; logs show overlapping wakes and delayed receipts. They do not prove the timer cancelled a running command or caused the unexplained gap. A's automation view rendered a card without exposing saved fields, and A's local automation files contain no matching B configuration. This repository handoff is not an installed scheduler update.

## Required idle-only behavior

- While B is actively coding, reasoning, running checks or waiting on an existing owned tool/test/deployment, skip watchdog intervention. Do not interrupt, send another resume prompt, spawn a worker, duplicate checks or end a turn solely to document a tick.
- When genuinely idle with an unfinished claim, resume the SAME task in the SAME persistent chat. Use actual chat/tool/job activity; an IN_PROGRESS ticket or old commit alone does not establish whether the worker is busy.
- When idle and unclaimed, claim exactly one eligible coding phase under the current queue. Administrator setup remains deferred.
- When activity is unknown, inspect existing evidence without launching competing work or inferring a crash. Coalesce overlapping/stale ticks; do not replay multiple work/reporting turns or backdate activity.
- Record skipped/delayed tick timestamps together at the next natural checkpoint. They are not work executions or evidence that earlier work happened. Do not invent unsupported workflow event/result values.

Continue useful work until the claimed coding phase reaches its verified handoff criteria, a genuine blocker/platform limit or a human stop. Progress logging does not require stopping work. Keep started/progress/finished receipts for actual work or idle-resume executions and truthful summaries at natural checkpoints. Older every-wake reporting instructions do not require documentation-only interruptions.

## B-side application at a safe idle checkpoint

Inspect and update the SAME `watch-known-enough-shared-queue` automation using the automation tool on B's own host. Preserve its 30-minute schedule, persistent chat, host/environment, model/effort, notification preferences and one-task policy. Do not stop the current task just to reconfigure it, create an A monitor or replace B's chat/automation.

If the scheduler cannot gate delivery on actual idle state, record that limitation. Prompt-only changes are not proof of non-interrupting delivery. A same-chat busy wake is a watchdog hint: continue the current task rather than starting a separate reporting-only turn. Verify saved configuration/readback and actual busy-tick/idle-resume behavior before claiming this works.

Durable prompt intent: “This is an idle-only recovery watchdog. Preserve active B work. When busy, skip intervention and let the same worker continue; when genuinely idle, resume its claim or take exactly one eligible coding task. Never stop at the 30-minute mark or merely to report. Coalesce overlapping ticks. Keep truthful checkpoint logs, existing context/credentials/privacy/consent, coding-first order and current notification preferences.”

Status: **required behavior documented; B-side automation update and busy/idle verification pending**. No claim, source runtime, cloud operation or budget is changed here.
