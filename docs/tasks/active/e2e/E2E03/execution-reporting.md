# E2E03 — Durable execution reporting

This is the required contract for the next E2E03 attempt. It does not recover the missing historical browser output or claim that a recorder has already been installed. Keep the small existing test scope; integrate this contract with the existing runner before test writes.

## Record before doing work

1. Create a new UTC run directory at `docs/review-artifacts/E2E03/<UTC>/`. Preserve the old report unchanged.
2. Outside the browser controller, write a RUN_STARTED event, initial `summary.json` and a short `report.md` containing three NOT_RUN cases, planned actions, serving-source evidence, start time, log links and the next step. Do not wait for a browser callback to create these files.
3. Read the files back to confirm the writer works, then publish the started checkpoint through the existing authorized repository workflow, using `[skip ci]` for evidence-only commits. A configured recorder or planned push is not a saved/published record. If persistence or initial publication fails, report LOGGING_BLOCKED and stop before product writes.
4. Keep the writer on the caller/host side, independent of the browser evaluation. Persist before dispatch and immediately after each returned tool result. Use one meaningful write per browser block: Save U1, Save U2, request outcome, Approve U1, Approve U2 or send optional chat. Inspect/read-only actions can be short separate blocks. Do not put the whole journey in a single opaque browser call.
5. Append each event using an atomic line append with flush/fsync. Update `summary.json` and the latest human-readable report by writing a private temporary file then replacing the old file. Never truncate the event journal to repair its appearance. One writer prevents interleaved records.

The task includes bounded recorder/wrapper integration if absent. No browser actions may begin on a promise that the final report will be written later.

## What every action records

Use short action IDs such as `reconcile.u1`, `case01.u1.save`, `case01.u1.readback`, `case02.outcome`, `case02.u2.approve`. Every meaningful navigation, login outcome, fixture selection, save, consent/approval acknowledgment, request-status check, persistence check, screenshot attempt and publication has a ledger entry. Do not log every keystroke or coordinate.

Append `ACTION_INTENT` **before** dispatch, followed by the actual observed result. An action may progress through DISPATCHED, HTTP_ACKED, VERIFIED, FAILED, UNKNOWN or SKIPPED; a click, HTTP 202, selected checkbox or missing exception is not by itself VERIFIED.

Each record has:

- UTC, run/case/action IDs, U1/U2 alias and stable context alias (no cookies or provider subject IDs).
- The intended operation, expected result, actual observation and evidence links. Log synthetic selections as counts/check results, not raw private answer payloads.
- Browser/tool name, tool-call correlation ID when available, start/end/duration, timeout and returned completion/exit status. Use `null` plus an availability reason when the platform does not expose one; do not invent an exit code or timeout cause.
- For observed HTTP: method, normalized route (`/decisions/:id/...`), status and allowlisted server request reference. State HTTP_NOT_OBSERVED separately from REQUEST_NOT_SENT. Do not record request/response bodies, arbitrary headers, full URLs with tokens or cursor values.
- For readback: whose authenticated view was inspected, whether the saved state matched, and whether it is authoritative app/server state versus an unacknowledged local checkbox. No other owner's private selections.
- Screenshot path/status. If unavailable, record why: closed page, unavailable controller, capture error or not attempted. No blank evidence cells.
- Any sanitized error domain/code/message and the next safe action. Domains: APP_HTTP, BROWSER_JS, AUTOMATION, ACCESS, LOGGING or UNKNOWN. Cap error text to a useful short excerpt; retain the safe request/tool reference. Root cause is CONFIRMED with evidence or UNVERIFIED, separately from the observed symptom.

Minimal example — this is a format example, not execution evidence:

```json
{"utc":"<UTC>","run":"<RUN>","case":"01","action":"case01.u1.save","event":"ACTION_INTENT","actor":"U1","context":"browser-u1","expected":"answer save acknowledged; own state persisted"}
{"utc":"<UTC>","run":"<RUN>","case":"01","action":"case01.u1.save","event":"ACTION_RESULT","state":"UNKNOWN","httpStatus":null,"httpAvailability":"HTTP_NOT_OBSERVED","toolErrorCode":"<ACTUAL_CODE_OR_UNKNOWN>","lastConfirmed":"case01.u1.selected","next":"read U1 saved state; do not save again"}
```

