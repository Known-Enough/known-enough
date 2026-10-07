# B run logs and chat summaries

The [B monitor log workflow](https://github.com/Known-Enough/known-enough/actions/workflows/b-monitor-log.yml) is the shared receipt ledger. Each run has a readable summary and a downloadable `b-monitor-record` artifact containing `record.json` and `summary.md`, retained for 90 days. It runs independently every 30 minutes and can be inspected without B's computer, Codex chat or AWS credentials. Historical detailed entries remain in [monitor-log.md](monitor-log.md).

A missing reply is itself recorded: **NO_RECENT_REPORT**, with “No published chat answer is available.” This means visibility is missing, not that B refused, crashed or needs another approval. The checker does not claim to read a chat it cannot access. Historical summaries remain explicitly historical.

## Idle-only watchdog clarification — 2026-10-07

Follow [the idle-only watchdog rule](b-idle-watchdog.md). A busy tick must not stop the worker or create a separate documentation-only execution. Preserve the ongoing task/tool/check, coalesce overlapping hints and record skipped timing at its next natural checkpoint. Apply the lifecycle protocol below to actual work/resume executions, not as a requirement to interrupt every thirty minutes. Continue useful work after progress reports. The independent GitHub observer can read public receipts without affecting B's work. Actual B-side idle gating/update remains unverified.

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
