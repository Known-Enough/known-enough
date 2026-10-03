# Known Enough — pivot and migration record

KE00, 2026-09-26. The user supplied the AI-first product pivot and explicitly limited its first execution to this audit/documentation task, then human review. Known Enough becomes the product direction; TeamTable becomes historical evidence and a regression scenario. Preserve durable engineering rather than rewrite it.

**Policy update, 2026-09-27:** project-level human acceptance/sign-off checkpoints are temporarily deferred at the user's direction. Keep recorded statuses and evidence accurate; B04/B04.5 stay REVIEW but their sign-off no longer blocks KE02. Continue to require participant permissions/approvals, named independent technical reviews and explicit authorization for cloud, spending or publication actions. The current queue and workflow supersede sign-off dependencies below that conflict with this update; dated audit notes remain historical.

## Authority and evidence

1. Current explicit user instructions govern scope and authorization. The September 26 pivot supersedes old product/domain restrictions; the September 22/23 single shared queue and sequential claims remain.
2. [AGENTS](../AGENTS.md) and [workflow](agent-workflow.md) govern execution. The [board](task-board.md) orders work; tickets own requirements, status and claims. No parallel implementation/review and no automatic publication or spending.
3. [Known Enough product](known-enough-product.md) and [architecture](known-enough-architecture.md) govern new product/architecture work. This record governs migration mapping; [demo direction](known-enough-demo.md) governs the proposed narrative.
4. [Executable contracts](../packages/contracts/src/index.ts), [contract baseline](contracts.md), [decisions](decisions.md), source and tests describe implemented behavior. New direction does not retroactively change old wire semantics or prove implementation.
5. [TeamTable plan](Deal-Table-TeamTable-plan.md), [two-developer plan](Deal-Table-two-developer-architecture.md), old tickets, review records, logs and fixture evidence retain historical scope. Their obsolete product, ownership, branch and queue instructions do not schedule new work.

The two imported plans receive prominent historical banners, with their entire prior body retained byte-for-byte. Exact pre-banner originals are preserved as `.md.txt` source artifacts in [pre-pivot references](reference/pre-pivot); the seven-entry [checksum manifest](reference/import-checksums.json) redirects only those two paths and retains every original SHA-256. The checker itself, other five references and historical arithmetic stay unchanged. New bannered views are not mislabeled as the originally hashed imports. KE00 verifies both archived bytes and unchanged view bodies against baseline Git objects.

## Exact synchronized baseline

| Observation | Evidence/result |
| --- | --- |
| Checkout | `/home/martelaxe/known-enough`, branch `main`, clean before claim; no merge/rebase |
| Required synchronization | `git pull --ff-only origin main` succeeded: already up to date |
| HEAD and origin/main | `65359ebd19c8ae81007a4b502cce955d5d8ff292`; ahead/behind `0 / 0` |
| Latest tracking | `65359eb` board reconciliation, `c583717` B04 acceptance status, `1c4ea45` independent correction PASS |
| Invitation source | `13707c2794491666989059cf23dcaa8bcd7e2075`; R11/R12 correction `f6b93bc77ecf7b0680a1abcab4bc99d7fa836515` |
| Source relation | `f6b93bc` is an ancestor of origin/main; executable apps/packages/tests/scripts/planning/manifests/lock unchanged between that correction and baseline |
| Claim state | B04/B04.5 latest claims finished, both REVIEW; A05 preparation REVIEW. No current IN_PROGRESS/PAUSED task is displaced. Older embedded claims are dated evidence |
| Actual KE00 worker | Codex GPT-6, exact variant/effort unexposed; initiating user / A log. Scheduled Astra/high class is not claimed as runtime telemetry |

This inspection establishes this clone and fetched shared history only. It does not discover another user's unshared work or authorize access to their account. Claim is communicated through the current user session and local ticket/log, not a published remote lock.

## B04 foundation: integrated source and retained REVIEW status

Both former B04 lines are retained by merge `2dd036a`: the selected implementation is the strict multi-item STATE/GUARD/REPLAY adapter. The alternate single-item design remains in Git history; do not resurrect it as another active implementation. Export/lock correction `a058cc5`, invitations `13707c2`, fixes `f6b93bc` and review record `1c4ea45` are all ancestors of synchronized main. There is **no local-only B04 source delta in this checkout** and no missing B04 branch to integrate.

Earlier records saying “local/unpushed” or “paused for review” describe their date, not September 26 state. Preserve them and add current annotations. B04/B04.5 remain REVIEW. Under the September 27 direction, project sign-off is deferred and no longer blocks KE02; retained technical evidence does not establish production readiness or a new integration-check verdict.

