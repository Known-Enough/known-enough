# Fixed retained partition CREATE and readback package

This OPS00 phase prepares one table: `KnownEnoughPartitions`, in account092954139775/us-east-1, stack `KnownEnoughPartitionsStorage`. The unchanged [checked template](../../../infra/operations/partition-setup.json) has SHA256 `262afec3e0c6d5306e819a723d3589c86f8499e1f9995ab33956046d9ff705f0`. It retains encrypted on-demand PK/SK storage, PITR, deletion protection, Retain/UpdateReplacePolicy Retain and no TTL. The permission profiles in Metadata are declarations; this package attaches none of them. [Capability mapping](capability-map.md), original recovery/private CloudShell state, historical two-run and denial proofs remain separate and unchanged.

[partition-create.py](../../../scripts/operations/partition-create.py) imports only the checked private state, credential environment and bounded subprocess utilities from the existing recovery package. It never instantiates the recovery installer or changes its constants/state/template. New state basenames start `ops00-partition-`, with separate partition.plan/template/create/review/execute records, owner-only HOME permissions, lock, no symlinks, exclusive flushed intent and immutable source/template binding. No profiles, endpoints, table, stack, role, arbitrary template or target override is accepted.

Inventory sends only fixed metadata reads after verifying signed account identity. On GitHub it additionally requires the exact installed staging-inspector role and own B/numeric143764700/main/manual/source; the CLI prohibits every action except inventory there. CloudShell uses its legitimate current credential chain; source and fixed account validation do not prove administrator permissions or the human owner of an AWS session. Do not use another account's credentials. Each invocation has32 attempted requests/180s, each child10s/connect5/read8, single SDK attempt, no custom endpoints/profile files, private131072-byte capture per stream and owned process cleanup. Uploaded summaries expose finite codes/fixed public targets only; no identity ARN, raw error, participant payload or state is uploaded.

Prepare requires actual service-reported absence of both the fixed table and stack. AccessDenied or unrelated ValidationError is UNKNOWN/failure, never absence. Existing resources require inspection/reconciliation; no UPDATE/IMPORT/delete/reset/recreate command exists. The CREATE change set restricts ResourceTypes to DynamoDB::Table, requests no IAM capability or service role, forbids auto-import/nested stacks and uses DO_NOTHING on failure. Review requires exactly one Add/Partitions/DynamoDB::Table, exact original template, fixed source-bound change/stack IDs and REVIEW_IN_PROGRESS. Its hash pins the private reviewed record. Execute re-reads that exact preview and actual table absence before persisting the execute intent and sending one request. An unknown acknowledgment never permits replay: prepare/execute/resume reconstruct from fixed service metadata and the durable intent. Failed stacks preserve the records and require reconciliation rather than cleanup/recreate. This is consistent with the [AWS create-change-set](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/create-change-set.html) and [execute-change-set](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/execute-change-set.html) contracts checked during implementation.

Configuration matching requires the exact CREATE_COMPLETE stack/template/sole physical table, no stack service-role redirection, active ARN/schema/encryption/on-demand/deletion-protection/no extra indexes or stream, PITR enabled and TTL disabled. It does not prove effective data permission, role attachment, migration, runtime selection, participant consent, activation or managed acceptance. Existing target/stack mismatch is preserved and reported; no inferred repair is performed.

## Own-B readback

The [read-only workflow](../../../.github/workflows/operations-partition-readback.yml) runs exact-source/template/package regressions before assuming the already installed staging inspector for900s. It has no IAM/deployment/data request, no arbitrary mode input and no paid/model/email operation. A current resource/metadata denial remains an exact missing inspection capability, not a setup PASS. Its observed result and verified artifact will be appended below. The credential-free [verification workflow](../../../.github/workflows/operations-verify.yml) adds package tests to the existing proposal/native/full checks. Existing nine-file artifacts/proposals and all other workflow behavior remain unchanged.

