# E2E02 report — E2E02-20261017-201917Z

**Rerun complete: 11 PASS / 0 FAIL / 5 BLOCKED. Full qualification BLOCKED.** All sixteen cases have an outcome; the five blocked cases did not complete. No final proposal or participant approval was produced.

## Run and target

- UTC 2026-10-17T20:19:17.335242+00:00 to 2026-10-17T22:22:52.888Z, including interruption and user-directed resume. One direct Codex GPT-6-based worker; exact serving variant/effort unavailable. No Luna subagent, new chat or schedule. Own GitHub Battosai1806/143764700. Playwright1.63.0 / Chromium153.0.8010.12, pinned Node24.21.0/npm11.19.0.
- Primary [Known Enough](https://main.d143q5ravxp5av.amplifyapp.com/), frontend119/source72f1906, API/worker755440b. [Seven assets before](evidence/frontend-baseline.json) and [after](evidence/frontend-final.json) match. [API metadata39066224546](https://github.com/Known-Enough/known-enough/actions/runs/39066224546) matches APIbc56395c; [worker39066321002](https://github.com/Known-Enough/known-enough/actions/runs/39066321002) verifies installed/package SHA5a253d56, source and **disabled schedule**. [Release receipt](../../../../../review-artifacts/E2E02/repair-publication.json). No target deployment occurred during the run.
- Private credentials0600 and checkpoint directory0700 checked. User1/User2 are distinct approved server subjects with verified deliberately shared email, each in an isolated context. Their own account/groups/inbox reads succeeded. No new accounts, approval, IAM, model-control or service-configuration changes.
- Main G had both members before M creation. AI A/B used G. H tested ongoing membership; independent R tested the changed-answer prerequisite. Recovery/fallback groups were explicitly SOLO. 8 owned groups and 7 decisions remain retained; IDs and public-draft checkpoints stay in `/home/battousai/.known-enough/E2E02-20261017-201917Z/fixtures.json`0600 outside Git. The first email-only fixture retains its known unaccepted invitation after a local wrong-button locator; a separate owned email fixture completed the supported flow. No unknown send or create was replayed.
- Followed01→02→03→04→07→05→06→08→09→10→11→12, then independent13–16. Corrected local harness gaps and finished email/stale-save/isolation checks in later passes. [Observations with UTC](evidence/observations.json), [sanitized network](evidence/network.json), [case results](evidence/case-results.json).

## Results

| Case | Result | Actual observation |
| --- | --- | --- |
| 01 | PASS | User 1 signed in and approved; authenticated inbox GET200, empty card hidden. Injected inbox503 keeps groups and shows Retry invitations. |
| 02 | PASS | Separate verified identity/session. Signing out User2 preserved User1 UI and approved account access. |
| 03 | PASS | One create200, opened saved group without false discard warning. Genuine unsaved-name guard warned and Cancel retained text. |
| 04 | PASS | Group renamed200 and persisted after reopen. |
| 05 | PASS | Incomplete draft saved/reopened; duplicate/date/72-combination prompts, 64-combination recovery, original idea/example and four layouts passed. Short-height actions reachable by scrolling. |
| 06 | PASS | Manual current-roster decision created200, reopened, renamed Shared Kit Pickup. Saved public choices and two participants preserved; cosmetic name is directory metadata, not frame.title. |
| 07 | PASS | Username inbox send/accept and reverse-role shared-email private-link acceptance200. Both provider identities verified, delivery guidance truthful; no recipient username/email/token in group projection. |
| 08 | PASS | Native modal, private answer controls, public progress, focus, Escape, phone fit and unsaved-edit cancellation passed. Opening submitted no command. |
| 09 | PASS | Both owners saved200 independently; first owner conditions preserved, two saved progress and owner/public projection boundaries checked. |
| 10 | BLOCKED | Manual outcome command200, no proposal after183678ms and later readback; REASONING, zero approvals. No resubmission. |
| 11 | BLOCKED | Real AI200, original restaurant/day alternatives retained, notice shown, saved draft create200 and both private saves200. Outcome accepted200, remains REASONING; joint final approval untestable. |
| 12 | BLOCKED | Real AI200 retained Museum/Park, requested missing days. Supplied dates manually, create200 and both private saves200. Outcome accepted200 on supported READY readback, remains REASONING; no final proposal. |
| 13 | PASS | Reload restored public work; two live stale409 conflicts resolved using Keep my edits and Use latest saved draft. Injected lost save/create200 acknowledgements recovered by reads, one create. Delayed real AI200 delivered once preserved newer local edits and listed prior draft separately. |
| 14 | PASS | INJECTED request-inventory503: original manual route saved/created200 with no automatic AI retry. Real provider transport outage not observed. |
| 15 | BLOCKED | Join and explicit ongoing inclusion preserve old answers/confirmations; newcomer saves directly, two saved. Finished-decision preservation lacks a completed F because outcomes never finished. Existing contradictory roster reset copy observed. |
| 16 | BLOCKED | Independent two-person R created; User1 saved. User2 UI save had no matching HTTP acknowledgement; readback shows only one saved. No retry or stale-approval claim; no proposal existed to test retirement. |

Case-level UTC, status and references are retained in the observations/network artifacts. LIVE is the default; response-loss/delay and inventory/inbox failures are explicitly INJECTED. Concurrent-editor conflicts used real live state and normal authenticated UI saves.

## Outcome blocker and remaining work

M's accepted command reference `813fd19b-ab5e-4dcf-aa4b-64d85b010557` returned200 at22:11:09Z, then remained REASONING for the full three-minute observation and subsequent reads. A's reference `911e9328-7303-4bdc-848a-66ff601b09eb` and B's later accepted command also remain REASONING with two saved participants and zero approvals. A/B received shorter follow-up observations after M established the shared unresolved dependency; no per-A/B three-minute claim is made. [Final supported reads](evidence/observations.json), [pending UI](evidence/case10-pending-outcome.png), [public progress](evidence/case09-public-progress.png).

The independently read worker schedule is DISABLED. This is observed configuration alongside the non-progressing requests; the run did not establish the exact queue/worker execution or effective-permission cause. The legacy metadata workflow's separate queue-event helper returned LIVE_API_CHANGED against its historical default, so no queue journal, global total or complete spend readback is claimed. Do not infer a new IAM blocker, enable the schedule, clear these jobs or resubmit them from this report.

Duplicate check links this remaining managed-execution work to [OPS03](../../../operations/OPS03/ticket.md) and this E2E02 ticket. Next: inspect the current-source owned queued jobs through the existing bounded operations path, establish actual processing, then resume the same accepted outcomes and obtain two explicit approvals. Afterwards qualify completed-F membership preservation and independent-R stale approval behavior. Keep unknown R separate: its second UI save lacked an HTTP acknowledgement and exact body/key capture; only one saved owner was read back. It was not retried and its failed-action screenshot is unavailable. No root cause is asserted for that browser action.

The live roster panel still says “Continuing resets every old frame confirmation…” even though joining/addition preserved the answers and the same panel promises preservation. [Actual UI](evidence/case15-roster-copy.png), [already documented duplicate](../../../ff/FF10/comparison.md). This remains a copy follow-up alongside [FF08](../../../ff/FF08/ticket.md); no parallel implementation claim was opened.

## AI, recovery and evidence limits

Three explicit public AI requests returned200, including the deliberately delayed response; no automatic paid retry or optional private-notes call was made. Exact [A](evidence/ai-a-diagnostic.json) / [B](evidence/ai-b-diagnostic.json) log reads confirm provider dispatch, completion and saved output on755440b: input1997/output238, **2235 tokens for those two requests only**. Third-request token usage and total cost are unavailable. [A semantic review](evidence/ai-a-semantic-review.json) confirms the two supplied dates despite named-option formatting; the initial exact-string assertion was overly strict. B supplied an actionable missing-day prompt instead of invented dates.

Corrected runner mistakes remain in the raw observations: fetch Response.ok is a boolean, the example has two return controls, an unchanged AI title leaves Save disabled, copy-link acceptance uses Accept group invitation, and a new SRP tab needs its own session. A controlled unsaved-edit guard also prevented an injected inbox navigation; that subcase was rerun from a clean Groups view. Positive supported readbacks and the corrected checks support the PASS cases; these local errors are not silently counted as application failures or backend idempotency proof. Initial screenshots conservatively masked some unrelated public content; the verified replacements below show the intended layouts. The stale-editor screenshot captures the form above the resolution controls; both controls and their completed actions are verified in observations, rather than claimed visible in that image.

## Screenshot index and checks

The first safe screenshot was opened successfully. All 23 PNG files have valid signatures/dimensions and hashes in [the index](evidence/screenshot-index.json). Selected evidence:

- [Create](evidence/case03-created-group.png), [rename](evidence/case04-renamed-group.png), [validation](evidence/case05-validation.png), [combination limit](evidence/case05-combination-limit.png).
- Verified editor [desktop light](evidence/case05-verified-desktop-light.png), [desktop dark](evidence/case05-verified-desktop-dark.png), [phone390×844](evidence/case05-verified-phone-light.png), [short844×390](evidence/case05-verified-short-dark.png), [reachable short actions](evidence/case05-verified-short-actions.png).
- [Decision modal](evidence/case08-modal-current.png), [phone modal](evidence/case08-phone-current.png), [public progress](evidence/case09-public-progress.png), [AI editor](evidence/case11-ai-editor.png), [stale editor](evidence/case13-resolution-choices.png), [roster copy](evidence/case15-roster-copy.png).

Final-outcome images are absent because no proposal completed. No raw HAR, private answer bodies, credentials, invitation link or real identity is published. All fixtures and pending requests are retained; cleanup did not replace core testing. Application sources, installed services and worker schedule are unchanged. Existing full-suite baseline failures were not rerun or reclassified. No readiness/reliability percentage is supported. The rerun reporting claim is released; E2E02 qualification remains blocked.