Latest [independent B04.5 evidence](reviews/B04.5.md) is PASS on `04bd1db..f6b93bc`, closing R11/R12. Recorded reviewer results: 87/87 focused tests, DynamoDB Local 1/1, nine failure-path combinations and authorization probes, typecheck, seven reference hashes and 15 arithmetic checks. The author's full-check summary reports 232 unit/integration passes plus one emulator skip and 41/41 browsers after serial fallback; raw full output was unavailable to that reviewer. These are **historical results inspected by KE00**, not fresh tests run here.

Open at the September 26 audit: project sign-off for retained B04/B04.5 local scope; managed Cognito/DynamoDB/IAM and operational evidence; production migration/retention; trusted invitation provisioning/delivery and response-loss recovery. On September 27, the user deferred project sign-off; KE02 may use the retained B04/B04.5 technical baseline after KE01 without waiting for that sign-off. Any new critical code gets independent follow-up. No push or deployment was part of KE00.

## File and package inventory

KEEP means preserve the mechanism, not certify every current implementation detail for larger generic records. ADAPT requires a bounded migration with compatibility evidence.

| Disposition | Exact files/packages | Durable value or required change | New work |
| --- | --- | --- | --- |
| KEEP | [cognito-identity.ts](../apps/api/src/cognito-identity.ts), [identity tests](../apps/api/src/cognito-identity.test.ts), [signed-token integration](../tests/integration/cognito.test.ts) | Verified JWT subject, distinct participant/display scopes, redacted verifier failure; no mock authentication claim | KE03, KE11, KE13 |
| KEEP / ADAPT | [http-core.ts](../apps/api/src/http-core.ts), [application](../packages/application/src/index.ts), [HTTP tests](../tests/integration/http.test.ts) | Auth-before-parse/replay, scoped errors, subject-bound issue/redemption, expiry; generic routes/frame and provisioning need design | KE03, KE11 |
| KEEP / ADAPT | [dynamodb.ts](../packages/adapters/src/dynamodb.ts), [codec](../packages/adapters/src/dynamodb-codec.ts), [repository tests](../tests/integration/dynamodb-repository.test.ts), [emulator test](../packages/adapters/src/dynamodb.local.test.ts) | STATE/GUARD/REPLAY transactions, bounded retries, byte/receipt reservations and safe refusal/revocation; version domain payloads and re-prove bounds | KE02, KE03, KE13 |
| KEEP / ADAPT | [application types](../packages/application/src/types.ts), [application tests](../packages/application/src/application.test.ts), [integration](../tests/integration/application.test.ts) | Semantic/control versions, idempotency, independent permissions, exact approval, stale-job checks; RoomRecord/readiness/solver port are schedule-specific | KE01–KE04, KE08 |
| ADAPT | [contracts](../packages/contracts/src/index.ts), [contract tests](../packages/contracts/src/contracts.test.ts), [examples](examples/command-results.json) | Strict public/owner allowlists and canonical public hash preserved; PublicRoomSnapshot, ExceptionScope, owner inputs and proposal become generic with legacy compatibility | KE01, KE02, KE04 |
| ADAPT | [App.tsx](../apps/web/src/App.tsx), [public screen](../apps/web/src/public-screen.tsx), [owner screen](../apps/web/src/owner-screen.tsx), [input form](../apps/web/src/initial-input-form.tsx) | Generic creation/lobby/proposal surfaces, understandable confirmation; default calendar/duty assumptions removed later | KE05–KE08 |
| KEEP / ADAPT | [command client](../apps/web/src/command-client.ts), [local client](../apps/web/src/local-api-client.ts), [styles](../apps/web/src/style.css), [browser tests](../tests/e2e) | Unknown-outcome retry discipline, stale refresh, independent receipts, keyboard/mobile/reduced motion | KE05, KE07, KE11 |
| KEEP / ADAPT | [A05 extractor](../apps/web/src/owner-draft-extractor.ts), [owner mock tests](../apps/web/src/owner-mock-adapter.test.ts), [A05 browser tests](../tests/e2e/a05.spec.ts) | Reviewed confirmation invalidation and fallback patterns; current single-sentence browser simulation is not a real parser | KE07, KE10 |
| LEGACY / REGRESSION | [domain enumerate](../packages/domain/src/enumerate.ts), [solve](../packages/domain/src/solve.ts), [validation](../packages/domain/src/validation.ts), [solver tests](../packages/domain/src/solver.test.ts) | Deterministic meeting/duty benchmark and two rankings; never the new product's primary intelligence | KE04 |
| LEGACY / REGRESSION | [TeamTable fixture](../packages/test-support/src/teamtable-fixture.ts), [fixture tests](../packages/test-support/src/teamtable-fixture.test.ts), [demo](../packages/test-support/src/demo.ts), [planning arithmetic](../planning-checks/teamtable-fixture-check.mjs) | Preserve 12/0/2 counts and rankings; separate old evidence from new scenario validation | KE04, KE14 |
| LEGACY / REGRESSION | [public mocks](../apps/web/src/mocks/public), [storyboard](reference/deal-table-teamtable.html), [local tutorial](tutorials/local-negotiation.md), [verification](verification.md), [reviews](reviews/README.md) | Honest synthetic/connected-local provenance; keep legacy routes as tests require | KE04, KE05, KE16 |
| KEEP | [package manifest](../package.json), [lockfile](../package-lock.json), [CI](../.github/workflows/check.yml), [boundaries](../scripts/check-boundaries.mjs), [bundle scan](../scripts/check-bundle.mjs), [reference checker](../scripts/check-references.mjs) | Pinned Node/npm, reproducible checks, browser/server separation; no technical package rename in KE00 | All tasks |
| ADAPT / IMPLEMENT LATER | [workers boundary](../apps/workers/README.md), [infra design](../infra/README.md), [B05](tasks/historical/previous-batches/B05/ticket.md), [B06](tasks/historical/previous-batches/B06/ticket.md) | Reuse job/SQS and IAM/operations concepts; workers/SQS/Bedrock/deployment are not implemented services | KE10, KE13 |
| KEEP | [workflow](agent-workflow.md), [review records](reviews/README.md), [A log](work-log-A.md), [B log](work-log-B.md) | Single writer, exact-artifact independent reviews and human acceptance; preserve provenance | All tasks |

