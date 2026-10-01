> **Current routing, 2026-09-30:** technical closeout belongs to [NP00](../tasks/NP00.md). The prior reviewer prerequisite below is deferred under the [NP policy](../next-phase.md); no reviewer PASS or new technical closure is claimed. Keep the original debt/finding evidence below. A-only IAM actions retain separate authorization.

# TD-KE10-02 — Bedrock permission-set name and isolation

- Status: **READY — permission currently works, but is attached to the misleadingly named `ReadOnlyAccess` permission set.**
- Priority: P2 before another user receives direct Bedrock test access.
- Origin: KE10 Bedrock setup on 2026-09-28. The user asked to give the Bedrock test access a clearer name.

## Current state

On 2026-09-28, after explicit user authorization, the `known-enough-staging-bootstrap` profile was verified as `arn:aws:iam::092954139775:root`. IAM Identity Center inspection found the `ReadOnlyAccess` permission set had the AWS-managed `ReadOnlyAccess` policy, no prior inline policy, and one user assignment in account `092954139775`. One inline statement allowing `bedrock:InvokeModel` on `arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0` was added and provisioned successfully (request `03a2bb11-5586-49e1-90b4-b7fdf43c2324`). No model invocation was made. This set is therefore read-only for AWS resources with the additional ability to make billable Nova Lite calls.

IAM Identity Center's CLI/API does not expose a rename operation for an existing permission set. Its name appears as the selectable role in the AWS access portal; AWS still generates the account IAM role with its managed `AWSReservedSSO_` prefix and unique suffix.

## Closure work

Create and provision a clearly named permission set such as `KnownEnoughBedrockTest`, with only the required AWS-managed read-only access and the same model-scoped `bedrock:InvokeModel` statement. Assign it only to intended testers, update their local SSO profile role name, refresh the SSO session and verify the role. Then remove the model-invoke statement from `ReadOnlyAccess` and reprovision it, retaining the original read-only assignment as needed. Do not share SSO tokens, cached login credentials or access keys through `.env` files.

This cleanup changes IAM access only; it does not perform a Bedrock invocation or satisfy KE10's pending independent review or paid-call authorization.
