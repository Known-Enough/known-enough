# E2E02 report — E2E02-20261016-222259Z / 2026-10-16

Status: PARTIAL LIVE RUN — overall qualification NOT VERIFIED. The run uncovered a deployed dashboard client-path defect and confirmed the previously read USERNAME permission blocker. No end-user readiness is claimed.

## Run and target

- Start/end UTC: 2026-10-16 22:22:59–22:39:58. Runner: the single assigned `gpt-6-luna`; serving build/version was not exposed.
- Toolchain: Node.js 24.21.0, Playwright 1.63.0, Chrome for Testing/Chromium 153.0.8010.12. Node was fetched to a temporary directory and SHA-256 checked against the official Node.js checksum file; no repository dependency was changed.
- Repository source at start: `3a31b7c03ed032b08e1d582a8f620e77de2bea68` (`main`). The run added only this dated report/evidence folder; no product source was edited.
- Primary site: [https://main.d143q5ravxp5av.amplifyapp.com/](https://main.d143q5ravxp5av.amplifyapp.com/). Frontend source baseline `2e5902f44f10f2b68dd3f7905a79ba4c8b7aa95c`, Amplify job 111; the five deployed public asset hashes matched the saved baseline at 22:22:16Z. API SHA-256 `9b0badc58d00d3855735bc36cd300ccff6710486510f243d2f357236a1e81a87`; worker SHA-256 `1d20b9a783134d2321d3d0a380bcdf15a81057f5118ea03b7d33774c9dc06cf8`. [Backend release](https://github.com/Known-Enough/known-enough/actions/runs/38963203435) and [frontend release](https://github.com/Known-Enough/known-enough/actions/runs/38963388395) succeeded. The public-smoke step passed in [38964421870](https://github.com/Known-Enough/known-enough/actions/runs/38964421870); that workflow's separate report-generation step failed.
- Credentials: `/home/battousai/.known-enough/e2e-credentials.json` was available, mode `0600`, owner `battousai:battousai`; it contained two nonempty username/password records. Values were read privately and not saved or printed.
- User 1 and User 2 authenticated in separate browser contexts. User 1’s shape-only `/account` read reported `APPROVED`; both contexts reached `/groups` with HTTP 200 (the checked frontend requests groups only after an `APPROVED` account snapshot). Both dashboard views showed the groups-loading alert.
- Runtime permission evidence available at start: [read-only staging inspection](https://github.com/Known-Enough/known-enough/actions/runs/38964421870) at 20:44:42Z said USERNAME-partition read=false and conditional transactional write=false. [The later policy attempt](https://github.com/Known-Enough/known-enough/actions/runs/38964718851) at 20:47Z ended `iam:put-role-policy/AccessDenied`, `iamWrites=0`; independent readback reported `PARTICIPANT_POLICY_READBACK_MISMATCH`. No later policy workflow run appeared during E2E02. There was no fresh effective permission readback after this run started, so no outside-of-run policy change is asserted.
- Fixtures: none created. A shape-only read observed two groups in User 1's existing account; names, IDs and member data were not retained. No previous group was opened or modified.
- AI/provider: no AI request was submitted because no run-owned group/draft path was reachable. Usage for an app AI request is unavailable/not applicable; the log-reader workflow itself reported zero provider calls for its read-only diagnostic.

## Results

| Case | Expected | Observed / UTC | Result | LIVE / INJECTED | Evidence / dependency |
| --- | --- | --- | --- | --- | --- |
| 01 User 1 sign-in | Own account/groups entry | User 1 signed in; account status was APPROVED. `/account` and `/groups` returned 200, then the dashboard displayed “We couldn’t load your groups.” | FAIL — authentication passed; required dashboard entry failed | LIVE | [Network summary](evidence/network-summary.json), [dashboard alert](evidence/case01-dashboard-alert.png), [schema-safe read](evidence/group-list-schema-validation.json) |
| 02 User 2 sign-in | Independent User 2 session | User 2 authenticated in a separate context. Signing User 2 out left User 1 authenticated and without a sign-in form. User 2's dashboard had the same groups-loading error. | PASS — authentication/session isolation; dashboard defect recorded in 01 | LIVE | [Session isolation](evidence/session-isolation.json), [network summary](evidence/network-summary.json) |
| 03 Group create feedback | One persisted group and truthful feedback | Not attempted; the dashboard failed before group controls were available. No group write was sent. | BLOCKED — dashboard path | — | 01; no fixture created |
| 04 Rename | Saved name/organizer after reopen | Not attempted; no run-owned group existed and no supported group UI was available. | BLOCKED — depends on 03 | — | 01; no rename sent |
| 05 Editable validation | Incomplete save, specific prompts, fixed bounded choices | Not reached; no group/creation surface opened. | BLOCKED — depends on 03 | — | 01; no draft saved |
| 06 Manual decision | Create/reopen without AI dependency | Not reached; no run-owned group or editor was available. | BLOCKED — depends on 03–05 | — | 01; no decision write sent |
| 07 Invitation | Username and email invitations appear only for the addressed user and accept explicitly | Not attempted. The dashboard path is blocked by the client allowlist defect below. Independently, last effective IAM readback lacked USERNAME-scoped read and conditional write. | BLOCKED — frontend route guard and USERNAME permission | — | [INV01 ticket](../../../invitations/INV01/ticket.md), [policy readback](https://github.com/Known-Enough/known-enough/actions/runs/38964421870), [policy denial](https://github.com/Known-Enough/known-enough/actions/runs/38964718851) |
| 08 Decision modal | Native decision modal and public overview | Not reached; no run-owned decision was created. | BLOCKED — depends on 06 | — | No decision fixture |
| 09 Private answers | Independent owner saves and no cross-user private disclosure | Not attempted; no decision existed. No answers were submitted or saved. | BLOCKED — depends on 06 | — | No private-answer evidence retained |
| 10 Outcome | Feasible proposal and two explicit approvals | Not attempted; no decision or proposal existed. | BLOCKED — depends on 08–09 | — | No proposal/approval sent |
| 11 Detailed real AI | Supplied alternatives retained and usable | Not attempted; no run-owned group/draft path. No AI call. | BLOCKED — depends on 03 | — | No model input/output retained |
| 12 Incomplete real AI | Targeted missing-detail help and usable editable draft | Not attempted; no run-owned group/draft path. No AI call. | BLOCKED — depends on 03 | — | No model input/output retained |
| 13 Recovery | Newer edits preserved; no duplicate or false success | Not attempted; no owned draft or pending write existed. | BLOCKED — depends on 05/11/12 | — | No injected interruption |
| 14 Failed-AI fallback | Manual completion remains usable after an observed/injected AI failure | Not attempted; no AI request/failure or owned draft existed. | BLOCKED — depends on 11/12 | — | No injected failure |
| 15 Membership | Joining preserves ongoing answers and completed decisions | Not attempted; no run-owned group/decisions. The invitation route and USERNAME permission are also blocked as in 07. | BLOCKED — dashboard, invitation route, and USERNAME permission | — | 07; no invitation/membership write sent |
| 16 Changed answers | Other answers remain; stale approvals cannot approve a new outcome | Not attempted; no two-user ongoing decision or proposal existed. | BLOCKED — depends on 15/10 | — | No answer or approval changes sent |

## Screenshots and evidence

- [Primary landing page](evidence/primary-landing.png) shows public access only.
- [Groups dashboard alert](evidence/case01-dashboard-alert.png) contains the generic failure message and no account details.
- [Network summary](evidence/network-summary.json) contains only timestamps, aliases, methods, routes, statuses and safe request references.
- [Group response shape](evidence/group-list-shape.json) contains only field/type/count summaries. A second in-memory exact-schema check reported two group snapshots passing the local `GroupSnapshot` schema with zero validation issues; it retained no names, IDs, member identities or response bodies.
- [Session isolation observation](evidence/session-isolation.json) records the separate-context sign-out check. Its exact sign-out timestamp was not separately captured.
- Choice editor, decision modal, answer, outcome and invitation screenshots are unavailable because the groups dashboard did not load and those screens were not reached.

## Failure record

### Dashboard load fails before invitations request

- Case/substep: 01/02 account-to-dashboard load; observed 2026-10-16T22:29:19Z (User 1) and 22:29:55Z (User 2). Both sign-ins completed. The read-only HTTP GET `/account` and GET `/groups` each returned 200. The exact safe UI message was: “We couldn’t load your groups. The service couldn’t load this view right now. Try again, or return to your groups.”
- No GET `/invitations` was observed. A shape-only read confirmed the account status as APPROVED and the two returned group snapshots passed the exact local Zod `GroupSnapshot` schema. No group/decision/invitation write was submitted.
- Confirmed source-level cause: the deployed frontend source baseline matches the checked source for [cognito-session.ts](../../../../../../apps/web/src/cognito-session.ts#L180) and [group-home.tsx](../../../../../../apps/web/src/group-home.tsx#L133). `GroupHome` calls `api('/invitations')`, while `cognitoApiFetch`'s fixed path guard does not allow `/invitations`; it rejects the path before a network request. The load catch therefore reports the generic groups error after the prior `/groups` response status 200. The browser observation (no `/invitations` network request) matches this code path.
- The safe response references for the original `/groups` reads are in `network-summary.json`. The documented diagnostic workflow rejected those gateway-format references as `INVALID_REQUEST_REFERENCE` because it accepts UUID references. A later bounded read-only exact-reference query [38976535889](https://github.com/Known-Enough/known-enough/actions/runs/38976535889) completed with `NO_MATCH_IN_BOUNDED_WINDOW`, `windowComplete=true`, `awsWrites=0`, and `providerCalls=0`. The browser-side custom UUID propagation was not confirmed, so this is recorded as no matching diagnostic evidence, not as a backend success/failure explanation. Earlier invalid-reference attempts were [38976287810](https://github.com/Known-Enough/known-enough/actions/runs/38976287810) and [38976287899](https://github.com/Known-Enough/known-enough/actions/runs/38976287899); both returned `INVALID_REQUEST_REFERENCE`.
- Evidence: [alert screenshot](evidence/case01-dashboard-alert.png), [network events](evidence/network-summary.json), [shape-only response](evidence/group-list-shape.json), and [exact schema result](evidence/group-list-schema-validation.json).
- The same shared auth-client allowlist has a related, distinct route-allowlist case documented in [ZZ02](../../../zz/ZZ02/ticket.md). Duplicate check found no separate invitation-path repair ticket. The existing [INV01 ticket](../../../invitations/INV01/ticket.md) is the direct follow-up: add only the fixed `/invitations` path to the client allowlist and a focused regression proving the authenticated GET reaches the API, preserving the fixed allowlist boundary. Then repeat invitation cases after a fresh effective USERNAME permission readback passes.

### Invitation username permission

- Last available effective readback before the run: USERNAME-partition read=false and conditional transactional write=false at 20:44:42Z. The guarded permission update was denied at 20:47Z with `iam:put-role-policy/AccessDenied`; it recorded zero IAM writes and independent readback did not match the candidate. No E2E02 policy action occurred, and the policy workflow list showed no new repair attempt during this run.
- Invitation sending/acceptance was not attempted. The current USERNAME permission remains unverified after run start; the cited last readback is an earlier observation, not a fresh 22:xx readback. The missing permission remains an independent blocker even after the client path guard is repaired.

## Artifacts and final summary

- Run-owned groups, drafts and decisions: none. Existing groups were read only; no cleanup was required or attempted.
- Counts: 1 PASS, 1 FAIL, 14 BLOCKED. Evidence is LIVE only; no INJECTED case ran.
- Core cases 01–12: PARTIAL / NOT VERIFIED. Case 01 failed its dashboard-entry criterion; the downstream scenarios were blocked before their required surfaces. Full E2E02: NOT VERIFIED.
- No application code, cloud permissions or deployment were changed. No invitations, answers, proposals, approvals, paid AI requests, signup or reset actions were made.
- Next action: repair the exact `/invitations` client-path allowlist and regression under INV01; separately perform the existing narrowly scoped USERNAME policy repair and verify its effective readback. Then rerun E2E02 cases 01, 07, 15 and the still-dependent safe journeys on the same primary release. No product/MVP readiness or reliability percentage is inferred.
- The E2E02 runner has completed all safe independent checks possible from the failed dashboard and is releasing this run claim for parent review/publication.
