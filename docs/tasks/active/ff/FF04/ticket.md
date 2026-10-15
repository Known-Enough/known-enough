# FF04 — Delete saved drafts and decisions

Status: IN_PROGRESS / A

User requests an option to delete drafts and decisions. Add organizer-only confirmed removal to the existing group UI and authenticated remove endpoint. Use retained deletion markers so stale links, saved-request replay and background commits cannot restore deleted items. Hide deleted items from group snapshots and deny participant/display access to deleted decisions. This is removal from the app, not certified erasure of historical records. Preserve other group decisions, admission, private data and accounting. No tests or AI calls in this chat; user performs manual acceptance. Build/type compilation and compatible publication are authorized.

Scope: group contracts, native and existing group services/HTTP, draft recovery, group decisions UI/styles, compatible runtime/frontend publication and task/A records. One A writer; previous FF03 model-format rejection remains a separate unresolved report.

## Implementation checkpoint

Organizer buttons and explicit keep/delete confirmation use existing authenticated POST group/remove with a strict kind/id/group-version command. Native group transactions mark replay-bearing draft/binding rows deleted and retain their IDs. Group snapshots exclude them; draft reads/edits/create/replay, roster revision, participant/display access and durable job fences reject deleted records. Deleting a decision also marks its originating draft. Deleting a stale draft is allowed without needing to revive its roster. Existing membership removal is unchanged. Group roster version stays unchanged so unrelated decisions remain usable; storage header revisions fence concurrent work. No IAM, route, signup or model invocation required for removal.

Stored history and existing 64-record capacity bounds remain; this feature does not implement retention erasure or recover capacity. After actual deletions, rollback packages must understand the optional deleted marker; do not restore an older parser or remove markers to regain access.

Manual check after publication: open a group you organize; cancel a draft deletion once, then confirm it; refresh and confirm it stays absent. Delete a decision, refresh, and check its old link no longer opens. A regular member should have no delete action. Other decisions should remain accessible. No automated tests run by A.