## Complete old-task mapping

All 27 pre-pivot tickets were inspected. DONE remains DONE for its original scope; REVIEW is not silently accepted or converted to SUPERSEDED. Only the eleven unstarted future tickets listed below become SUPERSEDED. Their original planning bodies are retained beneath a current banner.

| Old task | Baseline → pivot status | Disposition and destination |
| --- | --- | --- |
| [F00](tasks/historical/previous-batches/F00/ticket.md) | DONE → DONE | Preserve imported foundation/reference evidence |
| [F01](tasks/historical/previous-batches/F01/ticket.md) | DONE → DONE | Preserve workspace/tooling/CI |
| [F02](tasks/historical/previous-batches/F02/ticket.md) | DONE → DONE | Preserve strict v1 baseline; generic contracts KE01 |
| [A01](tasks/historical/previous-batches/A01/ticket.md) | DONE → DONE | Keep UI scaffold; adapt shell KE05 |
| [B01](tasks/historical/previous-batches/B01/ticket.md) | DONE → DONE | Keep deterministic legacy benchmark; KE04 |
| [B02](tasks/historical/previous-batches/B02/ticket.md) | DONE → DONE | Keep command/consent mechanics; KE02/KE03 |
| [B02.5](tasks/historical/previous-batches/B02.5/ticket.md) | DONE → DONE | Preserve exact reviewed artifact; changed boundaries KE09 |
| [B03](tasks/historical/previous-batches/B03/ticket.md) | REVIEW → REVIEW | Retain HTTP implementation/evidence; generic adaptation KE03/KE11; old acceptance not inferred |
| [G01](tasks/historical/previous-batches/G01/ticket.md) | DONE → DONE | Accepted local TeamTable checkpoint only |
| [A02](tasks/historical/previous-batches/A02/ticket.md) | REVIEW → REVIEW | Retain forms/client; adapt KE05/KE07/KE11; pending human acceptance preserved |
| [A03](tasks/historical/previous-batches/A03/ticket.md) | REVIEW → REVIEW | Retain receipts/accessibility; KE05/KE07 |
| [A03.5](tasks/historical/previous-batches/A03.5/ticket.md) | REVIEW → REVIEW | Retain preparation/A05 privacy PASS; new boundaries KE09 |
| [A02.5](tasks/historical/previous-batches/A02.5/ticket.md) | REVIEW → REVIEW | Preserve local integration evidence and G01; new sessions KE11 |
| [B04](tasks/historical/previous-batches/B04/ticket.md) | REVIEW → REVIEW | Retained identity/storage technical baseline; project sign-off deferred; adapt KE03/KE11/KE13 |
| [B04.5](tasks/historical/previous-batches/B04.5/ticket.md) | REVIEW → REVIEW | Preserve latest independent correction PASS; project sign-off deferred |
| [A05](tasks/historical/previous-batches/A05/ticket.md) | REVIEW → REVIEW | Reviewed mock draft UX retained for KE07/KE10; no live extraction claim |
| [A04](tasks/historical/previous-batches/A04/ticket.md) | READY → SUPERSEDED | Session/reconnect preparation moves to KE11 |
| [A04.5](tasks/historical/previous-batches/A04.5/ticket.md) | BLOCKED → SUPERSEDED | Real authenticated browser acceptance moves to KE11 |
| [B05](tasks/historical/previous-batches/B05/ticket.md) | BLOCKED → SUPERSEDED | Bedrock/jobs and safe routing move to KE10 |
| [A05.5](tasks/historical/previous-batches/A05.5/ticket.md) | BLOCKED → SUPERSEDED | Owner confirmation and live extraction move to KE07/KE10 |
| [B06](tasks/historical/previous-batches/B06/ticket.md) | BLOCKED → SUPERSEDED | AWS deployment/operations move to KE13 |
| [T01](tasks/historical/previous-batches/T01/ticket.md) | READY → SUPERSEDED | Bounded facilitator design expands into KE01/KE06/KE08/KE12 |
| [T02](tasks/historical/previous-batches/T02/ticket.md) | BLOCKED → SUPERSEDED | AI implementation/evaluations move to KE06/KE08/KE10/KE12 |
| [A06](tasks/historical/previous-batches/A06/ticket.md) | READY → SUPERSEDED | Preparation moves to KE14/KE15/KE16 |
| [A06.5](tasks/historical/previous-batches/A06.5/ticket.md) | BLOCKED → SUPERSEDED | Trials/recording move to KE14/KE15/KE16 |
| [G02](tasks/historical/previous-batches/G02/ticket.md) | BLOCKED → SUPERSEDED | KE09 plus mandatory post-model/session/cloud follow-up before external testers |
| [G03](tasks/historical/previous-batches/G03/ticket.md) | BLOCKED → SUPERSEDED | KE17 release gate |

