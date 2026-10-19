# E2E03 final-reopen repair: one authorized participant read

Status: PUBLISHED at source `1f7d441`, API `e8338c82`, worker `c4258495`, frontend Amplify152. Prior admission and background schedule are ENABLED. [Publication receipt](owner-read-publication.json). Direct user repair request; no new product test, outcome, approval or AI request. The [last test](20261019T224223Z/report.md) remains BLOCKED at final U1 reopen, while U2 already read AGREED / 2 approvals. Preserve that agreement and both acknowledged answers.

## Evidence and scope

U1's final reopen failed twice on GET public, before its own view was requested. Participant loading first awaited public, then owner, then a cosmetic group-title read. The owner response already contains its complete current publicSnapshot. Background polling also required two independent snapshots to have matching revisions, creating an avoidable failure window during legitimate progress. These dependencies are confirmed in source; the exact initiating network cause remains unknown.

A bounded [metadata read](https://github.com/Known-Enough/known-enough/actions/runs/39338499778) confirms default API limits of 5 requests/second, burst 10, no decision overrides and no gateway access logging. The inspector cannot read root API CORS metadata (AccessDenied); this optional diagnostic is recorded as unavailable, and is not a deployment prerequisite. No matched gateway-failure event was found. The evidence does not establish that throttling caused this exact request. [Sanitized metadata](owner-read-metadata.json).

## Repair

- Participant load uses one strictly parsed authenticated owner response and its included public snapshot. Shared-screen sessions keep their public-only endpoint. No cached or invented snapshot is substituted.
- Native owner responses advertise the same source-owned background-negotiation capability as public responses. The server change is compatible with the previous browser while publication proceeds. No new endpoint, IAM permission, data field or provider grant.
- Background polling uses the same single owner read, with exact owner, decision, context and semantic-version checks. One read provides coherent shared/private state; two separately read public revisions are no longer compared.
- Current authorized state is displayed before the optional renamed-title lookup. That cosmetic read has a five-second bound and navigation/identity checks; it cannot keep the decision loading.
- The E2E runner's failure-image allowance is now two per case, so case01 pictures cannot suppress a case02 failure image. Browser console export includes only fixed CORS/rate-limit categories, never text or URLs. Existing background/HTTP assertions were adjusted to the changed read/capability contract; they were not run.

TypeScript, changed-file ESLint, runner/Python syntax and whitespace passed. No unit/browser/live product test ran. No participant data or agreement was changed; manual acceptance and the final E2E03 readback remain pending.

## Publication and next acceptance

[Coordinated runtime release](https://github.com/Known-Enough/known-enough/actions/runs/39339019360), [frontend publication](https://github.com/Known-Enough/known-enough/actions/runs/39339200904), and [existing schedule restoration](https://github.com/Known-Enough/known-enough/actions/runs/39339196296) all succeeded. Ten public file hashes matched. Environment, migration and cumulative totals were preserved; frontend configuration matched with zero writes. One regular empty worker tick reported zero paid dispatch. No functional test was run.

The next authorized acceptance is read-only: reuse the latest **20261019T224223Z agreed fixture checkpoint**, including its outcome/proposal/approval records, and reopen both owners to confirm the same AGREED proposal, two approvals and their own saved answers. Do not copy an older pre-outcome fixture, request another outcome, resubmit an answer or approve again. The historical case02 stays BLOCKED until this final readback is actually observed. Repair claim released.
