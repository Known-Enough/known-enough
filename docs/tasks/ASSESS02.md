# ASSESS02 — Admission and roster transactions

- Status: DONE — local transaction fences; managed evidence ASSESS07
- Findings: FA03, FA09; [assessment](../full-assessment.md).
- Worker: B / Battosai1806 / Windows-WSL separate clone; actual Codex GPT-6, variant/effort unexposed. No subagents.
- Baseline: 348afae8270eb739a89ab974c85a89e1526f06d9; clean ff-only main after preserving incoming A import-tag repair.
- Authorization: user explicitly assigned all local assessment fixes to B on 2026-10-01, including primary/budget/workflow scope; A retains cloud operations and NP00. Existing A evidence/private installation state is preserved. Work is sequential in this chat.

## Bounded scope and completion

apps/api/src group/HTTP services; application and repository admission guards; focused concurrency tests, this ticket, assessment resolution register and own B log/handoff. Shared board/workflow only for the approved routing amendment.

Reject delayed work after account/member revocation and keep decision roster/group binding consistent under failure and retry.

Focused permanent regressions, pinned npm run check, self-inspection, factual handoff and explicit origin main synchronization using [skip ci]. DONE means local implementation criteria passed, not AWS/service acceptance. Required real checks go to [ASSESS07](ASSESS07.md). Record exact amended scope before additional files. No cloud write, deployment, paid call, personal credential use or external message.

## Claim — 2026-10-02T06:25Z

B / Battosai1806, actual GPT-6 variant/effort unexposed; clean ff-only main 0b625fd. Exact implementation amendment: new server-only admission context adapter; group repository fence/CAS composition; in-memory and DynamoDB decision repository commits/creation; group-service and group-decisions admission/roster coordination; HTTP async request scope and model-job async context binding; own primary/QA group ConditionCheck permission; new signed local concurrency and mocked-DynamoDB regressions. No NP00 inspector/model-disable source, application runtime policy or A records. Creation and roster updates must share the same admission transaction fence; another read alone is insufficient. Separate local implementation and actual managed proof ASSESS07.

## Completed contract and evidence

Server-only async request context captures an admission fence after verified group/account checks. The whole group aggregate storage version changes on admission/membership mutations. Each in-memory decision operation holds the group lock, checks that version and commits under the same lock; DynamoDB writes/creation include the exact group-version ConditionCheck in their STATE/GUARD/REPLAY transaction. Roster revision instead adds the conditionally versioned group binding Put to that transaction, eliminating the second independent commit. Creation and roster review have explicit fences too. Mixed memory/DynamoDB storage compositions fail closed. Queued model tasks and pre/post invocation checks preserve their originating async context.

Reads linearize at a validated repository operation; a response already authorized before disable may finish delivery. Pending reads delayed until after revocation are rejected. Delayed model output cannot commit after any captured admission-version change. Unrelated group aggregate changes conservatively require retry; per-group partitioning is still ASSESS06 scope, not solved by this fence. No fence or private group state enters browser payloads/logs.

The primary/QA runtime group policy adds only dynamodb:ConditionCheckItem on its existing group resource/key. AWS confirms transactional permissions use the underlying item actions and ConditionCheckItem: [transaction IAM documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html). Installation/readback remains ASSESS07/08.

11 new regressions pass: delayed private read, disable/remove during owner generation, creation revocation, roster failure/retry/consent reset, mocked commit-time revocation, coordinated group/decision atomic success/cancellation, creation cancellation, incompatible composition and queued context isolation. Full pinned check passed exit 0: 570 application tests plus two optional DynamoDB Local skips, hosted 1/1, E2E 53/53, references 7/7, planning 15/15, lint/types/boundaries/build. Final composition guards and two extra regressions: fresh 11/11, lint/types pass. Log /tmp/known-enough-assess02-check.log. No cloud operation or live acceptance.
