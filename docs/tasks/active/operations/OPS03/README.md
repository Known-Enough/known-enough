**Current status: READY / unclaimed.** User moved the original mailbox cleanup to [DEBT01](../../technical-debt/DEBT01/README.md). B can freshly claim OPS03 and continue live qualification using new independent synthetic fixtures; preserve current-run cleanup, participant consent and cumulative usage. Do not repeat installation or the old mailbox login. Earlier statuses below are historical.

# OPS03 — Recoverable distributed model jobs

**Coding-first scheduling — user direction, 2026-10-06:** The coding phase follows the checked coding checkpoint of OPS02, not deferred administrator installation. Complete durable job/lease/retry code and tests now; defer missing queues/permissions/runtime installation and managed proof. Follow [the current two-phase queue](../../../../coding-first-plan.md); record CODE_READY and release a checked claim if mandatory cloud proof remains, without calling the whole task DONE. Older administrator-first scheduling dependencies below are superseded; original technical acceptance remains. No new worker or active claim is created by this update.

Make AI jobs recover safely across worker restarts and retries, with current permissions and spending limits checked.

**Status:** READY / handoff to B; A claim released. Authenticated request connection and the dedicated automatic background runner are being integrated; installed live qualification remains unfinished.

**Next step:** The primary operations API is restored and independently checksum-verified in [run38166291308](https://github.com/Known-Enough/known-enough/actions/runs/38166291308). [Matching API and worker preparation](https://github.com/Known-Enough/known-enough/actions/runs/38180021249) passed. The user reports the worker stack CREATE_COMPLETE; do not repeat installation. Independently verify worker code/roles/rule, then publish matching bindings and qualify current owned consent/retention, recovery, usage and cleanup. The browser now supports queued requests and automatic result checking; local tests do not prove installed worker execution. Standing A/B project authority applies; existing data, counters and technical safeguards remain intact. [Current integration evidence](../../../../review-artifacts/OPS03/a-enqueue-runtime.md).

**Related work:** [ASSESS07](../../live-testing/ASSESS07/README.md), [ASSESS06](../../../historical/completed/assessments/ASSESS06/README.md).

[Full ticket](ticket.md) · [Task guide](../../../README.md) · [Current board](../../../../task-board.md)
