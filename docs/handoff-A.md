# User A handoff — shared task pool

Current scheduling (September 23): both users follow the same [project-wide priority queue](task-board.md), with one active task at a time. A/B IDs and personal handoff filenames do not assign ownership. G01 is DONE for the reviewed local integration checkpoint after user acceptance. B04 committed its bounded R2a/R2b/R5 corrections as b91ff76; the full local check passed, and B04 is PAUSED for independent review before adapter expansion. A05 mock preparation remains REVIEW pending separate human acceptance. [T01](tasks/T01.md) and [T02](tasks/T02.md) remain later AI-extension work.

Use the direct model/effort printed in the ticket. A02/A03 remain REVIEW. A03.5 records PASS for the exact reviewed correction; A04/A06 remain candidates subject to prerequisites, while A05 is REVIEW. Read [workflow](agent-workflow.md) and [A log](work-log-A.md), then take only the current highest-priority task. No parallel task or subagent work.

## Existing A01 evidence

A01 is included in the user-authorized main integration; see [current results](main-integration.md). Historical implementation: task/a01 based on ca9fb636974030bfd8a620cec2b3d8581b3c8114; Terra/high implemented UI/adapters/unit tests, Astra integrated and reviewed. Its separate validated public/owner mocks, lazy owner screen, loading/empty/failure/stale states, local draft controls and separate consent feedback remain intact. Owner demo identity is not authentication. See [dated verification](verification.md#a01-verification--september-20-2026).

Historical file scope: apps/web/src, tests/e2e, supporting documentation and explicit installed-Chrome fallback in playwright.config.ts. Contracts, dependencies and lockfile were unchanged. The later user-authorized main integration supersedes its old pending-branch state; historical checks remain dated evidence. Its existing implementation now enables independent frontend preparation.

## Current A03 handoff

A03 is in REVIEW on the current `main` checkout. Its private owner mock now displays exception, disclosure, and final-approval receipts while the shared view remains receipt-free. Responsive receipt cards stack at mobile widths, action buttons wrap, and reduced-motion preferences disable meaningful transitions/scroll animation. Evidence is recorded in [A03](tasks/A03.md) and [work log A](work-log-A.md); full `npm run check` passed with 20 browser tests. This is mock/UI evidence only and does not establish server authentication or live API behavior.

## A03.5 review handoff

Independent review of the uncommitted R2/R5 correction against `cfb337104cff4d760986c849ab55606bf8ba0afa`: **PASS**. Reviewer: independent A-lane GPT-6 session; variant/effort not independently exposed. [Exact reviewed diff/hash, fresh results and historical evidence](reviews/A03.5.md).

R2/R5 are closed for preparation; R1/R3/R4/V1 retain their closures. One explicit condition/interval now drives initialization, display and serialization. Every draft submission invalidates checked coverage and confirmation, including unchanged submissions and unknown-outcome retries. Confirmation remains unavailable pending a current snapshot; actual API refresh and subsequent fresh review belong to A02.5.

Fresh reviewer evidence with pinned Node/npm and the documented Chrome fallback: full check 171/171 unit/integration and 29/29 browser; focused 13/13 unit and 27/27 browser; 11 independent probes passed. A02/A03/A03.5 remain REVIEW pending human acceptance. A02.5/A04/A05 checkpoint blocks are released and tickets are READY/unclaimed, subject to their own prerequisites and synchronization of the exact reviewed artifact. No implementation task claimed, implementation files changed, commit or publication performed by this review.

## Next work and transfer

Earlier A02.5 implementation handoff (superseded for scheduling by its current IN_PROGRESS claim; see the board's evidence discrepancy): `?view=owner&local=<maya|leo|nina>` and `?local=display` read B03's loopback API using its explicit fixed non-production labels; command success refreshes both private and public snapshots. Mock routes remain the default and no browser source imports server fixtures. The existing B03 HTTP integration flow verifies the real negotiation, independent disclosure refusal, three approvals and duration invalidation; the full UI suite and full check pass. This changed source requires a fresh independent follow-up review before G01. It is not production authentication. A03 adds receipt/accessibility preparation; A06 prepares demo/trial/setup drafts. A04/A05 retain their own gates.

B01 source and prior review evidence are now included from 04c87d7. B02 source and final independent review evidence are also available from 47b97eb; the user authorized their integration. Neither user should restart those completed tasks. Use the sequential claim/transfer procedure; active work needs an explicit release and saved artifact. Each user records work in their own log, regardless of task prefix.

This checkout uses main. A01, the workflow refactor and B01/B02 work are consolidated at the user’s direction; historical branches are retained without new work. See [integration/publication state](main-integration.md). Future tasks use main in separate clones and retain their review/authorization gates.

B02 compatibility: owner snapshots require availabilityReview, and CONFIRM_INPUTS requires explicit reviewedIntervals. A02 must collect owner-reviewed coverage; it must not infer it from all schedule options. A01’s synthetic owner adapter is updated during integration; public DTOs are unchanged.

## Authorized synchronized repair handoff

User authorized integration/publication of B’s reviewed `d042d8f` with published `8371e7b`. Both histories and the September 22 shared-pool policy are retained. A02.5 remains REVIEW; G01 is DONE for its accepted local checkpoint. See [B handoff](handoff-B.md) and [current G01 evidence](reviews/G01.md) for the combined artifact/checks. No new task is claimed.


## B04 midpoint handoff — 2026-09-23

Historical first-slice handoff: B04 paused on `main` after its first reviewable slice. The local Cognito adapter verifies access-token signature, issuer, token use, app client and expiry through `aws-jwt-verify`; participant subjects come from signed `sub`, while display scope requires a separate app client and exactly one admin-managed room group. HTTP never accepts the local mock identity header in this handler, and diagnostics now log role/counts instead of stable participant IDs. Proposed DynamoDB `STATE`/`GUARD` transaction and least-privilege IAM boundaries are in [infra design](../infra/README.md). Full check passed: 187 unit/integration, 41 browser, references/planning/lint/typecheck/build. No live Cognito pool, DynamoDB, IAM policy or cloud deployment exists. The independent B04.5 review returned CHANGES_REQUESTED; see [review findings](reviews/B04.5.md). Current follow-up: B04.5 requested R2a/R2b/R5 corrections on 35d57e7. The owner committed the corrections as b91ff76; the full local check passed. B04 is paused for independent follow-up review before adapter expansion. No cloud resources, deployment, or publication.
