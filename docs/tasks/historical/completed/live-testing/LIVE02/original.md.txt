# LIVE02 — Test the real user journey

- Status: DONE — real journey harness prepared and locally verified; actual service qualification remains LIVE04.
- Intended worker: B / Battosai1806, separate clone; record actual model/effort/baseline. Suggested direct target: gpt-6-sol / high.
- Outcome: Runnable live versions of NP03/NP04 with automatic fictional actors and factual results.
- Policy: [Live delivery](../live-test-delivery.md); preparation can complete before installation, real evidence cannot.

## Bounded preparation scope

New `tests/live/qa/`, `playwright.live-qa.config.ts`, runner helpers under `scripts/live-qa/`, `docs/live-qa-coverage.md`, this ticket and B log/handoff. List exact files at claim. Existing NP03/NP04 source/tests and A-owned public harness are read-only unless an exact coordinated amendment is recorded.

## Deliverables and completion

1. Map every remaining NP03 screen and NP04 positive/negative assertion to a real target/actor/action/assertion. Separate local preparation results, primary public results, isolated QA results and actual primary configuration readback. Identify gaps explicitly.
2. Use real hosted authorization-code/PKCE login in separate browser contexts. No fabricated JWT/session storage, intercepted API replies, local storage substitutes or scripted AI in a lane labeled live. Automatic controlled signup/verification and scoped synthetic admission require no human inbox or CLI approval.
3. Exercise fresh group creation, exact invitation recipient acceptance/replacement/expiry/replay, fresh public objective/draft review, each owner's frame/private interpretation confirmations, negotiation/refusal/revocation, safe public explanation and matching approvals to agreement. Fictional actors exercise their own authority; organizer credentials do not approve for others.
4. Check pending/rejected/disabled old sessions, wrong recipients/groups, outsider/display isolation, unsupported clarification/revision/stale approvals/disclosure independence, reload/fresh-session persistence, retries/concurrency and public/log privacy. Check actual rendered screens, keyboard focus/status, mobile/reduced-motion behavior. Preserve meaningful local tests.
5. Distinguish ordinary precreated-user login from real signup/email delivery. AI calls and real email run only in their installed bounded authorized lanes. Unavailable target/fixture/budget is reported as blocked coverage, not skipped-to-green completion.
6. All actors and cleanup run unattended through the LIVE01 interfaces. Validate account/target/release identity first and always generate sanitized results; never save login/owner secrets in reports, screenshots or traces.
7. Locally verify harness/configuration and meaningful safety checks, plus pinned npm run check for changes. Explicitly label harness tests that simulate services as preparation evidence. Provide one runner command that needs no personal AWS profile and fails clearly if setup is absent.

DONE means live test code and coverage mapping are implemented and locally verified. No claim of real service PASS until LIVE04. No deployment, account creation, paid AI, email or AWS write occurs during preparation. Sync uses [skip ci]. Continue to [LIVE03](LIVE03.md).

## Claim — 2026-10-01

B / Battosai1806, Windows/WSL separate clone; GPT-6 variant/effort unexposed. Clean synchronized main 6484bce, 0/0. Exact scope: new tests/live/qa/{helpers.ts,journey.spec.ts}, playwright.live-qa.config.ts, scripts/live-qa/{runner.mjs,runner-core.mjs,sanitized-reporter.mjs}; new tests/integration/live-qa-runner.test.ts; docs/live-qa-coverage.md; this ticket, own B log/handoff. Amend own LIVE01 broker.mjs only to add exact run-owned disclosure publication/expiry service actions needed for qualification, preserving real application permission enforcement; fixture-core/config/setup test only for focused regression if needed. No NP00/shared inspector/root/deployment/application edits. Source pushes skip CI; no actual AWS/signup/email/model operation in preparation. App/target failures exposed by the harness remain explicit LIVE04 blockers rather than fake passing results. A owns shared board updates during overlap.

## Completion — 2026-10-01

B / Battosai1806, GPT-6 variant/effort unexposed. Seven serial required live tests cover actual hosted PKCE/signup/mailbox, admission/invitations, fresh model/public draft, four independent owner confirmations, negotiation/exact agreement, denial/privacy/retry/concurrency/real token expiry, refusal/revocation/roster/disclosure and rendered clarification/accessibility. Runner validates workload/target/expected release, uses private synthetic logins, always requests exact cleanup and emits only sanitized allowlisted statuses/counts. Missing/skipped/duplicate tests or model/signup/privacy/cleanup block complete qualification. [Coverage and explicit gaps](../live-qa-coverage.md) map NP03/NP04 and record the bound-display admission issue needing a coordinated application fix in LIVE04. No app/NP00/root/shared workflow file changed.

Focused setup/runner tests 18/18; full pinned npm run check exit 0: 486 passed / 2 optional DynamoDB Local skips, hosted 1/1, E2E 53/53; references 7/7, planning 15/15 and lint/typecheck/builds pass. Final typecheck/scoped lint and Playwright collection 7/7 pass; collection is not live execution. Local links/whitespace pass. No AWS/profile/login/account creation, hosted browser run, email/model call or deployment performed. LIVE04 owns actual managed-service/model/selector/cleanup proof and must fix any relevant source/service failure before acceptance. Next B preparation LIVE03.
