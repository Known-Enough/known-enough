# Current pilot limits — 2026-10-02

This is the implemented boundary, alongside [contracts](contracts.md), executable source and the [assessment](full-assessment.md). Local verification does not establish managed LIVE04 acceptance. Use fictional synthetic inputs only until the required service/privacy checks are recorded.

## Capacity

Accounts, groups, invitations, public drafts and decision bindings share one versioned NP#GROUPS/STATE record. Both memory and DynamoDB adapters cap its serialized JSON at 300,000 bytes. Nominal maxima: 256 accounts, 32 groups, 16 members/group, 64 invitation records, 64 drafts and 64 decision bindings/group. The byte limit can arrive first: realistic large public frames exhaust it well below 64 drafts. Independent groups contend on the same record; six conditional-write attempts bound retries. Admission fences deliberately invalidate delayed work after any aggregate version change.

The API returns strict CAPACITY_EXCEEDED / HTTP 507 for byte and service count limits. The browser explains that retrying cannot free capacity. Rejected transactions preserve prior records; memory has the same cap. Do not clear records, raise caps beyond the DynamoDB item bound, or erase consent/replay history to get past this error. No general archive operation exists. [OPS01](tasks/OPS01.md) must provide partitioning and safe archival before wider enrollment; this limitation is not called fixed by documentation.

## Retention and deletion

Owner conversation turns are transient active-request memory, absent from durable job payloads, repository records and application logs. Confirmed structured conditions, current drafts and consent/replay state remain in decision storage; public group drafts and invitation hashes remain in the group record. Cleanup of live-QA removes exact synthetic run-owned actors, group/decision records, secret login data and owned mailbox. A cleanup failure blocks the next writable lease. QA logs/artifact retention is seven days where configured; retained tables, pool and installation artifacts survive rollback. Tags/expiry timestamps alone do not delete resources.

There is no general participant export/account/group/decision erasure API, backup purge or provider deletion proof. Deleting an active row does not establish backup/provider erasure. Do not promise a real-person retention window from synthetic cleanup. [OPS02](tasks/OPS02.md) tracks configurable retention/export/authorized erasure plus actual managed verification before real-person use. Cloud retention changes or deletion still require separate authorization and A coordination.

## Jobs and spending

Model jobs use a bounded process-local queue and transient request data. A process restart loses unfinished work; multiple Lambda instances do not share the in-memory queue/lease. Current account-wide live-QA limits are enforced by DynamoDB AUTH/LEASE/DAY/TOTAL transactions before calls, independently of local queues. Reservations survive cleanup and failed provisioning. This is an approved finite synthetic test envelope, not a general application-wide billing controller.

No SQS/DLQ consumer or distributed durable job lease is implemented. [OPS03](tasks/OPS03.md) must add recoverable ID-only work with fresh admission/context/budget guards before distributed delivery is advertised. Never enqueue raw owner conversations. Already authorized model work may consume a reservation before a later authority change; stale output cannot commit or create consent.

## UI and access

Group refreshes abort superseded requests and commit account/groups together only for the current component/load. Actions are disabled during refresh; a failed current refresh clears retained account/groups, invitation link and recipient fields. The last validated view can remain visible while checking but cannot authorize an action. Browser API requests combine caller cancellation with a 45-second deadline. Verified server identity and commit-time admission fences remain the authorization boundary.
