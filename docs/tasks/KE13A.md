# KE13A — AWS staging preparation

- Status: DONE — preparation accepted by the user on 2026-09-26T23:19:42Z.
- Human acceptance: the user confirmed review and acceptance of KE13A and its runbook on 2026-09-26T23:19:42Z. This does not accept B04/B04.5 or KE13 live operations.
- Claim: finished 2026-09-26T21:32:51Z. User-authorized early preparation. Claimant: initiating user / A log; actual worker Codex GPT-6, exact variant and effort unexposed. This record does not claim `gpt-6-sol` or another variant was used.
- Baseline: clean `main` at local checkpoint `a5d1833ff6bf818e963acac6f0a6b6ad923eafa4`, based on `65359ebd19c8ae81007a4b502cce955d5d8ff292`; `git pull --ff-only origin main` succeeded from the clean tree (`Already up to date`). The local checkpoint is one commit ahead of `origin/main`; no push is authorized.
- Scope: this ticket, [KE13](KE13.md), [board](../task-board.md), [runbook](../../infra/staging-runbook.md), [infra README](../../infra/README.md), A handoff and A work log. Agent work was documentation/read-only checks; no application code, CDK/bootstrap, application resources, deployment or paid calls. The user separately configured IAM Identity Center and assigned a read-only permission set.
- Authorization: the user explicitly prioritized KE13A ahead of generic product implementation. This is preparation only and does not accept KE00 or B04/B04.5, waive KE12, or satisfy KE13 operational acceptance.

## Provisioning-permission addendum — 2026-09-27

The user later explicitly authorized creating the scoped staging provisioning permission via CLI and requested sequential Sol/high IAM implementation. [KE13A-P](KE13A-provisioner-policy.md) owns the separate bounded candidate policy and read-only inspection phase; original KE13A acceptance remains DONE. The candidate needs independent critical review before any IAM writes and cannot enforce the one-distribution/$25 specification through CloudFront create permissions. See [the exact actions, limitations and later CLI phases](../../infra/stage0-provisioner-permission.md). No permission set, assignment, budget, application resource or deployment has been created by this addendum.

## Outcome

Prepare a staged AWS plan: first a clearly labeled HTTPS public-fixture mock preview; later an authenticated API and DynamoDB stage after the existing code and gates support it. Record a concrete resource inventory, sequence, low-traffic estimate under the user's $25/month planning ceiling, cleanup plan, IAM needs, profile login steps and evidence limits.

The deployment region is `us-east-1` (N. Virginia). The IAM Identity Center primary/SSO region is also `us-east-1`, confirmed separately in the Identity Center dashboard.

## Acceptance

1. Record the actual AWS CLI v2/profile discovery result without exposing credential material. Do not invent a profile, authentication method, caller identity, account or role.
2. Document profile setup/login for the applicable authentication method and an explicit identity verification command. A human performs browser/MFA steps.
3. Separate the public-fixture hosted mock preview from authenticated shared application state. The current local `NON_PRODUCTION` identity handler is loopback-only and must never be treated as production authentication or exposed by the hosted preview.
4. List staged resources, ordering, IAM permissions, low-traffic estimates/assumptions, cost guardrails, cleanup steps and unverified items. Exclude Bedrock/model use from the $25 estimate until separately authorized.
5. Keep the existing KE13 live deployment/operational acceptance a later, independent gate; this preparation does not claim live service behavior.

## Checks and handoff

Documentation/local identity evidence, 2026-09-26: AWS CLI v2.37.4 installed from AWS's official WSL/Linux installer and its signature verified; `aws --version` succeeded. Initial `aws configure list-profiles` returned no names; Windows CLI/PATH and standard WSL/Windows config paths were checked first. The user briefly authenticated root with `known-enough-staging`, verified it by STS, and ran `aws logout` to clear its cached login. The user then set up IAM Identity Center user `martelaxe`, assigned `ReadOnlyAccess`, and configured profile `known-enough-staging-ro`. Device-code login completed; explicit-profile STS verification succeeded for an assumed `AWSReservedSSO_ReadOnlyAccess` role in the intended AWS account. Identity Center primary region is `us-east-1`; deployment profile region is `us-east-1`, confirmed separately. The current profile is read-only, not approved for staging writes. The user performed the Identity Center user/permission assignment; the agent made no AWS IAM/resource changes. No device codes or tokens are recorded.

Pinned Node 24.21.0/npm 11.19.0 documentation checks: `npm run check:references` passed 7/7 hashes; `npm run check:planning` passed 15/15 historical arithmetic checks; repository Markdown check found 0 errors across 86 Markdown files and 724 local links/anchors; task/status gate consistency and whitespace checks passed (`git diff --check`). No application suite was run because no executable files changed. These checks do not verify any live AWS behavior.

The user accepted KE13A. The next step is the bounded hosted public-only preview build (KE13C). The active CLI role is read-only and cannot deploy. The user has now authorized proceeding with the Stage 0 preview plan; no application resource creation or deployment has occurred. Never save tokens, credentials, login codes or authorization URLs in repository files/logs.
