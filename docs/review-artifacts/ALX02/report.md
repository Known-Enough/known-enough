# ALX02 — Saved group chat and private assistant

Published on 2026-10-19; [publication receipt](publication.json). Native API/worker source `4edb076` is installed with matching enabled admission and the original worker schedule restored ENABLED. The observed frontend is Amplify140/source `dd8fb8b`; ten public files match their published hashes, and chat/status route CORS and anonymous authentication checks pass. Authenticated manual chat and real-provider acceptance remain untested by this task.

Implementation baseline: clean ff-only pull of main `1d45162`. Existing E2E02 documentation was preserved in a local stash, pulled safely, and restored with both shared histories. All 71 preserved handoff files and the dedicated browser spec are now published. No participant action, AI probe, new IAM, CloudShell, agent, chat or automation was performed during this task.

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

## Publication evidence

The coordinated native release [39186651090](https://github.com/Known-Enough/known-enough/actions/runs/39186651090) verified API `502fb8cf` and worker `5b3519ae`, then rebound and restored empty matching admission without TOTAL writes. During the interruption, existing A frontend publications retained the ALX02 commit: [39198471205](https://github.com/Known-Enough/known-enough/actions/runs/39198471205) installed the five chat routes, and the observed [39199860877](https://github.com/Known-Enough/known-enough/actions/runs/39199860877) published Amplify140. Fresh ff-only intake preserved those later UI changes; backend, chat component and route declarations still match the checked implementation.

[Schedule restoration 39200009805](https://github.com/Known-Enough/known-enough/actions/runs/39200009805) observed one ordinary empty tick and left the original rule ENABLED, reporting zero paid dispatches. [Final readback 39200144414](https://github.com/Known-Enough/known-enough/actions/runs/39200144414) confirms current-source enabled admission, zero active jobs/slots, standing authority, synthetic retention and active migration. Its `sourceMatches=false` compares the later tooling checkout with the installed runtime; the control correctly matches installed runtime `4edb076`.

The aggregate reserved-token and reserved-cost counters increased by 36,864 and 20,000 respectively between the initial and final reads; runs/messages were unchanged. Attribution and actual billed charges are unverified. Publication performed no provider probe and preserved those counters; source-rebind and admission guards report unchanged totals within their checks. Do not interpret reservation ceilings as actual usage or claim initial-to-final totals were unchanged. Exact values and the two corrected pre-credential source-guard attempts are retained in the receipt.

[Public readback](public-readback.json) records ten matching HTTP200 asset hashes, all five chat labels, four OPTIONS204 responses with the expected origin and four unauthenticated GET401 responses. [Runtime guards](runtime-guards.json) and [final control/queue readback](final-control-readback.json) contain finite sanitized metadata only. The earlier [validation checkpoint](validation.json) remains dated implementation evidence; its publication-pending fields describe that earlier time.

## Publication constraints

Matching native API and worker packages must remain coordinated with the five chat/status and OPTIONS routes in `infra/zz/application-config.json` and the frontend. GET/POST retain the current JWT integration; OPTIONS is unauthenticated as in the existing application installer. Preserve the native package, data, model authority, usage totals, unknown jobs and original worker schedule. Do not roll an older strict state reader over new chat data without a compatible package/backup. No new table, provider or IAM widening is needed by this implementation.

Model integration follows the existing forced-tool mechanism documented in [Amazon Nova tool choice](https://docs.aws.amazon.com/nova/latest/userguide/tool-choice.html); local schema validation remains independent of provider compliance.
