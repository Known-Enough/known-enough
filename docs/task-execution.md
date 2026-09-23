# Model selection and historical execution evidence

Current policy, September 23, 2026: humans select the direct model/effort printed in each [task ticket](task-board.md). See [workflow](agent-workflow.md). Use `gpt-6-luna` for narrow UI/docs work, `gpt-6-sol` for routine implementation and difficult backend work, and `gpt-6-astra` for architecture and explicit critical checkpoints. B01/B02 source and prior execution evidence are integrated; current results are in [main integration](main-integration.md). Model selection does not change task state or establish verified results.

Current claims/progress belong in the tickets and [A](work-log-A.md)/[B](work-log-B.md) logs. Either user may claim any eligible unclaimed task from the shared pool; active work still requires an explicit transfer. Main in separate clones replaces mandatory task branches. This scheduling update does not move branches, change a running B session or share files automatically.

## Historical record — prior policy, not current instructions

The entries below are preserved verbatim as execution provenance. Their historical statements about mandatory Astra leads, task branches, blocked A preparation or unimplemented B work are superseded by the current workflow and the user's September 20 progress report. Do not use them to restart work or override current tickets.

## Execution record

- Launched F00, F01 and F02 as separate read-only reviews using `gpt-5.6-sol` with high reasoning. Reviews of already implemented artifacts run concurrently; downstream implementation remains gated.
- F00 / `f00_review` (`gpt-5.6-sol`, high): reconciled README/handoffs with baseline commit `972386395618ec0ed81581d38082ebeb15d66142`, preserved human gates, and linked this assignment record. The coordinator removed its own insertion into the immutable architecture import; all seven hashes are unchanged.
- F01 / `f01_review` (`gpt-5.6-sol`, high): added Git attributes preserving exact imported bytes and explicit backend workspace dependency boundaries, with three initial regression tests. A temporary `core.autocrlf=true` checkout retained all seven manifest hashes. Coordinated the focused tooling test in packages/test-support with this foundation task.
- F02 / `f02_review` (`gpt-5.6-sol`, high): constrained revision roster submission indicators to false and duty qualifications to that payload's roster, with three focused contract tests. An initial roster `.join()` collision allegation was rejected by the coordinator and withdrawn by the reviewer; no unnecessary roster/hash change was made. Independent Sol review by `f00_review` found no remaining actionable issue in the final contract diff.
- Independent F01 review by `f02_review` found that approved workspace imports also need declaration checks. The reviewer reported findings, then hit a usage limit before completing its final handoff. Escalated this bounded correction to `f01_escalation` using `gpt-6-astra` with high reasoning; no silent model substitution. Astra reproduced the missing-declaration behavior and the rejection of legitimate fixture devDependencies, corrected both, and passed 14 focused boundary regressions. The coordinator inspected the final diff and verified the integrated result.
- Working branch: `task/foundation-review`, based on `972386395618ec0ed81581d38082ebeb15d66142`. No commit, push, merge, deployment or paid resource creation was performed in this execution.
- Current verification setup: exact Node 24.21.0/npm 11.19.0 downloaded under /tmp; Node archive matched the official SHA-256 manifest. `npm ci` installed the locked dependencies successfully. Chromium and its needed libraries/fonts were prepared under /tmp because system installation required an interactive sudo password. No system packages were installed. Sandbox network/preview-port restrictions required approved escalated commands.
- Final full run after the F01 escalation correction exited 0 at approximately 2026-09-20 01:52 UTC (September 19 local): seven reference hashes, 15 arithmetic checks, lint/boundaries, typecheck, 66 unit tests in three files, build/bundle scan and two Chromium smoke tests at 390/1280px. See [current verification evidence](verification.md#foundation-review-verification--september-19-2026-local).
- Historical bootstrap evidence in verification.md remains historical. Backend solver/auth/cloud behavior is still unimplemented; foundation checks make no claims about it.

## Foundation review handoff (historical)

F00–F02 review fixes are integrated locally and verified, with status REVIEW pending human acceptance of the current diff. All later tickets retain their existing dependency gates; none of their implementation agents has been launched. The next eligible implementation pair after accepted F02 is A01 (`gpt-5.6-terra`) and B01 (`gpt-5.6-sol`) in separate developer lanes. The observed Sol usage limit may require a retry or an explicitly reported escalation when that task becomes eligible; Terra/Luna availability has not been exercised by a task yet.

Human review remains required by AGENTS.md and the task dependencies; agent reviews and passing checks do not mark tasks DONE or authorize merging. Cloud work still requires its separately specified authorization. The immutable architecture/task-board import was left byte-for-byte unchanged; this file and the individual mutable tickets contain the current model assignments.

## A01 execution — September 20, 2026

- The live remote `main` and `task/foundation-review` both contained `ca9fb636974030bfd8a620cec2b3d8581b3c8114`. After the user explicitly requested A01, the coordinator fast-forwarded the clean local main and created `task/a01` from that foundation. This authorization permits A01 to proceed despite historical foundation tickets still recording REVIEW; it does not record acceptance by the other developer or start B's tickets.
- Working lead: Astra. Bounded implementation agent: `a01_ui`, `gpt-5.6-terra`, high reasoning, owning only `apps/web/**`. No additional agents or model substitutions. Terra implemented separate mock screens/adapters and focused unit tests. Astra wrote browser tests, reviewed the implementation, resolved integration issues and maintained task/handoff evidence.
- Review corrections: actual local draft values, independent exception/disclosure feedback, unavailable final acceptance without an exact proposal, full scope/audience display, real disclosure text hash, asynchronous read cleanup, explicit date/timezone accessibility labels, and wrapping long receipt hashes. No backend permissions, public projection implementation, solver, authentication or cloud behavior was added.
- Coordinated root configuration change: an explicit `PLAYWRIGHT_CHANNEL=chrome` fallback and one worker for installed-browser runs. Pinned Chromium is unsupported on this macOS 12 host; CI keeps its existing default browser. Dependencies, lockfile, contracts and immutable references are unchanged.
- Current status: A01 REVIEW, with [verification evidence](verification.md#a01-verification--september-20-2026) and [A handoff](handoff-A.md). A02 remains gated by review and B02/B03. No push, PR, deployment or paid resources are authorized by this execution.

## B01 execution record imported from 04c87d7 (historical)

The following was recorded before B01 was committed/pushed; its last known branch/status statements are historical. Current main integration is documented in [main integration](main-integration.md).

The foundation was committed as `ca9fb636974030bfd8a620cec2b3d8581b3c8114` and integrated/pushed to main at the user's explicit direction. On September 20, 2026 the user authorized B01 from that accepted baseline. B01 is implemented on `task/b01` and is REVIEW pending human acceptance. `b01_implementation` used the assigned `gpt-5.6-sol` with high reasoning and wrote the initial solver, fixtures, demo, and tests before reaching its usage limit. `b01_review` used `gpt-6-astra` with high reasoning for an initial independent semantics/code review and also reached its usage limit before final review. After the user resumed work, the coordinator explicitly escalated completion of the existing work to `b01_completion` using `gpt-6-astra` with high reasoning. The independent Astra reviewer then resumed successfully and found no remaining supported actionable issues in the final named diff. The coordinating lead integrated the result, inspected the changes and passed the full check. A01 and the later implementation tickets have not been started in this session.

B01 evidence: 116 tests in five files, two Chromium smoke tests, seven immutable reference hashes, 15 arithmetic checks, lint/boundaries, typecheck and build all passed. The demo reports 12 structural plans, zero baseline feasible, two after the valid exception, and the expected B/A policy selections. Independent review verified 64 focused tests and six additional assertions. Named implementation diff: `/tmp/b01-ca9fb63-review.patch`, 66,665 bytes, SHA-256 `f2b354c277db77e140df7fc867691eda021c3f74eb2bc34a87bdf02f26e42bcb`, including all 15 implementation/config/doc files in scope. See [B01 verification](verification.md#b01-verification--september-20-2026) and [B handoff](handoff-B.md). No B01 commit/push/merge was performed; B02 remains gated by acceptance of B01.

Human review remains required by AGENTS.md and the task dependencies; agent reviews and passing checks do not mark tasks DONE or authorize merging. Cloud work still requires its separately specified authorization. The immutable architecture/task-board import was left byte-for-byte unchanged; this file and the individual mutable tickets contain the current model assignments.

## B02 execution — September 20, 2026 (historical, before commit/push)

The user authorized B02 from B01 commit `04c87d761d13f29643e287392e520ca38af940d0`. The coordinating lead created local branch `task/b02`; no B02 commit/push/merge was requested or performed.

- B02 → `gpt-6-astra`: `b02_implementation` (high reasoning) implements application commands, the in-memory adapter, focused lifecycle/transaction tests and package documentation.
- Contract/privacy review → `gpt-6-astra`: `b02_contract_review` (high reasoning), read-only. Reviewed explicit interval coverage and owner receipt compatibility, then independently examined identity, projection, permissions, replay and transaction behavior.
- Coordinator: integrated the narrow contract/fixture changes, registered integration tests in the root runner, refreshed existing workspace lock dependencies and wrote independent application integration tests. Root/contract changes are explicit coordination proposals; human A compatibility review is still required before integration.

Review identified an out-of-audience organizer disclosure and uncached rejected-command key reuse; both received implementation corrections and regression tests. The coordinator also required expiry rechecks after asynchronous hashing. See [B02 verification](verification.md#b02-verification--september-20-2026) for final evidence and the named diff. Historical B01 status descriptions above predate its subsequent commit and this authorization.

B02 completion: `b02_implementation` reached its usage limit after the implementation/test edits; no substitute model was used. The coordinating lead completed package docs and two readonly test-type corrections. Full `npm run check` passed 144 tests, two Chromium tests, references/arithmetic, lint, typecheck and build. Final review evidence is in verification.md. B02 remains REVIEW.

## B03 execution — September 21, 2026

User requested B03 from committed B02 `47b97eb`; lead Astra created local branch `task/b03`. Human acceptance/integration remains separate.

- `b03_implementation`: GPT-5.6 Terra, high reasoning, owns `apps/api/**` implementation and API documentation.
- `b03_review`: GPT-5.6 Sol, high reasoning, independent read-only authorization/privacy review.
- Astra lead: HTTP integration tests, exact existing-workspace lock coordination, review integration, verification and handoff records.

The fixed non-production identity map is privately reconstructed after validation following Sol's mutation finding. All 156 tests and two Chromium scaffold checks passed under the pinned runtime. See [B03 verification](verification.md#b03-verification--september-21-2026) for exact artifact/check evidence. B03 remains REVIEW; G01 still requires A02 and human review. No commit, push, merge or deployment occurred.
