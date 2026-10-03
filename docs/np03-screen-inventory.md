# NP03 screen and state inspection — 2026-10-01

B / verified Battosai1806; actual GPT-6 variant/effort unexposed. Implementation self-inspection with fictional inputs; no independent verdict or human feedback.

| Screen/state | Inspection and resulting behavior |
| --- | --- |
| Sign-in and registration entry | Mobile Chromium screenshot inspected; keyboard first action is Sign in or register. Explains signup, email verification and access request. Actual hosted Cognito signup/verification/errors are NP05. |
| Account request/pending/approved/disabled | Signed local HTTP browser transitions cover request, pending, admission and disable. Pending users cannot create a group; disabled users see the next action. Rejected account wording is implemented; actual rejection and managed old-session denial are NP05. |
| Group empty/create/member/invitation | NP onboarding renders two independent sessions, copyable recipient invitation, acceptance, persisted reload and organizer/member controls. Intended-recipient copy replaces misleading delivery wording. Expiry/replacement/wrong-recipient guards have NP01 API evidence; managed delivery and remaining rendered failure states are NP05. |
| Public draft and clarification | Draft review displays supported variables/options/rules and approvers. Heading receives focus; editing clears review and prevents unsaved creation. Unknown/malformed responses give a safe refresh/retry action without provider text. Unsupported draft and roster revision are API-qualified; additional live rendered clarification/revision states are NP05. |
| Shared frame and confirmation | Existing connected and NP browser flows inspect exact shared terms and independent checkbox confirmation. Frame versions are hidden from ordinary explanatory copy; explicit review action remains version-bound. |
| Private input and interpretation | Existing connected browser flow inspects private text, interpretation, selected-condition confirmation and clarification wording. Other sessions cannot see raw owner text. |
| Private negotiation | NP clarity mobile render checks exact adjustment, expiry, allow/decline and independent approval/disclosure explanation. Other owner sees no question. Existing permission can now be revoked through its original command. |
| Disclosure preview | NP clarity renders exact text and audience only to its owner; decline remains independent of proposal approval. Existing allow/revoke controls show expiry and warn that shared information cannot be unread. Published/variable-value/revocation transitions are further qualified in NP04 and managed behavior in NP05. |
| Proposal/approval/agreement | Existing connected regression renders exact public and owner values and independent approvals. Plain lifecycle copy distinguishes pending approvals from everyone approving the exact outcome. Generic groups use Current proposal and hide fictional template controls. |
| Shared display and simulated assistant | Existing browser regression inspects public/display role and retained simulated Alexa labels. Plain copy preserves synthetic/native-integration limitations; managed group display configuration is NP05. |
| Loading/error/retry/reconnect | Status announcements and busy regions cover account/group/draft work. Safe unknown-outcome copy retains retry identity and asks for refreshed state. Existing connected tests cover unknown outcomes, stale state and session handling; NP04 adds fresh-group checks. |
| Local demonstration | Existing local browser regression preserves honest local/synthetic privacy and simulation labels. This is preparation, not managed integration evidence. |

Before/after examples: authenticated owner route → your private conditions; internal status identifiers → complete lifecycle sentences; hypothetical proposal → current proposal for a new group; internal participant-ID entry → fictional participant name selection in the retained template flow. Public generic groups no longer show duplicate roster and legacy template invitations.

Mobile 390px/reduced-motion screenshots `/tmp/np03-mobile-signin.png` and `/tmp/np03-mobile-private.png` were visually inspected; no horizontal overflow. Browser focus/status/owner-isolation checks passed. No comprehensive screen-reader audit is claimed. External or unrendered service states explicitly transfer to [NP05](tasks/historical/superseded/NP05/ticket.md), as directed by the user; they are not fabricated inspections.

Focused browser checks: `np-clarity.spec.ts` and `np-onboarding.spec.ts`, 4/4. Final pinned full-check evidence is recorded in [NP03](tasks/historical/completed/next-phase/NP03/ticket.md). [NP04](tasks/historical/completed/next-phase/NP04/ticket.md) owns the fresh-group qualification.
