# NP04 fresh-group qualification — 2026-10-01

B / verified Battosai1806, Windows/WSL; actual GPT-6 variant/effort unexposed. Local signed JWTs against cached synthetic JWKS, injected fictional verified-profile/operator ports, real HTTP/application/contracts/kernel, injected structured model provider and Chromium. No real signup, managed deployment, paid call, volunteer feedback or independent review.

## Positive product path

`tests/e2e/np-qualification.spec.ts` creates four separate browser sessions: iris, omar, tess and vin, outside the old five-person fixtures. Each requests access independently; the test invokes the actual operator core without AWS. Iris creates Fresh garden club, generates recipient-bound links and each recipient explicitly accepts. Copying links is the delivery path; no email is sent.

From a blank objective, “Choose our garden workday activity and time,” the injected architect proposes public ENUM Activity (Planting/Watering) and Time slot (Morning/Afternoon), no public rules, and four server-derived required approvers. All review/confirm the exact shared frame. Distinct fictional needs are interpreted and explicitly selected: Iris allows Planting to be negotiable; Omar requires Watering; Tess requires Afternoon; Vin prefers Watering. Iris alone receives and allows the exact Watering adjustment. The same generic bounded candidate generator and existing kernel produce Watering/Afternoon. All four independently review and approve the same proposal; only then is it AGREED. Reloading each session preserves agreement. Public responses exclude raw private canaries, constraint/grant/refusal identifiers.

The test-only provider selects scripted structured responses for Gallery/Garden; it is not evidence of natural-language quality or live AI. Production general creation has no such objective switch, mandatory scenario enum, fixed roster or fixed offer catalog. NP02 also generated a different Gallery structure. Existing templates remain regression examples.

## Negative and recovery evidence

`tests/integration/np-qualification.test.ts` has seven meaningful checks:

- Decline retains one refusal, produces no repeated pending question or proposal; unsupported private conditions require clarification and block exploration.
- Revoked negotiation invalidates its proposal/approvals; an already prepared exact approval rejects.
- Removed-member access rejects; explicit roster revision clears confirmations/private readiness/permissions/approvals and rejects the old approval.
- Disclosure approval is independent of final approval. Unused permission can be revoked; publication without permission rejects. A separately allowed exact note reaches only Omar, becomes a terminal published receipt, and does not replace any final approval. Already shared content cannot be unread.
- Unverified, unapproved, disabled old bearer, expired signed bearer, display-owner and foreign-group authority reject. Captured local request logs and allowlisted public responses exclude private/token/email markers.
- Architect output with injected owner-private fields rejects without saving a draft or echoing the private canary.
- Decision state and separately encoded replay receipts reconstruct into a fresh application; the committed exact command replays once and retains one approval. This is codec/application reconstruction, not managed restart evidence.

A browser recovery check loses a committed response, retries the identical command, and records one frame confirmation. Browser session expiry removes access; injected reconnect restores the persisted server state without fabricating confirmation. The four-person browser flow also covers a newly opened invitation fragment on an already signed-in page; NP04 fixed initial-only fragment handling with a bounded hash-change listener, retaining explicit recipient acceptance.

Existing NP01 group-transport CAS/reconstruction, recipient expiry/replacement and group admission checks and NP02 draft persistence/reservation/retry and private-field rejection remain part of the full suite. No NP00-owned implementation or tracking is changed. Initial failures exposed the invitation issue and test assumptions about terminal disclosure receipts, separate replay storage and explicit unsupported-condition confirmation; these were corrected without increasing timeouts or changing backend authority.

## Reproduction and limits

Pinned Node 24.21.0/npm 11.19.0 `npm ci`: exit 0, 193 packages audited, zero vulnerabilities. Chromium/system dependencies installed on this local supported host. Focused NP04 browser 2/2 and API 7/7 passed; typecheck passed. Final full-check results are in [NP04](tasks/NP04.md).

Run `npx vitest run tests/integration/np-qualification.test.ts` and `PLAYWRIGHT_CHANNEL=chromium npx playwright test tests/e2e/np-qualification.spec.ts`; then pinned `PLAYWRIGHT_CHANNEL=chromium npm run check`. Synthetic accounts and provider require no credentials or paid calls. Source commits use `[skip ci]`; repository sync does not publish staging.

[NP05](tasks/NP05.md) separately owns authorized AWS/Cognito signup, A-only deployed CLI and IAM/config, managed persistence/restart/concurrency/logs, optional email, live-model qualification and remaining actual hosted screen checks. No managed or human result is implied by local DONE. NP00 remains A's preserved active claim. NP01–NP04 local implementation and qualification are complete. Final pinned full check exit 0: 464 passed / 2 optional DynamoDB Local skips, hosted 1/1, E2E 53/53; references 7/7, planning 15/15, lint/typecheck/builds passed.

Tested artifact SHA-256 (before documentation-only completion tracking):

- `apps/web/src/group-home.tsx`: `ecccdfa28e4f966657637d717e158e15315c6aa5ac0ec3eef0f645c6c50794a6`
- `tests/evaluations/np-api.ts`: `293700c5935ad6be10052b78137ba7f940aec5cc3a2d63152dd2d276a6e0a3d0`
- `tests/evaluations/np-model.ts`: `9dc1f547539bcee879de1d2280e05b30b1dfa5ec183f2975899f56a6878995a7`
- `tests/integration/np-qualification.test.ts`: `a34c72dc460b0d60a02fe28cbc85bf2696a119aafe58163d775e9b9f30cb049f`
- `tests/e2e/np-qualification.spec.ts`: `62746e8a415f3a69ad5c8995ea08da90d7f1803e6d2defece77666c5f8ec510b`