## Source-pinned commands

The checked source and actual readback evidence are populated after CI in the dated handoff below. The shell block is deliberately gated by its pending source until then. Use only a fresh separate checkout and a new own-account state directory. Do not change, reuse, repin or reset the original recovery installer state. Git branch rename preserves the freshly received main before selecting the checked main-line commit; no existing checkout is overwritten.

```bash
PARTITION_SOURCE='SOURCE_VERIFICATION_PENDING'
PARTITION_CHECKOUT="$HOME/known-enough-partition-setup"
PARTITION_STATE="$HOME/.known-enough/ops00-partition-${PARTITION_SOURCE}"
test ! -e "$PARTITION_CHECKOUT" || exit 1
git clone --no-checkout --single-branch --branch main https://github.com/Known-Enough/known-enough.git "$PARTITION_CHECKOUT" || exit 1
cd "$PARTITION_CHECKOUT" || exit 1
git branch -m main received-main || exit 1
git checkout -b main "$PARTITION_SOURCE" || exit 1
test "$(git rev-parse HEAD)" = "$PARTITION_SOURCE" || exit 1
python3 -B scripts/operations/partition-create.test.py || exit 1
python3 -B scripts/operations/partition-create.py inventory --source "$PARTITION_SOURCE" --state "$PARTITION_STATE"
```

Only an actual CREATE_REQUIRED inventory permits preparing the fixed preview. Already matching/existing/denied/unknown resources are preserved. Existing standing project authorization covers this scoped setup; an installed access denial remains a platform restriction and is not bypassed.

```bash
python3 -B scripts/operations/partition-create.py prepare --source "$PARTITION_SOURCE" --state "$PARTITION_STATE"
python3 -B scripts/operations/partition-create.py resume --source "$PARTITION_SOURCE" --state "$PARTITION_STATE"
# If REVIEW_READY, copy its exact reviewHash after reading the fixed preview contract.
PARTITION_REVIEW_HASH='REVIEW_OUTPUT_PENDING'
python3 -B scripts/operations/partition-create.py execute --source "$PARTITION_SOURCE" --state "$PARTITION_STATE" --review-hash "$PARTITION_REVIEW_HASH"
python3 -B scripts/operations/partition-create.py resume --source "$PARTITION_SOURCE" --state "$PARTITION_STATE"
python3 -B scripts/operations/partition-create.py readback --source "$PARTITION_SOURCE" --state "$PARTITION_STATE"
```

Execute and readback are not dispatched by the inspector workflow. Local AWS/administrator credentials are not established by this preparation. Do not continue a returned BLOCKED/pending/reconciliation code with a fresh state/reset; resume the same source/state, inspect actual pending work, and preserve exact unknown outcomes. Creation/role setup and full [OPS01 managed closeout](../OPS01/managed-closeout.md) remain open until actual successful evidence.

## RUN189 local verified checkpoint — 2026-10-10T03:04:55.306305+00:00

23 package/286 native PASS; pinned Node24.21.0/npm11.19.0 full PASS02:59:52.469641–03:03:33.555724Z (1407 app/two existing optional skips/hosted1/browser64/ref7/plan15/import boundaries414 references, lint/types/build). Four executable and983 protected hashes unchanged. Closing-summary assertion expected nonexistent 414 assertions passed text and failed; actual 414 references line inspected/corrected without source changes. Source/CI/cloud readback remain pending; no installer mutation executed. Progress2 request returned0, original workflow lookup failed with sanitized GET api.github.com workflow list: dial tcp140.82.112.5:443:i/o timeout; one existing-run retry verified38019120798 SUCCESS/exact artifact, created03:01:58Z. No duplicate publication. Unassigned run38018280676 did not meet own/current-main/source/SUCCESS identification conjunction; no artifact download/cadence claim. Earlier10655s own verified receipt gap remains FAIL/activity unknown. Integration after fresh own143/main/source/docs checks; same phase remains active.
