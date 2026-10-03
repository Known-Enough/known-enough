> Historical ticket view. Links follow the current layout; [original bytes](original.md.txt) retain the old paths and evidence. This folder does not schedule work.

# KE13A — AWS staging preparation — closed previous batch

- Status: DONE — user-directed administrative closure, 2026-09-30.
- Claim: Closed for scheduling by the user's new-batch direction; preserve all saved work.

This is administrative closure of the old plan. Prior technical results and unfinished criteria are preserved below; no new check, review PASS, volunteer trial, live qualification or release acceptance is claimed. Remaining technical obligations route to [NP00](../../../active/closeout/NP00/ticket.md). Future product work follows [NP00–NP04](../../../../next-phase.md) and the [shared board](../../../../task-board.md). Reviews, human trials and submission preparation are deferred as mapped there. Historical claims and next-step instructions below cannot select current work.

## Historical ticket record

<!-- pre-NP-original-body -->

# KE13A — AWS staging preparation

- Status: DONE — preparation accepted by the user on 2026-09-26T23:19:42Z.
- Human acceptance: the user confirmed review and acceptance of KE13A and its runbook on 2026-09-26T23:19:42Z. This does not accept B04/B04.5 or KE13 live operations.
- Claim: finished 2026-09-26T21:32:51Z. User-authorized early preparation. Claimant: initiating user / A log; actual worker Codex GPT-6, exact variant and effort unexposed. This record does not claim `gpt-6-sol` or another variant was used.
- Baseline: clean `main` at local checkpoint `a5d1833ff6bf818e963acac6f0a6b6ad923eafa4`, based on `65359ebd19c8ae81007a4b502cce955d5d8ff292`; `git pull --ff-only origin main` succeeded from the clean tree (`Already up to date`). The local checkpoint is one commit ahead of `origin/main`; no push is authorized.
- Scope: this ticket, [KE13](../KE13/ticket.md), [board](../../../../task-board.md), [runbook](../../../../../infra/staging-runbook.md), [infra README](../../../../../infra/README.md), A handoff and A work log. Agent work was documentation/read-only checks; no application code, CDK/bootstrap, application resources, deployment or paid calls. The user separately configured IAM Identity Center and assigned a read-only permission set.
- Authorization: the user explicitly prioritized KE13A ahead of generic product implementation. This is preparation only and does not accept KE00 or B04/B04.5, waive KE12, or satisfy KE13 operational acceptance.

## Stage 0 deployment update — 2026-09-27

The user explicitly authorized the HTTPS preview deployment and later waived the earlier `$25/month` planning ceiling in favor of available credits. The preview is live at [https://d23eowhnwtqts3.cloudfront.net/](https://d23eowhnwtqts3.cloudfront.net/). AWS resources, profile names, hashes, CLI verification and cleanup are recorded in the [runbook](../../../../../infra/staging-runbook.md). The temporary setup permission set was created and assigned through CLI, used for setup, then unassigned and deleted. The separate `known-enough-staging-deploy` Identity Center role remains for hosted static releases. The expired KE13A-P candidate policy was not used. No API, Cognito, Lambda, DynamoDB, SQS or Bedrock resource was created.

## Outcome

Prepare a staged AWS environment: the first stage is now a clearly labeled HTTPS public-fixture mock preview; later stages may add authenticated API and DynamoDB only after code and gates support them. The former `$25/month` estimate is historical; the user later chose to use available credits. Record resource inventory, release/cleanup procedure, IAM needs, profile setup and evidence limits.

The deployment region is `us-east-1` (N. Virginia). The IAM Identity Center primary/SSO region is also `us-east-1`, confirmed separately in the Identity Center dashboard.

## Acceptance

1. Record the actual AWS CLI v2/profile discovery result without exposing credential material. Do not invent a profile, authentication method, caller identity, account or role.
2. Document profile setup/login for the applicable authentication method and an explicit identity verification command. A human performs browser/MFA steps.
3. Separate the public-fixture hosted mock preview from authenticated shared application state. The current local `NON_PRODUCTION` identity handler is loopback-only and must never be treated as production authentication or exposed by the hosted preview.
4. List staged resources, ordering, IAM permissions, cost assumptions, cleanup steps and unverified items. Keep Bedrock/model use outside the static-preview scope. Record the later waiver of the historical $25 planning ceiling and that available credits were not verified.
5. Keep the existing KE13 live deployment/operational acceptance a later, independent gate; this preparation does not claim live service behavior.

## Checks and handoff

Documentation/local identity evidence, 2026-09-26: AWS CLI v2.37.4 installed from AWS's official WSL/Linux installer and its signature verified; `aws --version` succeeded. Initial `aws configure list-profiles` returned no names; Windows CLI/PATH and standard WSL/Windows config paths were checked first. The user briefly authenticated root with `known-enough-staging`, verified it by STS, and ran `aws logout` to clear its cached login. The user then set up IAM Identity Center user `martelaxe`, assigned `ReadOnlyAccess`, and configured profile `known-enough-staging-ro`. Device-code login completed; explicit-profile STS verification succeeded for an assumed `AWSReservedSSO_ReadOnlyAccess` role in the intended AWS account. Identity Center primary region is `us-east-1`; deployment profile region is `us-east-1`, confirmed separately. The current profile is read-only, not approved for staging writes. The user performed the Identity Center user/permission assignment; the agent made no AWS IAM/resource changes. No device codes or tokens are recorded.

Pinned Node 24.21.0/npm 11.19.0 documentation checks: `npm run check:references` passed 7/7 hashes; `npm run check:planning` passed 15/15 historical arithmetic checks; repository Markdown check found 0 errors across 86 Markdown files and 724 local links/anchors; task/status gate consistency and whitespace checks passed (`git diff --check`). No application suite was run because no executable files changed. These checks do not verify any live AWS behavior.

KE13A preparation remains accepted. The hosted-only mock build and Stage 0 HTTPS deployment are complete; this does not establish authentication or shared state and does not accept KE13 operational evidence. Next immediate action: open the runbook URL. Future API/authentication/persistence work is KE13B and remains subject to its existing sequential gates. Never save tokens, credentials, login codes or authorization URLs in repository files/logs.
