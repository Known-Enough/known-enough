# FF10 example comparison

Checkpoint UTC: 2026-10-16T00:36:02.376898+00:00. Prepared baseline main `7139b22bf0cf8fda29ee3a1099f015fd99749b60`; this task changes only guidance in `apps/web/src/decision-guide.tsx` and task/tracking documentation. No product transitions, placement, styling, authentication, drafts or request recovery changed.

## Records and source examined

Read the FF03 [onboarding receipt](../../../../review-artifacts/FF/onboarding-publication.json), FF05 [ticket](../FF05/ticket.md) and [publication receipt](../../../../review-artifacts/FF/private-answer-modal-publication.json), FF06–09 tickets and [delivery](../../../../review-artifacts/FF/ff06-09-code-ready.md), current A/B handoffs/work logs and claim log. Compared actual `group-decisions.tsx`, `private-answers-modal.tsx`, `connected-decision.tsx`, `decision-copy.ts`, `decision-architect.ts` and the FF08 application roster transition; existing group/profile/navigation implementations were already documented in the FF06–09 checkpoint. No historical task description was treated as live acceptance.

## Anonymous website observation

Public site: [Known Enough](https://main.d143q5ravxp5av.amplifyapp.com/). The web reader reported the URL inaccessible, while ordinary anonymous HTTP GET succeeded. The landing HTML and six JS/CSS files all returned200 and matched the FF05 recorded SHA256 bytes (7/7). [Exact sanitized readback](live-comparison.json) records every path/hash and observation time. This identifies the observed frontend artifact as matching source `a3e665f7390ca14fde24150374f6b6a455ba9f0f`, Amplify103, from the checked receipt; it does not verify installed backend source or every deployed file. HTML is a client-rendered shell. Visual rendering, authenticated group/decision screens, profile data, backend configuration and actual participant behavior were not observed; no sign-in or credentials were requested.

FF06–09 source `7139b22` is newer and unpublished. The old standalone guide/live entry points therefore remain expected in the observed artifact; this is a publication gap, not evidence that FF09's prepared source failed. The example targets the latest prepared flow rather than obsolete live navigation. FF10 performs no deployment.

## Content comparison and changes

| Area | Old example | Actual prepared implementation and updated guidance |
| --- | --- | --- |
| Creation | General AI draft review; vague help action. | Name Continue with AI, Help me describe my idea, separate provisional-option help, saved follow-ups/review checkbox and Create decision. Viewing the example itself never invokes these actions. |
| Names | “Choose our group dinner” without explanation. | Explain short defaults from the public idea and editable Decision title; show an explicitly edited “Group dinner plan”. IDs/links stay separate. |
| Shared review | General prerequisite. | Each person uses Confirm these shared choices before private saving; organizer cannot confirm for others. |
| Private input | Private conversation and AI interpretation treated as the primary path. | What works for you? opens Your choices → Extra notes → Review. Show exact acceptable sets, Any listed option works, optional first choice, explicit fictional processing/review checkboxes and Save my private answers. Direct selections require no AI interpretation. |
| Scenario consistency | Restaurant/date alternatives plus budgets and prices not represented in those choices. | Restaurant/date-only fictional scenario with explicit dates. Alex accepts Olive Room/Noodle Corner on17October; Sam accepts Noodle Corner/Garden Table on either16/17October. Both prefer Noodle Corner. The illustrative Noodle Corner/17October proposal fits both sets. No price/budget inference or claimed generated result. |
| Optional notes | Mandatory AI message interpretation implied. | AI help is optional, consent-gated and reviewed; it cannot rewrite direct choices. None-work and unsupported needs stay unresolved rather than implying agreement. |
| Overview | Not described. | Own private summary plus public progress only; Continue and Explore proposals when applicable. Others' selections/notes stay private. |
| Approval/completion | General “approve or ask for a change”. | Review proposal, review shared/private parts and explicitly Approve this exact proposal. Every required person must approve the same outcome; no best-result guarantee or booking/purchase. Disclosure/adjustment consent stays separate. |
| Joining | Not described. | Group admission does not enroll a decision participant. Organizer explicitly updates participants; additions preserve existing answers/confirmations, newcomer provides their own, unfinished proposal needs fresh approvals, finished record stays intact. |
| Placement/recovery | FF09 already embeds example in creation. | Unchanged: local read-only step/perspective state; form stays mounted on return; no new route/link/API/submit/recovery changes. |

One existing product-copy discrepancy was observed: `group-decisions.tsx`'s roster panel still contains the old unconditional “Continuing resets every old frame confirmation…” sentence, despite the addition-only application branch preserving them. The example follows the implemented branch and distinguishes additions from material revisions. That existing panel sentence is recorded for a separate focused copy correction; FF10 does not change unrelated product UI or claim whole-app copy/functional acceptance. The FF06 rename route/coordinated native reader publication requirement is also unchanged.

## Verification and remaining work

Node24.21.0/npm11.19.0 static typecheck, production build/browser boundary, lint/import boundaries579, immutable reference hashes7 and whitespace checks passed. No automated/unit/browser/live functional tests, signup, participant action, model call, AWS/CloudShell setup or deployment. All website reads were public static GET observations. CODE_READY, publication and manual acceptance are distinct.

After compatible publication of FF06–FF10, the user can open a real creation modal, view the fictional four-step guidance, switch personas, return and confirm unsent text/draft/request state remains. Check the wording against the shared/private/proposal steps and both themes/mobile. No acceptance or real actions are inferred here. E2E01 remains unclaimed.
