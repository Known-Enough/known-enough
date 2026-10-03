> Historical ticket view. Links follow the current layout; [original bytes](original.md.txt) retain the old paths and evidence. This folder does not schedule work.

# KE00 — Pivot audit and authority reset — closed previous batch

- Status: DONE — user-directed administrative closure, 2026-09-30.
- Claim: Closed for scheduling by the user's new-batch direction; preserve all saved work.

This is administrative closure of the old plan. Prior technical results and unfinished criteria are preserved below; no new check, review PASS, volunteer trial, live qualification or release acceptance is claimed. Remaining technical obligations route to [NP00](../../../active/closeout/NP00/ticket.md). Future product work follows [NP00–NP04](../../../../next-phase.md) and the [shared board](../../../../task-board.md). Reviews, human trials and submission preparation are deferred as mapped there. Historical claims and next-step instructions below cannot select current work.

## Historical ticket record

<!-- pre-NP-original-body -->

# KE00 — Pivot audit and authority reset

- Status: DONE — documentation pivot accepted by the user on 2026-09-26T23:19:42Z.
- Human acceptance: the user confirmed review and acceptance on 2026-09-26T23:19:42Z. This historical sign-off is recorded; the pivot is integrated on synchronized main. Project-level sign-off checkpoints for future work are temporarily deferred by the user's 2026-09-27 direction.
- Claim: finished at 2026-09-26T20:36:07Z; initiating user / A log, Codex GPT-6; exact variant and effort are not exposed. Scheduled architecture choice: `gpt-6-astra` / high; no claim that the session switched models.
- Baseline: clean `main`, `65359ebd19c8ae81007a4b502cce955d5d8ff292`, equal to `origin/main` after successful `git pull --ff-only origin main` on 2026-09-26. No local delta or merge/rebase. Latest tickets record completed claims and B04/B04.5 REVIEW; no active claim is displaced.
- Authorization: user supplied the Known Enough pivot plan and requested execution; its first-session boundary is KE00 only, then human review.
- Scope: README, AGENTS, authority/workflow/board documentation, KE00–KE17 tickets, historical planning banners and exact reference preservation, current integration annotations, A handoff and A log. B log and review evidence remain unchanged. No executable source, tests, configuration, lockfile or application behavior.
- Deliver: product and architecture direction, exact baseline/B04 audit, keep/adapt/legacy/supersede inventory and complete old-task mapping, sequential queue, reviewable follow-on tickets and handoff.
- Checks: local Markdown targets/anchors, task/dependency/status consistency, original reference hashes, original-body preservation and `git diff --check`. Run application checks only if executable scope changes or an integration checkpoint is undertaken.
- Handoff: human acceptance is recorded above. KE01 remains in the shared sequence; the user separately authorized the bounded KE13C hosted-preview task. This acceptance alone does not authorize publication, resource creation, paid calls, or external changes.

Follow the [workflow](../../../../agent-workflow.md) and [task board](../../../../task-board.md).

## Review artifact and checks

Baseline `65359ebd19c8ae81007a4b502cce955d5d8ff292`; review the current local working diff plus all new files listed below. No commit/publication or Git integration was performed. Main still points to the baseline. [Product](../../../../known-enough-product.md), [architecture](../../../../known-enough-architecture.md), [pivot inventory/mapping](../../../../known-enough-pivot.md), [demo](../../../../known-enough-demo.md) and [A handoff](../../../../handoff-A.md) contain the deliverables and next gate.

Fresh evidence, 2026-09-26, actual Codex GPT-6 (variant/effort unexposed):

