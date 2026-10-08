# B run logs and chat summaries

The [B monitor log workflow](https://github.com/Known-Enough/known-enough/actions/workflows/b-monitor-log.yml) is the shared receipt ledger. Each run has a readable summary and a downloadable `b-monitor-record` artifact containing `record.json` and `summary.md`, retained for 90 days. It runs independently every 30 minutes and can be inspected without B's computer, Codex chat or AWS credentials. Historical detailed entries remain in [monitor-log.md](monitor-log.md).

A missing reply is itself recorded: **NO_RECENT_REPORT**, with “No published chat answer is available.” This means visibility is missing, not that B refused, crashed or needs another approval. The checker does not claim to read a chat it cannot access. Historical summaries remain explicitly historical.

## Idle-only watchdog clarification — 2026-10-07

Follow [the idle-only watchdog rule](b-idle-watchdog.md). A busy tick must not stop the worker or create a separate documentation-only execution. Preserve the ongoing task/tool/check, coalesce overlapping hints and record skipped timing at its next natural checkpoint. Apply the lifecycle protocol below to actual work/resume executions, not as a requirement to interrupt every thirty minutes. Continue useful work after progress reports. The independent GitHub observer can read public receipts without affecting B's work. B saved idle-only prompt update/readback was verified2026-10-08T00:34:36Z; actual scheduler idle delivery gating remains unverified.

## B's required protocol on actual work or idle-resume execution

1. Before implementation, publish a **started** receipt using the actual heartbeat UTC time, current task/source and a brief planned action. Verify the GitHub log run was accepted. This does not require a main commit or alter an active application test's source.
2. Publish **progress** at a meaningful checkpoint, and at least every ten minutes while a long run remains active. Preserve the original heartbeat time. Inspect existing work instead of starting duplicate tests.
3. Before yielding, publish **finished** with `completed`, `blocked` or `failed` and a sanitized one-to-three-sentence summary, maximum 800 characters. Use the SAME short summary in the final chat answer. Include what was done, what failed or remains unknown, and the next action. “Completed” means the scheduled turn ended, not that the project or tests passed.
4. Append the detailed entry to [monitor-log.md](monitor-log.md), including the receipt link and a **Chat answer summary:** line, and synchronize checked documentation at the next safe checkpoint. Preserve local entries if the source pipeline is active; the independent GitHub receipt must still be published immediately.
5. If publication fails, retain a private local receipt, state the exact sanitized error in chat, and retry once at the next safe checkpoint. Do not hide the failure or reset work. GitHub's independent checker will record the missing report.

Publish with pinned Node and B's own GitHub login:

```bash
node scripts/monitor/log.mjs publish started /private/path/run-summary.json
node scripts/monitor/log.mjs publish progress /private/path/run-summary.json
node scripts/monitor/log.mjs publish finished /private/path/run-summary.json
```

The file is a private temporary JSON file, not a committed transcript. Change `result` to `working` for started/progress, and use the true outcome for finished. Use the real current commit and heartbeat time; this example must not be published as real evidence:

```json
{
  "scheduled_at": "2026-10-04T23:11:08.572Z",
  "task": "ASSESS07",
  "result": "failed",
  "source_sha": "0000000000000000000000000000000000000000",
  "chat_summary": "I checked the latest decision test. Confirmation still fails; next I will inspect which confirmation is missing."
}
```

The helper verifies B's numeric GitHub identity and requests the logging workflow. Check the resulting [workflow run](https://github.com/Known-Enough/known-enough/actions/workflows/b-monitor-log.yml) before claiming the receipt was stored; dispatch acceptance alone is not completion. This logging workflow has only repository/actions read permission and performs no deployment, test dispatch, AWS operation, paid call or email. It never commits to main or writes B's checkout.

## What the independent checker verifies

The checker reads recent completed, successful logging runs from verified B on main and validates their stored lifecycle receipts. Every independent check writes its own timestamp, latest known worker report, outcome, short chat-summary field and summary provenance. After 45 minutes without a current receipt it records **NO_RECENT_REPORT**; an unfinished start also ages into this state. Observation/API errors retain a **LOGGER_ERROR** fallback and visible failed GitHub job. Original report history is preserved.

This observes published evidence, not B's hidden session. A reply B never produced cannot be summarized; unavailable replies are labeled explicitly. GitHub's Actions run history remains visible even if a job cannot upload its artifact. [GitHub schedules can be delayed or dropped](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), so this provides a durable independent record when GitHub executes the check, not an absolute uptime guarantee.

[Official scheduled-task documentation](https://learn.chatgpt.com/docs/automations) explains that local project tasks need their computer and app running. No such outage is established here. B's own automation history/local logs are still needed to explain the previously missing wake-ups.


## OPS01 CODE_READY and checked claim release — 2026-10-08T00:35:35.125989+00:00

B releases the sole OPS01 coding claim after checked [source 6684418ec777a49025292361e98e1e7fea4047e3](https://github.com/Known-Enough/known-enough/commit/6684418ec777a49025292361e98e1e7fea4047e3) explicitly pushed/fetched clean equal main/origin at 2026-10-08T00:33:20.868838+00:00. Available inactive partition/storage/session/decision/HTTP/migration/archive/managed-driver/runtime/configuration coding is CODE_READY; whole task REVIEW/unclaimed pending mandatory final-cloud installation/managed acceptance, not DONE. Final frozen364 focused15files,48 native operations and pinned full1148 application(two optional skips)/hosted1/browser62 PASS; full00:29:32.199010Z–00:32:48.242283Z, exit0,13 frozen hashes unchanged.56 new app regressions32managed/24runtime and6 native setup checks. Source/type/fixture/lint corrections and historical partial failures preserved; no technical guard or check waived. Next eligible coding task is OPS02 retention/export/authorized erasure, READY/unclaimed. No successor implementation or second active worker starts in this handoff. A NP00 PAUSED/saved source/private recovery/excluded files/history remains untouched.

Remaining exact managed obligations: retained table/profile installation and effective-role/identity/resource readback; source-exact verified operations runner/runtime selection configuration; immutable private recovery readback, journaled copy/freeze/activation/cutover; real managed restart/concurrency/archive/privacy/consent/service/usage/cleanup proof. All remain UNKNOWN/deferred under coding-first. Inactive factories/configuration and offline checks are not installed migration/PASS. See checked managed-closeout.md with interfaces, resource/key contracts and final-cloud sequencing; no public archive route, participant consent bypass or old-data restoration promise.

Actual automation tool update at the natural coding handoff updated ONLY watch-known-enough-shared-queue. Saved readback 2026-10-08T00:34:36.537858+00:00 verifies exact idle-only durable prompt, ACTIVE/30minutes/same chat01a1086a-fb98-7552-b4d1-e2dbab01a404 and all other saved fields unchanged; exactly one automation file. No host/environment/model/effort/notification override was supplied, and those unexposed fields were not invented. Native view rendered a card only; filesystem readback supplies the configuration proof. Tool exposes no actual idle-delivery gate and official documentation does not establish one: scheduler idle gating UNKNOWN, new-prompt busy/idle behavior NOT_YET_OBSERVED. Four busy hints in this execution coalesced under human direction; they arrived before saved prompt update and do not verify post-update scheduler behavior or prove the timer caused the earlier gap. OpenAI Docs skill applied to this bounded update; [official scheduled-task documentation](https://learn.chatgpt.com/docs/automations) fetched, no unrelated goal/new automation created.

Actual observed tool gap22:36:14Z–00:19:08Z(102m54s), successful receipt gap22:35:11Z–00:19:11Z(104m). Cause/unobserved activity UNKNOWN; ten-minute progress publication failed in that interval, not concealed as continuous coding. Started/progress receipts37695496493/37696334151/37697120290/37707129265/37707750916/37708411908 all SUCCESS with downloaded artifact actor/main/event/task/schedule/source/summary verification. Publication resumed before subsequent coding/checks. No observed GitHub/platform/approval denial; local stale-SHA/missing-payload first start failure did not dispatch a run. Final in-progress GitHub list empty; no duplicate remote tests/deployments/workers. Next nominal idle-watchdog hint2026-10-08T00:48:49.718Z; actual delivery/runtime gate UNKNOWN. Continue same claim only if unfinished coding is newly evidenced; otherwise clean ff-only/claim check then claim OPS02. Detailed monitor143 and finished receipt follow verified release synchronization.
