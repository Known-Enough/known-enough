# ALX02 — Saved group chat and private assistant

Implementation is prepared for coordinated publication. Baseline: clean ff-only pull of main `1d45162`. No live deployment, participant action, AI probe, new IAM, agent, chat or automation was performed. Existing E2E02 documentation was preserved in a local stash, pulled safely, and restored with both shared histories.

## Behavior

The simulator has **Group chat** and **Private assistant** tabs, a single composer, message bubbles, server-verified names and timestamps. Group chat says “Everyone in this decision can see these messages.” Reopening fetches the saved history; current authorized members see group posts. Each participant sees only their own private thread. Names and scope come from verified server membership; callers cannot choose an author or private owner. Group history refreshes every fifteen seconds while the modal is active and visible.

A private message or assistant reply can be shared only through a read-only preview and an explicit **Post to Group chat** action. The server checks the original private owner and exact selected text. Sharing is an ordinary group post and makes no AI call. Each tab keeps its own unsent composer text while open.

**Ask Alexa+ to reply** is optional. A separate explicit consent checkbox precedes model use. Natural questions use the existing Amazon Nova Lite provider through a bounded response-plan tool. The model can select a topic, supplied option indexes and a follow-up question. It cannot provide status prose, approval facts, arbitrary choices or commands. The server renders all result/status/approval facts from a fresh shared projection, and rejects a response if that projection changes before commit. Suggestions remain suggestions; only the decision screen saves answers, permissions or final approval.

The provider receives at most eight of the sender’s messages and the server replies to them in the same tab, plus bounded shared choices. It never receives peer chat, another private thread or any saved owner answers. MCP remains a shared read-only interface; its actual connection check runs only when **Technical details** is opened.

## Persistence and recovery

Chat is an optional strictly validated field in the existing native decision state. Public and owner snapshot DTOs, negotiator input and existing decision commands do not contain it. Writes retain current admission, membership, binding, activation and retention conditions. A new viewer can read without accepting AI processing; the first explicit send establishes/checks the normal retention stamp.

Each message expires at the earlier of thirty days or the current author retention deadline. Expired messages are excluded on every read and pruned from the active record when that record is read or appended. Native decision/group deletion tombstones immediately block chat access; existing lifecycle erasure removes the containing state, and owner erasure removes that owner’s private/group messages and corresponding assistant replies. Existing retained deletion/backup records keep their established lifecycle; this does not assert instantaneous physical backup erasure. History has a 256-message/96KB combined bound and returns the existing capacity error instead of silently discarding unexpired messages.

A sender’s message is persisted once before any paid invocation. CHAT jobs use the existing durable control, authority, reservation, usage, source and transaction fences. The final reply and actual usage commit together. Unknown calls retain their reservations and are never automatically retried; status reads never invoke a provider. A changed deployment source preserves UNKNOWN for an older incomplete request. Browser recovery saves only an opaque request selector, keyed by verified viewer/decision/tab, and reconciles an interrupted send after reopening. Message text is not saved in browser storage or logs.

## Validation

See [validation.json](validation.json) for exact results and current code hashes. Focused application/native HTTP/storage/erasure/job checks and the dedicated browser scenarios cover isolation, identity forgery, explicit sharing, reopening, expiry, unchanged answer/approval state, stale responses, lost acknowledgments, unknown calls and source changes. Browser/provider data is synthetic and intercepted. [Mobile dark preview](chat-mobile-dark.png) and [desktop light preview](chat-desktop-light.png) show the actual built component with fictional conversation data.

The full check is not green. Its failures are compared by full test name with a fresh `1d45162` checkout. Existing compact-decision browser failures were independently reproduced on that baseline as well. No full-suite or live-service acceptance is claimed.

## Publication handoff

Publish the matching native API and worker together through the existing guarded coordinated release, declare the five authenticated chat/status and OPTIONS routes in `infra/zz/application-config.json`, then publish the matching frontend. Keep GET/POST authenticated with the current JWT integration; OPTIONS stays unauthenticated as in the existing application installer. Preserve the current native package, data, model authority, usage totals, unknown jobs and original worker schedule. Do not publish the new frontend against ALX01’s older API, or roll an older strict state reader over new chat data without a compatible package/backup. No new table, provider or IAM widening is needed by this implementation.

Model integration follows the existing forced-tool mechanism documented in [Amazon Nova tool choice](https://docs.aws.amazon.com/nova/latest/userguide/tool-choice.html); local schema validation remains independent of provider compliance.