- Pinned runtime from `/home/martelaxe/.nvm/versions/node/v24.21.0/bin`: Node 24.21.0, npm 11.19.0. The shell default was not used for repository checks; the historical pinned container image was absent, so the installed pinned runtime was used.
- `npm run check:references`: exit 0, all 7 original SHA-256 hashes match. Only two manifest paths moved to exact archived sources; no original hash/checker changed.
- `npm run check:planning`: exit 0, 15/15 historical arithmetic checks. This is not a new application/privacy/security verdict.
- `python3 /tmp/ke00-doc-check.py`: exit 0; checked 696 local links/anchors across all 83 repository Markdown files (zero errors), all 27 old-ticket body suffixes against baseline Git bytes, 11 SUPERSEDED and 16 preserved statuses, KE00–KE17 board/dependency/claim consistency, seven original reference bytes/hashes, two original plan body suffixes, the original queue and exact user attachment copy.
- The same audit verifies every changed/new file is documentation or source evidence and that executable source/tests/config/lockfile, independent review records, B log and B handoff are unchanged.
- `git merge-base --is-ancestor` passed for `2dd036a`, `a058cc5`, `13707c2`, `f6b93bc` and `1c4ea45` against `origin/main`; `git diff --exit-code f6b93bc HEAD -- apps packages tests scripts planning-checks package.json package-lock.json` exited 0. At the time of this audit check, source was integrated and human acceptance was pending; the user later accepted KE00 on 2026-09-26.
- `git diff --check`: exit 0. No active merge/rebase. No `npm run check`/browser/model/cloud run: documentation-only workflow applies, and no integration checkpoint or executable edit occurred.

This is an author documentation self-review, not an independent privacy/security checkpoint. The following was the original KE00 handoff instruction and is superseded by the later user acceptance and 2026-09-27 policy: KE00 is DONE, KE01 is READY for its designated claimant, and B04/B04.5 remain REVIEW but their project-level sign-off no longer blocks KE02. No unstarted old task may bypass the current queue.

### Exact changed files

The manifest includes untracked new files; a plain `git diff` alone omits those files.

```text
AGENTS.md
README.md
docs/Deal-Table-TeamTable-plan.md
docs/Deal-Table-two-developer-architecture.md
docs/agent-workflow.md
docs/contracts.md
docs/decisions.md
docs/friction-log.md
docs/handoff-A.md
docs/known-enough-architecture.md
docs/known-enough-demo.md
docs/known-enough-pivot.md
docs/known-enough-product.md
docs/main-integration.md
docs/reference/README.md
docs/reference/import-checksums.json
docs/reference/known-enough-pivot-request-2026-09-26.txt
docs/reference/pre-pivot/Deal-Table-TeamTable-plan.md.txt
docs/reference/pre-pivot/Deal-Table-two-developer-architecture.md.txt
docs/reference/pre-pivot/task-board-2026-09-26.md.txt
docs/task-board.md
docs/task-execution.md
docs/tasks/A01.md
docs/tasks/A02.5.md
docs/tasks/A02.md
docs/tasks/A03.5.md
docs/tasks/A03.md
docs/tasks/A04.5.md
docs/tasks/A04.md
docs/tasks/A05.5.md
docs/tasks/A05.md
docs/tasks/A06.5.md
docs/tasks/A06.md
docs/tasks/B01.md
docs/tasks/B02.5.md
docs/tasks/B02.md
docs/tasks/B03.md
docs/tasks/B04.5.md
docs/tasks/B04.md
docs/tasks/B05.md
docs/tasks/B06.md
docs/tasks/F00.md
docs/tasks/F01.md
docs/tasks/F02.md
docs/tasks/G01.md
docs/tasks/G02.md
docs/tasks/G03.md
docs/tasks/KE00.md
docs/tasks/KE01.md
docs/tasks/KE02.md
docs/tasks/KE03.md
docs/tasks/KE04.md
docs/tasks/KE05.md
docs/tasks/KE06.md
docs/tasks/KE07.md
docs/tasks/KE08.md
docs/tasks/KE09.md
docs/tasks/KE10.md
docs/tasks/KE11.md
docs/tasks/KE12.md
docs/tasks/KE13.md
docs/tasks/KE14.md
docs/tasks/KE15.md
docs/tasks/KE16.md
docs/tasks/KE17.md
docs/tasks/T01.md
docs/tasks/T02.md
docs/tutorials/local-negotiation.md
docs/work-log-A.md
```
