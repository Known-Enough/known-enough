# OPS03 — Recoverable distributed model jobs

**Coding-first scheduling — user direction, 2026-10-06:** The coding phase follows the checked coding checkpoint of OPS02, not deferred administrator installation. Complete durable job/lease/retry code and tests now; defer missing queues/permissions/runtime installation and managed proof. Follow [the current two-phase queue](../../../../coding-first-plan.md); record CODE_READY and release a checked claim if mandatory cloud proof remains, without calling the whole task DONE. Older administrator-first scheduling dependencies below are superseded; original technical acceptance remains. No new worker or active claim is created by this update.

Make AI jobs recover safely across worker restarts and retries, with current permissions and spending limits checked.

**Status:** Coding phase eligible after OPS02's checked coding checkpoint; final administrator/managed completion deferred.

**Next step:** After OPS02, claim the shared queue task and prepare the scoped implementation. Authorized cloud operations use the verified OPS00 GitHub path; routine work must not depend on per-task A-only CloudShell commands. Spending, migration/deletion and outside-envelope changes retain their specific authorization.

**Related work:** [ASSESS07](../../live-testing/ASSESS07/README.md), [ASSESS06](../../../historical/completed/assessments/ASSESS06/README.md).

[Full ticket](ticket.md) · [Task guide](../../../README.md) · [Current board](../../../../task-board.md)