## Capture the runner failure, not only the page message

Install the existing tooling's available HTTP-failure, request-failure, page-error and browser/context-disconnect listeners before interacting. Project only safe fields into the host-side ledger; never save a raw console dump, full trace/HAR, credentials, browser storage state or private model output in repository artifacts. If a hook is unsupported, record its capability as UNAVAILABLE and name the caller-side evidence that remains.

The outer caller/wrapper must record the actual returned tool error, timeout, nonzero exit, disconnect or interrupted result even if the browser never reaches its own `finally`. On an unexpected stop, flush a failure checkpoint **before** trying to inspect the app again. If the tool supplies no cause, write `AUTOMATION_CAUSE_UNAVAILABLE`, the last returned tool status/reference and the exact last pending action; do not infer a server failure or user-data loss.

A stopped host or lost session can prevent finalization entirely. The previously persisted INTENT/last checkpoint remains evidence of that gap. A missing terminal record means RUN_INCOMPLETE, never PASS or "nothing happened". The next authorized intake appends a reconciliation record; it must not fabricate a missing end time or claim to know why the host disappeared.

## Incremental summary

Keep the compact human report readable, with links to these machine details. Update after each action/block:

```json
{
  "runId":"<UTC_RUN>",
  "state":"RUNNING",
  "startedAt":"<UTC>",
  "lastProgressAt":"<UTC>",
  "endedAt":null,
  "lastConfirmedAction":null,
  "inFlightAction":null,
  "cases":{"01":"NOT_RUN","02":"NOT_RUN","03":"NOT_RUN"},
  "plannedRequests":{"outcome":1,"assistant":1},
  "observedRequests":{"outcome":0,"assistant":0},
  "requestObservationComplete":true,
  "providerUsage":{"calls":null,"tokens":null,"availability":"NOT_READ"},
  "evidence":[],
  "error":null,
  "nextSafeAction":"read-only reconciliation of the original fixture",
  "publication":{"lastConfirmedUrl":null,"unpublishedLocalChanges":true}
}
```

The optional assistant may be skipped; planned counts are ceilings, not execution. If the runner disappears during a possible request, set request-observation completeness false and unknown counts to `null` instead of reporting zero calls. Source/fixture mapping and known server/tool references must be recorded before the dependent write; private session/credential material remains outside the repository.

## Recovery and finalization

- The first case in the next run is read-only reconciliation of the old selected group and any `Friday activity` decision. Record whether each user's answer exists, the visible saved-state version when available, any pending job/action and its actual public status. Distinguish absent, present, access denied and not inspected. Do not create an alternative decision to bypass the unresolved state.
- If an original save is already confirmed, use it as observed state and continue the remaining bounded steps without clicking Save again. If a request remains uncertain, preserve it and mark dependent work BLOCKED. Read-only inspection must be logged with its own intent/result; a second failed inspection is another visible failure, not erased history.
- On any normal completion or unexpected stop, update report/summary with end time if observed, completed/failed/skipped steps and reasons, last confirmed action, unresolved actions, exact safe error, evidence availability, usage availability and next safe read-only action. Publish the available checkpoint before the final chat answer.
- Publish at completed-case boundaries and unexpected stops, not only at the end. If a push fails, record LOCAL_ONLY, the actual sync error and last confirmed remote link. Missing final sync must never be described as a published report. Preserve files for the next intake.
- Final chat answer matches the report and links directly to its GitHub URL. It must say which case/step passed or failed, whether the fault is proven in the app or observed only in the runner, what is still unknown and what the next action is. Generic "browser ended" is insufficient without the named missing diagnostic and last recorded action.
- Keep the main report around 400 words and the event journal concise. The existing two-screenshots-per-case limit remains. Reporting adds no AI calls, new scheduled monitor, broad test suite or permission repair. DONE requires both required cases and their acknowledgment/readback evidence; visibility requirements cannot be waived to obtain PASS.
