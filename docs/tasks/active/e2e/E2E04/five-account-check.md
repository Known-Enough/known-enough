# E2E04 — five-account regression variant

Requested by the user on 2026-10-21 (Mexico City). This is a smaller fresh check of the current release, separate from the completed historical fifteen-user qualification. Five-user evidence cannot requalify fifteen-user capacity or member pagination.

## Accounts and bounds

Use five existing approved synthetic accounts, preferably `test04`–`test08`, mapped privately to U01–U05; U01 organizes. Read passwords only from an owner-provided local file in the [existing credentials format](../E2E01/credentials.md). Verify five distinct usable entries before authentication. Different existing names require explicit mapping, never guessing passwords from another user's entry. No account provisioning, password reset, setup, deployment, application changes or old-fixture reuse.

One worker, isolated owner sessions, one active page; sequential writes with durable intent/acknowledgment/readback. Follow [the reporting contract](../E2E03/execution-reporting.md). Publish startup on development before browser actions and checkpoints after joins, all answers, outcome and agreement. Preserve unknown actions; inspect the original request instead of resubmitting. Maximum one new group, one decision, one optional AI-drafting request, one automatic outcome, five plain posts, five saves, five approvals and five assistant questions. Provider calls/tokens may differ from UI requests and need actual evidence or UNKNOWN.

## Fresh fixture

Group: `E2E04 Five <UTC>`. Decision: `Dinner Together Plan`. All restaurants and arrangements are fictional.

> Plan a fictional dinner for five people. Choose Cedar Kitchen, Moon Noodles, Garden Table or Harbor Grill; 30 or 31 October 2026; 18:30 or 20:00; and Walk, Bus, Train or Taxi. Each participant chooses privately. Do not infer their preferences, make bookings or approve for anyone.

Use four questions: Restaurant (four choices), Date (two), Time (two), Travel (four): 64 plans. Keep the exact public vocabulary from the original ticket. Use at most one optional AI suggestion request; record any draft failure separately before using the existing manual editor as a control. An AI failure is not converted into PASS by manual fallback.

The synthetic answer matrix below has exactly one common plan: **Moon Noodles · 2026-10-31 · 18:30 · Bus**. Do not simply take the original CSV's first five rows, which leave several common plans. These are prescribed fictional inputs, not scraped user data; compare each owner's fresh saved readback privately and publish only selection-match booleans.

| Alias | Restaurant | Date | Time | Travel |
| --- | --- | --- | --- | --- |
| U01 | All four | Both | Both | All four |
| U02 | Moon Noodles; Garden Table; Harbor Grill | Both | 18:30 | All four |
| U03 | Cedar Kitchen; Moon Noodles; Harbor Grill | 2026-10-31 | Both | Bus; Train; Taxi |
| U04 | Cedar Kitchen; Moon Noodles; Garden Table | Both | Both | Walk; Bus |
| U05 | All four | Both | Both | Bus; Taxi |

## Six bounded checks

1. **Identity and membership:** five real isolated sign-ins, four username invitations accepted by their respective recipients, five distinct member identities/required approvers and one organizer. No new signup/email.
2. **Lists and layout:** dashboard search/clear/no-match, five readable member cards, menu/profile navigation, light/dark and mobile overflow. Member search appears only above eight members and pagination only above twelve, so both should be absent for this fixture. Observe group-list response pages if this organizer already has more than five groups; otherwise mark pagination NOT_APPLICABLE, without creating filler groups.
3. **Private answers and plain chat:** each saves its exact row once with current consent. Inspect 2/5 and 5/5 answered; saved owners reopen their own selections, no recovery flash, correct red action chips. Five plain `Ready — user NN` messages persist with five distinct authors and no AI requests. Never publish another owner's private snapshot.
4. **Automatic outcome:** the last required save should trigger the existing queue automatically; there is no routine Find outcome button. Observe the original request ID, exact tuple and initial 0/5 approvals. Time last acknowledged save to visible proposal; record any earlier observable enqueue timestamp separately. Target30s, observation ceiling120s. Unknown/pending is BLOCKED, not permission to dispatch another job or clear an old quarantine.
5. **Exact approval:** pin proposal ID/version/public hash, then five explicit owner approvals of that same proposal. At4/5 it must remain unagreed; U05 last. Reopen U01/U03/U05 through the positively owned direct URL and verify AGREED/5 of5/same tuple. Current active lists intentionally hide agreed/closed decisions, including from original members; list absence is expected, while authorized direct access remains.
6. **Assistant and privacy:** at2/5 answers, ask how many remain (three); at4/5 approvals, ask if agreed (no, one remains); after5/5, ask for the exact agreed four-choice plan. U05 privately asks for one practical meeting suggestion with a synthetic reminder. Reopen its private thread; U01 asks for U05's private messages and must be refused with no marker/answers exposed. Five AI questions total, explicit consent in each relevant session/scope. Plain Post message is not an AI call. Assess natural relevance and current facts separately from persistence. No claim of native Alexa+ integration.

## Current UI and recorder readiness

Only decision creation uses a dedicated page (Describe → Questions and choices). Other decision views/chat remain modals. Check the current visible labels before dispatch: the archived15-user recorder targets older wording, Windows-specific atomic writes/Chrome, an explicit Find outcome button and list reopening after agreement. Adapt only the bounded browser harness to the execution host/current controls before running; preserve per-owner context, unknown-write guards and pinned-proposal validation. This document does not claim that adaptation has executed.

Gallery: roster,2/5 progress,5/5 plus proposal,4/5 approvals,5/5 agreement, mobile chat. Mask tokens/passwords/private responses; no HAR/raw console/header/body dumps. Persist report.md/summary.json/append-only events.jsonl under `docs/review-artifacts/E2E04/five-<UTC>/` on **development only**. Report actual passes, failures, blocked checks and N/A criteria; retain owned fixture for manual inspection. No broad app suite or cleanup detour.
