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

Status: **B-side idle-only prompt updated and saved configuration verified2026-10-08T00:34:36Z; actual scheduler idle gating and post-update busy/idle behavior remain UNKNOWN**. No claim, source runtime, cloud operation or budget is changed here.


## OPS01 CODE_READY and checked claim release — 2026-10-08T00:35:35.125989+00:00

B releases the sole OPS01 coding claim after checked [source 6684418ec777a49025292361e98e1e7fea4047e3](https://github.com/Known-Enough/known-enough/commit/6684418ec777a49025292361e98e1e7fea4047e3) explicitly pushed/fetched clean equal main/origin at 2026-10-08T00:33:20.868838+00:00. Available inactive partition/storage/session/decision/HTTP/migration/archive/managed-driver/runtime/configuration coding is CODE_READY; whole task REVIEW/unclaimed pending mandatory final-cloud installation/managed acceptance, not DONE. Final frozen364 focused15files,48 native operations and pinned full1148 application(two optional skips)/hosted1/browser62 PASS; full00:29:32.199010Z–00:32:48.242283Z, exit0,13 frozen hashes unchanged.56 new app regressions32managed/24runtime and6 native setup checks. Source/type/fixture/lint corrections and historical partial failures preserved; no technical guard or check waived. Next eligible coding task is OPS02 retention/export/authorized erasure, READY/unclaimed. No successor implementation or second active worker starts in this handoff. A NP00 PAUSED/saved source/private recovery/excluded files/history remains untouched.

Remaining exact managed obligations: retained table/profile installation and effective-role/identity/resource readback; source-exact verified operations runner/runtime selection configuration; immutable private recovery readback, journaled copy/freeze/activation/cutover; real managed restart/concurrency/archive/privacy/consent/service/usage/cleanup proof. All remain UNKNOWN/deferred under coding-first. Inactive factories/configuration and offline checks are not installed migration/PASS. See checked managed-closeout.md with interfaces, resource/key contracts and final-cloud sequencing; no public archive route, participant consent bypass or old-data restoration promise.

Actual automation tool update at the natural coding handoff updated ONLY watch-known-enough-shared-queue. Saved readback 2026-10-08T00:34:36.537858+00:00 verifies exact idle-only durable prompt, ACTIVE/30minutes/same chat01a1086a-fb98-7552-b4d1-e2dbab01a404 and all other saved fields unchanged; exactly one automation file. No host/environment/model/effort/notification override was supplied, and those unexposed fields were not invented. Native view rendered a card only; filesystem readback supplies the configuration proof. Tool exposes no actual idle-delivery gate and official documentation does not establish one: scheduler idle gating UNKNOWN, new-prompt busy/idle behavior NOT_YET_OBSERVED. Four busy hints in this execution coalesced under human direction; they arrived before saved prompt update and do not verify post-update scheduler behavior or prove the timer caused the earlier gap. OpenAI Docs skill applied to this bounded update; [official scheduled-task documentation](https://learn.chatgpt.com/docs/automations) fetched, no unrelated goal/new automation created.

Actual observed tool gap22:36:14Z–00:19:08Z(102m54s), successful receipt gap22:35:11Z–00:19:11Z(104m). Cause/unobserved activity UNKNOWN; ten-minute progress publication failed in that interval, not concealed as continuous coding. Started/progress receipts37695496493/37696334151/37697120290/37707129265/37707750916/37708411908 all SUCCESS with downloaded artifact actor/main/event/task/schedule/source/summary verification. Publication resumed before subsequent coding/checks. No observed GitHub/platform/approval denial; local stale-SHA/missing-payload first start failure did not dispatch a run. Final in-progress GitHub list empty; no duplicate remote tests/deployments/workers. Next nominal idle-watchdog hint2026-10-08T00:48:49.718Z; actual delivery/runtime gate UNKNOWN. Continue same claim only if unfinished coding is newly evidenced; otherwise clean ff-only/claim check then claim OPS02. Detailed monitor143 and finished receipt follow verified release synchronization.
