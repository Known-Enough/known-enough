# Native group deletion repair — 2026-10-18

Status: CODE_READY/A; publication and user manual acceptance pending.

The published UI and declared API Gateway route send `POST /groups/{groupId}/delete`, but the operations-managed participant HTTP router did not match `delete` and its native group session had no group-delete method. Only the older aggregate service implemented this action. The supplied client reference produced no events in the bounded read-only diagnostic [39147443829](https://github.com/Known-Enough/known-enough/actions/runs/39147443829); no exact historical HTTP status is asserted.

The native route now invokes an organizer-only, approved-account, current-version transaction. A retained group tombstone advances the group version; membership discovery edges become inactive in that same guarded transaction. Children and historical records remain stored. Session, membership, direct decision/display and background fences reject the deleted group; ordinary repository mutations cannot clear its marker. This avoids rewriting up to 128 saved children in one request. Existing identities, private data, participant answers, model controls and unrelated groups are preserved.

The dialog requires the explicit deletion acknowledgement, uses a valid server error reference when available, distinguishes known rejection statuses and offers a read-only group-list refresh. No automatic deletion retry is added. Deletion for the user's group remains their manual action.

Pinned Node24.21.0 typecheck, changed-source lint and production build passed. No unit/browser/live/model tests or group deletion by A. The existing schedule workflow gains an optional regression toggle (default remains enabled), so the user-directed publication can skip tests while retaining source, identity, empty-control, runtime and schedule guards. Publication must pause the existing worker only for the coordinated package replacement, then restore its prior enabled operation. No new IAM or CloudShell installation is intended.
