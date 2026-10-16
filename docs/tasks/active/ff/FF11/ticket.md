# FF11 — A real decision modal with direct answers

Status: PUBLISHED / A claim released; user manual acceptance pending. Latest user direction removes the separate shared-choice review flow, superseding earlier FF05/FF06 confirmation-step requirements for explicit private-answer saves.

Open decision itself opens a native accessible dialog with title/status, short public summary, own saved-answer summary, participant progress and the answer form directly visible. There is no separate shared-frame confirmation screen or private-answer three-step wizard. Extra notes and conditions are optional expansions; synthetic-processing consent remains explicit. Viewing alone submits nothing.

Each explicit authenticated CONFIRM_PRIVATE_ANSWERS save atomically binds that owner's selections to current shared terms using existing versions/idempotency/retention checks. It does not require other participants' prior confirmation. Current owner frame binding is recorded as part of their save, not on opening; no final proposal is approved. Direct edits preserve others' answers/public frame, retire earlier proposals/dependent permissions, preserve refused requests and require fresh approval of a new proposal. Actual shared-term revisions retain their existing version rules. The legacy standalone confirmation command remains compatible. Optional private AI notes can be prepared before others answer; model commits remain owner/context/version/retention bound and selection remains explicit.

Final proposal approval/disclosure permission/processing consent are preserved. NONE remains clarification, unavailable options fail strict validation, stale saves cannot mutate a different version, and finished decisions do not show an editable answer form. Native close/Escape use the existing unsaved-work guard. No backend/storage schema, route, IAM setup or model change is needed.

Static TypeScript/frontend build/changed-source lint passed; no automated/live tests, AI calls or participant actions. User manually checks after compatible publication. Existing tests for the superseded review flow were not run or updated under the no-tests instruction; no functional acceptance claimed.

Publication: [receipt](../../../../review-artifacts/FF/open-decision-modal-publication.json). Frontend0419904/Amplify109; native runtime e192cf1/APIb6dc8215/worker0f6b56df, enabled matching source, totals unchanged. New source preflight executed successfully before code replacement. Seven public files verified by release workflow; no tests/model/participant calls or new AWS setup.
