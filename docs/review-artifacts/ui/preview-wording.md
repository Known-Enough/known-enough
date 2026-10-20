# Preview wording cleanup

User direction: rewrite the audited customer-facing wording, keeping this a preview and preserving behavior. User performs manual acceptance; no product tests.

## Changes

- Plain next steps for registration, access approval, group actions, drafting, private answers, proposals and chat. The preview owner is named as the access contact; no claim that a request is actively being reviewed.
- Shorter preview and privacy information, with fictional-data consent, AI processing, outcome inference, independent approval and retention limits retained.
- Accurate example walkthrough: current button names, automatic inclusion of new members in unfinished decisions, preserved answers and unchanged finished decisions.
- Consistent Decision chat / Private assistant labels and explicit Post and ask AI wording. Connection information retains the model and protocol details, and explains the web preview and limited conversation context.
- Deterministic server clarification and assistant replies use the same plain wording. Model prompts, generated prose, existing stored messages and data are unchanged.
- Session and uncertain-result messages avoid claiming unsaved work survives sign-in or claiming a failed acknowledgment proves a save failed.

## Scope evidence

Static TypeScript syntax-tree comparison across all 23 changed source files found only text-literal / JSX-text differences. Element structure, expressions, conditions, calls, enums, numbers, requests, response contracts, consent values, permissions, models, limits and retry behavior are unchanged. The internal exact-text marker for saved None answers is preserved. No CSS, dependencies or tests changed.

Type checking, changed-source lint and production build passed. No product/unit/browser/live tests, account actions, email or model calls were made. Publication uses existing compatible packages and restores the original worker schedule; the final receipt records readback separately from manual acceptance.

## Limits

This is a wording cleanup. It does not claim to fix transaction failures, model accuracy, stale responses, background processing or unrelated audit behavior findings. Historical saved messages keep their original text. Support references and diagnostic logs remain available for debugging. Preview safety and consent remain enforced.
