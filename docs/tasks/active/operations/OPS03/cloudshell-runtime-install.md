# OPS03 dedicated worker installation

The primary operations API is restored and independently checksum-verified. This installs the dedicated background worker; it stays disabled until matching bindings and live behavior are checked.

[Coordinated preparation38180021249](https://github.com/Known-Enough/known-enough/actions/runs/38180021249) passed: private worker stored, actual model-content logging disabled. WSL setup login expired; existing GitHub roles cannot create the new Lambda/IAM/rule. Standing A/B authority already covers this installation, so no new authorization is requested.

Paste once in authenticated CloudShell. It creates only the new dedicated worker, execution/release roles, finite logs and DISABLED one-minute application schedule. Existing primary flags, tables, job control and usage stay unchanged. No AI call occurs. AWS keeps stack progress if CloudShell disconnects.

```bash
(
  set -euo pipefail
  umask 077
  test "$(aws sts get-caller-identity --region us-east-1 --query Account --output text --no-cli-pager)" = "092954139775"
  source=9a27a99f20b1462183e8843ca9960bd53feed57b
  folder="$HOME/.known-enough/model-job-runtime-$source"
  mkdir -p "$folder"
  curl --fail --silent --show-error \
    "https://raw.githubusercontent.com/Known-Enough/known-enough/$source/infra/operations/jobs-runtime-setup.json" \
    -o "$folder/template.json"
  printf '%s  %s\n' \
    840dd8ebff7d2f00286f26731d0302338a2b18a661543b1b3175e4c548b23aac \
    "$folder/template.json" | sha256sum --check --status
  aws cloudformation validate-template --region us-east-1 \
    --template-body "file://$folder/template.json" --no-cli-pager > "$folder/validation.json"
  aws cloudformation create-stack --region us-east-1 \
    --stack-name KnownEnoughModelJobRuntime \
    --template-body "file://$folder/template.json" \
    --parameters ParameterKey=WorkerKey,ParameterValue=a123823764f35df6abdc09a288d1c26962ed76f94b6956c7e77bf89ef6cc2214/model-worker.zip \
    --capabilities CAPABILITY_NAMED_IAM \
    --client-request-token OPS03-9a27a99f-dedicated-runtime \
    --query StackId --output text --no-cli-pager
)
```

Create-only: it cannot overwrite an existing stack. If already present, stop creating and inspect status. After submission or reconnection:

```bash
aws cloudformation describe-stacks --region us-east-1 \
  --stack-name KnownEnoughModelJobRuntime \
  --query 'Stacks[0].StackStatus' --output text --no-cli-pager
```

CREATE_COMPLETE proves configuration installation only. CREATE_IN_PROGRESS means wait for AWS. Failures need actual stack events; never delete storage or enable the schedule as a workaround. Then OPS03 verifies installed code/roles/rule, connects matching API/control/frontend source and qualifies real owned consent/retention/provider/recovery/usage/cleanup. No live qualification is claimed by this setup block. Routine worker code/schedule changes will use the new exact GitHub release role; the schedule stays off until wiring is checked.
