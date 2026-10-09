# OPS00 checked operation requirements and recovery declaration

This RUN188 ledger maps the eight checked OPS01–03 **storage permission profiles** against the unchanged recovery-role proposal. It is an offline declaration comparison, not an IAM simulation, installed role inventory, policy attachment or managed acceptance. Historical [positive recovery proof](managed-two-run-proof.md) and [bounded denial proof](effective-scope-proof.md) retain their own sources/results; neither establishes the downstream profiles. Whole OPS00 remains open.

The new [report generator](../../../scripts/operations/capabilities.mjs) requires own B/numeric143764700, main/manual/exact expected and checkout source, plus all four byte-exact generated proposals. The existing credential-free [verification workflow](../../../.github/workflows/operations-verify.yml) emits capabilities-report.json before dependency installation and uploads it with the four proposals and four original reports. The machine report retains every statement ID, action/resource occurrence, complete required condition, matching recovery declaration condition and explicit UNKNOWN effective permission. It accepts no arbitrary IAM policies, principals, actions or resource targets.

The checked recovery declaration permits journal GetItem/PutItem only under `PLAN#*`, three journal metadata reads, six bucket metadata reads and manifest GetObject/GetObjectVersion/PutObject. It retains IAM/self-assumption/table/object-delete denials, TLS and exclusive manifest-create policy. Matching table/action names cannot promote PLAN access to a different leading key.

| Comparison of required action/resource occurrences | Count | Meaning |
| --- | ---: | --- |
| Resource/action reuse candidates | 9 | Six manifest occurrences across migration/archive and three journal metadata reads. Required conditions remain attached; effective access still requires actual proof. |
| Same action/resource, different leading-key scope | 20 | Existing journal GetItem/PutItem declarations use PLAN keys, while these profiles require other keys. |
| Resource/action absent from recovery declaration | 88 | Other tables, journal transactional conditions and other actions are not declared by the recovery role. |

These 117 occurrences repeat actions across distinct role profiles; they are neither unique permissions nor physical requests. No union of these profiles is authorized.

| Checked task/profile | Required boundary retained in the report |
| --- | --- |
| OPS01 participant | Legacy source/activation/copied-journal guards; scoped account/group/email/invitation/decision/member reads and transaction writes; joined decision reads/writes. |
| OPS01 migration | NP#GROUPS source freeze and activation; exclusive forward partitions/control; PARTITION journal CAS; pinned private manifests/exclusive creation. |
| OPS01 archive | Current activation plus group/account/installed operator authority; retained group tombstone; ARCHIVE journal CAS; pinned manifests. |
| OPS01 inspection | Exact metadata reads for source, partition, decision and journal tables. Only the journal overlaps the recovery declaration. |
| OPS02 ownerService | Joined activation/current-retention gates and verified self-consent writes under CONSENT. |
| OPS02 erasureExecutor | Consent condition checks only; sealed LIFECYCLE progress; bounded freeze/tombstone/group-child and decision erase operations. It cannot mint participant grants. |
| OPS02 policyInstallation | Conditional OPERATIONS#RETENTION/RETENTION policy and stamp operations. No invented historical activity. |
| OPS03 worker | MODELJOB/OPERATIONS#MODEL_JOBS CAS; current admission/retention/context; existing AUTH read/condition and TOTAL conditional reservation only; joined decision CAS. No TOTAL seed/reset/refund. |

Exact ARN/key/transaction/return-value conditions are in the generated report and unchanged [partition proposal](../../../infra/operations/partition-setup.json), [retention proposal](../../../infra/operations/retention-setup.json) and [jobs proposal](../../../infra/operations/jobs-setup.json). Conditions are kept per statement and per profile. IAM cannot replace server identity, all-member consent, source/control/journal guards or application row-level enforcement.

## Minimal next setup and proof

1. Read back the fixed account092954139775/us-east-1 and exact existing resource/runtime role/trust/policies before choosing attachment targets. Older inventory absence is historical; current existence and other roles' effective permissions are unknown to this offline ledger. Preserve the installed recovery role/trust, original CloudShell source/private state and synthetic manifest/journal. Do not reset or repin that state.
2. The sole proposed new storage resource is KnownEnoughPartitions, using the checked partition template with Retain/UpdateReplacePolicy Retain, encryption, PITR and deletion protection. Create only after actual absence/preflight; reuse and retain KnownEnoughGroupsStage, KnownEnoughStage, KnownEnoughOperationsJournal, KnownEnoughQaControl and the existing recovery bucket. OPS02/03 require no speculative new table, SQS queue or scheduler. Existing source/counters must not be recreated or seeded.
3. Bind only individually reviewed profiles to verified appropriate service/operator identities. Attachment targets are unresolved; this report performs no attachment and produces no broadened recovery policy. Keep consent service, erasure executor, policy installer and paid-job worker boundaries separate. Preserve main-only immutable-repository OIDC trust, denial of self-expansion, source/configuration verification and finite requests. No blanket union grant is a prepared installer.
4. Wire the checked OPS01 migration/archive coordinator and source/control/copied-journal-bound ports into a fixed own-B GitHub runner/private input contract, then perform positive/negative effective-role readbacks and managed migration/restart/rollback proof. The current operations-recovery workflow prepares only its synthetic storage probe; it does not apply partition migration/archive. Do not rerun the prior successful pair/five denials unchanged or claim cutover from this ledger.
5. Follow the existing [OPS01](../OPS01/managed-closeout.md), [OPS02](../OPS02/managed-closeout.md) and [OPS03](../OPS03/managed-closeout.md) managed criteria in order. Current retention provenance/participant grants, private sealing/session/public-catalog bindings, Bedrock/provider authorization and quiescence, usage/cleanup, API/runtime selection and backup/provider/log policies remain separate unfinished obligations. The eight storage profiles do not describe all provider/publication permissions.

This is a concrete setup boundary, not an executed cloud setup. No AWS request/mutation, policy attachment, application operation, migration/erasure, participant grant, model/email call, deployment or monitor setting change occurs in this phase. A paused NP00, historical ASSESS07 completion and cancelled password changes remain preserved. See [dated source/check/run evidence](capability-evidence.json) for current verification and exact remaining limitations.
