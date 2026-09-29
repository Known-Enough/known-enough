# KE12 simulated Alexa+ shared assistant

The connected web app shows **SIMULATED ALEXA+** to a signed-in participant or shared-display account. Ask “What is the proposal status?”, “Any approvals?”, or “Why this proposal?” The assistant requests `/decisions/christmas-decision/public` on every turn and answers from the newly parsed public snapshot. No Alexa host, MCP integration, model provider, AWS credential, paid call, or assistant write endpoint is used. The existing Cognito session is required; the server still enforces access.

The adapter in `apps/web/src/public-assistant.ts` builds a closed read model from `KnownEnough.PublicDecisionSnapshot.parse`. It selects status, required/recorded approval counts, exact current proposal identity, and up to three current viewer-authorized published statements or value disclosures. Long published entries are referenced in the public view instead of copied into assistant memory. It omits objective/description text, private owner fields, raw questions, and command tools. The same parser rejects an owner snapshot or any extra private field. Browser answers are deterministic text, not model output. React renders disclosure text as text, so public-objective or published-text instructions cannot direct an interpreter.

Conversation memory is an in-memory topic (`status` or `reasons`) plus the public decision/revision key. The UI keeps only the last six public answers, never submitted questions, and clears them when the public revision, proposal, viewer, status, or published information changes. A failed public refresh clears answers and returns an unavailable message. Sign-out unmounts the assistant. The assistant cannot approve, grant, publish, or infer a participant's private reason. “Why?” reports only currently published information, or says none was published; public terms and a heuristic result are not evidence of optimality.

## Evaluation, 2026-09-29

| Probe | Simulated browser/adapter result | Host/model result |
| --- | --- | --- |
| Proposal, approvals, follow-up turn | Reads current public count; retains status topic within one revision | No native host or model call |
| Direct “Who could not afford Europe?” and indirect contributor/objection probes | Refuses attribution; no private amounts or owner fields enter context | No native host or model call |
| Injection in public objective or user question | Objective is absent from assistant context; question cannot change the fixed status answer | No native host or model call |
| Stale agreement, revision, and API outage | Refetches before every answer; clears previous answers on change/failure | No native host or model call |
| Expired, revised, or audience-changed disclosure | Only the server's current exact-proposal, current-audience projection is admitted; old/absent and future-dated receipts are omitted | No native host or model call |
| Other room or mismatched API decision | Refuses cross-room wording; connected fetch rejects a decision ID other than the requested one | No native host or model call |

`PublicDecisionSnapshot` and the application projection enforce exact proposal version, semantic context, viewer audience, and current roster. An expired **unpublished permission** cannot be published by the server. A successfully published disclosure is a historical publication without a separate expiry field in the public DTO; later permission expiry alone does not erase that publication. Proposal revision, supersession, or audience change removes it from the current projection. This distinction is part of the KE09 follow-up, not an Alexa host claim.

Focused evidence: `apps/web/src/public-assistant.test.ts` covers the public adapter, private attempts, disclosure scopes, injection and state resets; `tests/e2e/ke12.spec.ts` drives the connected display UI with an intercepted public route, verifies one public GET per question, status changes, private refusal, and stale-answer clearing on API failure. That browser test uses synthetic snapshots and a mock display token; it does not establish live Cognito/API or native Alexa behavior. The sequential KE09 privacy follow-up remains required before external testers for this model/session boundary.
