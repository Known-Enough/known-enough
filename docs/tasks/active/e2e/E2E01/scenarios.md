# E2E01 scenario checklist

Record each independently as PASS, FAIL or BLOCKED with expected/observed behavior and evidence. These are distinct journeys, not ten retries of the same prompt. Inspect current UI before choosing exact controls.

1. Sign in with both dedicated users in isolated sessions. Confirm identity/session separation and groups entry.
2. Create and rename a synthetic group; refresh/reopen and confirm the saved name and correct organizer.
3. Invite User 2, accept in their session and confirm shared group membership without session mixing.
4. Create a decision from a detailed public idea with explicit options; check short title, editable name and saved shared choices. Example: fictional dinner, two dates, three venues with estimated prices.
5. Create a separate decision from a vague idea and use the creation-modal example/guidance. Confirm help produces usable bounded choices or an actionable question; no stuck unsupported-response loop.
6. Each participant reviews/confirms the shared choices where required; check participant statuses and compact overview/Continue navigation.
7. Save distinct private selections with each user through the modal. Confirm choices survive reopening, UI summaries belong only to the current user and the other session exposes no private answers. Use synthetic values only.
8. Complete a compatible-input proposal and each user's required final approval. Confirm the final shared outcome and status; no automatic approval for the other user.
9. In a separate group, save User 1's ongoing-decision answers before inviting User 2. Accept/include User 2 and confirm original answers/progress stay, with no repeat review solely for joining. User 2 supplies their own answers. No third account needed.
10. Complete a separate User-1-only decision, then add User 2 to that group. Confirm membership does not reopen or change the completed decision, outcome or historical approvals. Respect permitted outcome visibility. No third account needed.

Use different synthetic content beyond one restaurant transcript where appropriate (for example outing or shared purchase). Record exact deployment/version and request references on failures. If an earlier prerequisite fails, continue independent scenarios where safe; dependent scenarios stay BLOCKED rather than assumed PASS. Do not delete unexplained failed-request evidence or loop paid retries.