Retained REVIEW tickets remain acceptance records, not an instruction to finish obsolete product requirements. Resolve retained evidence/acceptance explicitly. Changed implementation belongs to a bounded KE ticket and renewed critical review.

## Decisions and migration risks to resolve

| Decision/risk | Required resolution | Owner task |
| --- | --- | --- |
| B04 source and review evidence | Source and local review evidence already integrated; retain REVIEW status and do not infer live cloud readiness | Use technical baseline in KE02; project sign-off deferred |
| Generic type/rule vocabulary | Small closed subset supporting Christmas, purchase and legacy bridge; unknown/unsupported fails closed; size/depth bounds | KE01, KE02 design review |
| Frame authority/readiness | Who confirms which frame facts; exact revision/roster quorum and stale behavior; no silent organizer policy change | KE01, KE03 |
| Qualitative constraints | Clarify or explicitly represent unsupported constraints; never claim all hard needs verified from numeric checks alone | KE01, KE07, KE08 |
| Currency/date/hash semantics | Units, currency, rounding, precision, timezone, duration, list order and exact public approval facts | KE01 |
| Candidate/disclosure boundary | Decide public vs owner-only proposal fields (including individual purchase contributions); public explanations cannot carry private-context prose | KE01, KE08, KE09 |
| Refusal/no-pressure | Identify equivalent requests, prevent paraphrase retries and bound repair/question rounds | KE01, KE03, KE08 |
| Stored data and capacities | STATE v4 hardcodes three members; choose compatibility/versioning/migration and re-prove counts, replay/history and pending-response byte reservations for five or more | KE02 design, KE03, KE04 |
| Invitation provisioning/recovery | Current pre-provisioned subject binding, response loss and reissue/redeem limits need explicit session UX and trusted delivery design | KE11 |
| Model context/retention | Separate memory/cache/job boundaries; minimize raw explanations; define deletion/backup limits | KE07, KE09, KE10 |
| Ranking/claims | AI heuristic preferences need approved criteria and evidence; avoid unsupported “best”/optimality claims | KE08, KE12, KE14 |
| Model/cloud/track availability | Verify current official capabilities/rules and actual model/region; spending/deployment separately authorized | KE10, KE13, KE16, KE17 |

## KE00 handoff and next start

Current reviewable artifact is the local documentation diff over the exact baseline above, including new files. [KE00](tasks/historical/previous-batches/KE00/ticket.md) and [A handoff](handoff-A.md) record fresh checks and changed paths. No production implementation or new independent security verdict is part of this audit.

Historical instruction at the September 26 audit: KE00 was awaiting review and KE01 had not started. Current implementation and queue state are authoritative in the [task board](task-board.md) and [KE01 ticket](tasks/historical/previous-batches/KE01/ticket.md). KE01 defines the v2 contracts while preserving v1 runtime/hash behavior; KE02 follows after recorded ticket checks and uses retained B04/B04.5 technical evidence. Project-level sign-off is deferred. No old SUPERSEDED task may be restarted from a historical handoff.
