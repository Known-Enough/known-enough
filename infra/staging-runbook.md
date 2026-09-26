# Known Enough AWS staging runbook

Status: KE13A preparation and user acceptance; KE13C hosted-preview build implemented locally and awaiting independent review, 2026-09-26. This remains a plan, not deployed infrastructure. AWS CLI v2 is installed in WSL. The user authenticated the IAM Identity Center user `martelaxe` with profile `known-enough-staging-ro`; STS verified its `ReadOnlyAccess` assumed role. Identity Center and deployment regions are both `us-east-1`, configured separately. The earlier root CLI session was logged out. The user authorized proceeding with Stage 0; no Known Enough application resources, CDK bootstrap or deployment have occurred. The user created/assigned the Identity Center user and read-only permission set; the agent made no AWS account/IAM changes.

## Decisions and boundary

- Deployment region: `us-east-1` (N. Virginia), selected as a North America planning default with current public pricing examples. The IAM Identity Center **SSO region is also `us-east-1`**, confirmed separately as the Identity Center primary region.
- Monthly staging spend planning ceiling: **$25 USD**. The estimate below is for low traffic and is not a guaranteed hard limit. AWS Budgets data can update up to three times daily, typically with an 8–12 hour delay, so charges can pass an alert threshold before notification; budget actions also do not immediately stop every service or charge. See [AWS Budgets data freshness and alert timing](https://docs.aws.amazon.com/cost-management/latest/userguide/bcm-lite-use-budget.html).
- Stage 0 is an HTTPS static **hosted mock preview** backed only by public synthetic fixtures. Each browser sees mock state; it does not provide shared application state, authentication, or durable writes.
- Stage 1 adds verified Cognito identity, HTTPS API and durable DynamoDB state only after the required code, review gates and separate cloud-change approval. Separate sessions must read/write the same DynamoDB room state to demonstrate shared application state.
- SQS/DLQ is deferred until a real asynchronous worker exists. Bedrock/model calls are excluded and remain disabled until separately implemented and authorized.
- No Known Enough application resources, CDK bootstrap, deployment, paid call or external message has happened in KE13A. The user separately set up an IAM Identity Center directory user and assigned `ReadOnlyAccess`; the agent did not make these account/IAM changes.

## Current repository readiness

| Boundary | Existing evidence | Staging implication |
| --- | --- | --- |
| Web | The regular local [`App.tsx`](../apps/web/src/App.tsx) keeps its owner/local demo routes. The separate [`hosted-preview/index.html`](../apps/web/hosted-preview/index.html) entry fixes the public fixture and ignores query strings. | Build and upload only `apps/web/dist-hosted-preview/`; its bundle check rejects owner/local identity markers, and the browser smoke test checks hostile query strings and external requests. Independent review is pending. |
| Local API | [`apps/api/README.md`](../apps/api/README.md) documents in-memory local state and fixed `NON_PRODUCTION` test labels. The local handler refuses `NODE_ENV=production`; its listener is loopback-only. | Never expose the local handler, test identity header or mock identities over the internet. They are not authentication. |
| Authenticated API | The Cognito JWT verifier and authenticated HTTP handler exist, but there is no production hosting/composition or deployed user pool. | KE13B must compose it with the durable repository and serverless entry point. Verify signed participant/display scopes; no fallback to local identities. |
| Persistence | The DynamoDB transaction adapter and strict codec exist in [`packages/adapters`](../packages/adapters/README.md); it does not create tables or prove managed AWS behavior. Current local STATE schema v4 is not a migration from durable v3 data. | KE13B must use one versioned DynamoDB table for shared state and preserve guard/replay/capacity semantics. No auto-migration; no durable v3 table may be bound to this version without a separately reviewed migration. |
| Workers/model | [`apps/workers/README.md`](../apps/workers/README.md) is a placeholder. | Do not create queues, invoke Bedrock or place private prompt text in SQS. Add SQS/DLQ and Bedrock only in their gated implementation scope. |

### What each stage proves

```mermaid
flowchart LR
  subgraph Preview[Stage 0: hosted mock preview]
    BrowserA[Browser A] --> CF[HTTPS CloudFront]
    CF --> S3[Private S3 static build]
    S3 --> Mock[Public synthetic fixture]
  end
  subgraph Shared[Stage 1: authenticated shared application state]
    BrowserB[Browser/session A or B] --> API[HTTPS API Gateway]
    API --> Cognito[Verified Cognito JWT]
    API --> Lambda[Authenticated application composition]
    Lambda --> DDB[(DynamoDB STATE/GUARD/REPLAY)]
  end
```

The Stage 0 browser only renders fixture state; one browser’s action cannot update another browser. Stage 1 is real shared state only after two independently authenticated, authorized sessions exercise the same deployed API and DynamoDB room, with transaction/version behavior verified. A static page, local API, mocked Cognito token or DynamoDB Local run does not meet that evidence.

## AWS CLI/profile setup and read-only verification

### Current discovery

- WSL initially had no `aws` executable. Windows `where.exe aws`, PowerShell command lookup and common Windows CLI v2 install paths also found no executable. WSL and Windows standard `~/.aws/config` paths are absent; `AWS_CONFIG_FILE`, `AWS_SHARED_CREDENTIALS_FILE`, `AWS_PROFILE` and region override variables were unset.
- Installed AWS CLI **v2.37.4** in the WSL user profile from AWS’s official Linux installer. The installer verified the package’s GPG signature. `aws --version` succeeded.
- At initial discovery, `aws configure list-profiles` returned no names and no standard WSL/Windows CLI profile existed. The user first created `known-enough-staging` with `aws login`; WSL could not auto-open the browser, but STS verified the account root principal. The user then ran `aws logout --profile known-enough-staging`, which removed the cached login credentials. The user created IAM Identity Center user `martelaxe`, assigned the AWS managed `ReadOnlyAccess` permission set to this account, and configured `known-enough-staging-ro`. Device-code SSO login completed; WSL could not auto-open the browser, but the user completed browser authorization. A repeat explicit-profile STS check succeeded for the `AWSReservedSSO_ReadOnlyAccess_…/martelaxe` assumed role. The account ID was reported directly to the user and is omitted here. The Identity Center dashboard primary region is `us-east-1`; `aws configure get region --profile known-enough-staging-ro` returned deployment region `us-east-1`. No login codes, tokens or authorization URLs are recorded here.

### Recommended path if the AWS account uses IAM Identity Center (SSO)

The user has configured this profile successfully. For another local setup, run these in WSL using the AWS access portal URL from the IAM Identity Center dashboard and that instance’s primary region. Do not put passwords, MFA responses, access keys, tokens or device codes in chat, source control, the runbook or logs.

```sh
aws configure sso --profile known-enough-staging-ro --use-device-code
```

In the interactive wizard, enter the AWS access portal URL and **SSO region**; accept the default `sso:account:access` scope; choose the staging account and the least-privilege permission set; set the profile’s **deployment region** to `us-east-1`. This creates a local CLI profile. It does not create AWS infrastructure. Do not paste the profile config or SSO token cache into the repository.

Then authenticate and verify the selected account/role:

```sh
aws sso login --profile known-enough-staging-ro --use-device-code
aws sts get-caller-identity --profile known-enough-staging-ro --no-cli-pager
aws configure get region --profile known-enough-staging-ro
aws configure list-profiles
```

The Identity Center SSO region is shown as **Primary Region** on the Identity Center dashboard; the CLI profile region is the deployment region. Modern CLI profiles store the SSO region in their named `sso-session` section, so `aws configure get sso_region --profile ...` may not return it. Report the `Account` and the principal shown by `Arn` separately from both regions; if the ARN is an assumed role, record its role name, and if it is an IAM user, do not describe it as a role. Complete any device authorization yourself in a trusted browser:

```sh
aws sso login --profile known-enough-staging-ro --use-device-code
```

The CLI may display a one-time code in the terminal; enter it only at the AWS device authorization page. Do not copy the code into chat or project files.

### If access uses a different method

- IAM Identity Center profiles use the SSO flow above. Do not replace it with long-lived keys.
- For supported AWS console sign-in that is **not** IAM Identity Center, AWS CLI v2.32+ offers `aws login --profile known-enough-console`; WSL/browser failures can use its `--remote` flow. Keep this alternative in a separate profile; do not overwrite the existing root-session profile.
- For an organization-provided assume-role, credential process or IAM-user profile, follow that existing method in the local terminal. Never send static keys or MFA codes to the assistant. Prefer short-lived, scoped credentials over long-lived IAM-user keys.
- Always pass the chosen profile on AWS service commands. Do not rely on an ambient default profile.

### Read-only identity checkpoint

After login, first run only the STS command above. Stop if the AWS account or role is not the intended staging authority. Record verified account/role details only in a human-approved private operations record, not a public frontend, browser payload, source code or credential file. **Current result: `known-enough-staging-ro` verifies as the `ReadOnlyAccess` assumed role.** This identity permits read-only verification, not staging deployment; request a separate scoped write permission set only after the stage and exact resources are approved.

## Proposed resource inventory

Names are examples only; apply a unique suffix after account/region identity is confirmed. Tag every staging resource with `Project=KnownEnough`, `Environment=staging`, `Stage=preview` or `Stage=api`, and an expiry date.

| Stage | Resource | Purpose and limits |
| --- | --- | --- |
| Preview | Amazon S3 Standard bucket | Store only the reviewed `apps/web/dist-hosted-preview/` build. Block all public access, disable website hosting, use CloudFront Origin Access Control, default SSE-S3, versioned release assets and a 14-day cleanup for noncurrent versions. No private inputs or credentials. |
| Preview | Amazon CloudFront distribution | Serve S3 through OAC over HTTPS; set `DefaultRootObject=hosted-preview/index.html`. Prefer the CloudFront-provided domain and the $0 flat-rate Free plan if eligible; keep its published 1M requests/100 GB monthly allowance in view. Enable only the required security headers. Do not put participant values or identifiers in URLs/logs. |
| Preview | AWS Certificate Manager public certificate | Optional only for a custom domain. Request a non-exportable certificate in `us-east-1` for CloudFront. Integrated public certificates have no separate charge. The default CloudFront hostname already provides HTTPS. |
| Preview | Route 53 zone/records | Optional only if the user supplies an existing domain hosted in Route 53. Do not register or transfer a domain for this task. A hosted zone is billed monthly. |
| API | Amazon Cognito User Pool | Only after KE13B: participant and display app clients, public sign-up disabled, short access-token lifetime, administrator-managed display group; synthetic test accounts only. Avoid SMS MFA. Runtime JWT verification uses public JWKS and needs no Cognito API permission. |
| API | API Gateway HTTP API | HTTPS JSON API routes to Lambda, throttling enabled, JWT authentication/authorizer configured from verified Cognito issuer/client IDs. |
| API | AWS Lambda function(s) | Request composition; bounded memory/timeout and reserved concurrency; no VPC/NAT for the initial serverless path. Runtime role cannot provision infrastructure. |
| API | One DynamoDB Standard on-demand table | `DealTableRooms` with the existing adapter’s `ROOM#...` partition and STATE/GUARD/REPLAY sort keys. Single region; set supported on-demand throughput maxima after measured adapter sizing. No TTL for authorization/expiry. Do not enable global tables. |
| API | CloudWatch Logs groups, alarms and metrics | Redacted operational categories only; 7-day retention for staging; alert on error/throttle/cost signals. Never log JWTs, private input/conditions, prompts, grant IDs or refusal details. |
| Deferred | SQS standard queue + DLQ | Add only with a real reviewed async worker. Queue envelopes carry opaque job/authorized record references, not raw conversation text. Bound retention/redrive and cap worker concurrency. |
| Excluded | Bedrock, NAT Gateway, EC2, RDS, load balancer, paid domain registration, exportable/Private CA, SMS, global table, provisioned database capacity | Not needed for the first mock preview and would add variable or standing cost. Reconsider only under later explicit scope/approval. |

## Deployment sequence

No AWS deployment step below has been run. The user authorized Stage 0 only: one private S3 preview bucket and one CloudFront distribution with OAC in `us-east-1`, using the reviewed artifact and the stated low-traffic estimate under the `$25/month` planning ceiling. This authorization does not include a custom domain, API, Cognito, Lambda, DynamoDB, CDK bootstrap, Bedrock, or other stages. KE13A/KE13C do not perform a deployment.

1. **Confirm local auth and account.** Configure the named profile using the method above; complete browser/MFA; verify STS account/role; report deployment region and SSO region separately. Confirm that this principal is intended for staging. Review existing account spend and budgets.
2. **Set reviewable cost controls.** Activate the project cost-allocation tag if using a tag-filtered budget. Plan a `$25/month` Known Enough staging cost budget with actual alerts at `$12.50`, `$20` and `$25`, plus an 80% forecast alert. Alerts notify; they are not a guaranteed spend cap. Use CloudFront’s $0 flat-rate plan if account eligible. Set API throttles, Lambda reserved concurrency, DynamoDB on-demand request maxima and short log retention. Avoid resources with hourly idle fees.
3. **Prepare a hosted-only mock build.** KE13C adds `npm run build:hosted-preview --workspace @deal-table/web` and `npm run check:hosted-preview`. It builds a fixed public-fixture screen in `apps/web/dist-hosted-preview/`, ignores owner/local/scenario query strings, and displays “Hosted mock preview — simulated data, no shared state.” Build and browser checks pass locally; independent review is still required. Record the reviewed source commit/build hash before upload.
4. **Deploy the static preview after review and write access.** Create the private S3 bucket and CloudFront/OAC distribution. Upload only the reviewed `apps/web/dist-hosted-preview/` directory; keep the bucket nonpublic; configure `DefaultRootObject=hosted-preview/index.html`; redirect HTTP to HTTPS; use the CloudFront domain first. If using a custom domain later, verify domain control and request the CloudFront certificate in `us-east-1`. Smoke-check TLS, page load, fixture behavior, no API calls, no test identity header and no private data in browser assets/logs. Record the distribution URL and build hash. A preview URL is not an authenticated app.
5. **Wait for KE13B and required reviews/acceptance.** Implement authenticated composition, durable adapter wiring, least-privilege IAM and focused checks. Have an independent reviewer inspect the exact code/tests/IAM artifact in a separate sequential review. Retain KE00, B04/B04.5 and KE09 privacy/security gates.
6. **Request Stage 1 authorization.** Present the exact API/Cognito/Lambda/DynamoDB (and only if implemented, SQS/DLQ) resource list, exact account/region, permission diff, current estimate and rollback/cleanup plan. Do not bootstrap CDK, create service resources, deploy or call Bedrock until the user approves that concrete scope.
7. **Deploy the authenticated backend after approval.** Create the user pool and clients, API, Lambda and role, table and log groups; use a separate scoped setup identity and exact resource ARNs. No public sign-up, no `NON_PRODUCTION` fallback, no broad account admin policy on runtime. Store secrets only in an approved secret service if the implemented adapter requires them; avoid secrets for this first slice.
8. **Verify shared state with synthetic identities.** Provision fixed synthetic participants through the trusted control plane; authenticate separate clients; read the same room, commit a harmless authorized change from one client, and verify a separately authenticated client sees committed current state. Exercise cross-room/member denials, idempotent replay, conflict/retry, expiry and redacted errors. Verify DynamoDB persistence survives function cold starts; verify no private inputs appear in public projection/logs. These are live tests only when run against the deployed artifact and recorded as such.
9. **Operational review and acceptance.** Record account/role, region, artifact hash, exact resources, IAM policy hash, test identities as synthetic labels, logs/metrics, observed costs, failure/retry evidence, access lifetime and cleanup date. Run independent KE09 cloud-boundary follow-up; pause KE13 for human acceptance. KE13A/KE13B completion does not accept KE13.

## Cost estimate for the $25/month planning ceiling

Planning estimate dated 2026-09-26, in USD, for `us-east-1`; use the AWS Pricing Calculator with the actual account/usage before any creation. Assumptions: one small static build (<1 GB), ≤10 GB/month page delivery and ≤100,000 HTTPS requests; after Stage 1, ≤10,000 HTTP API calls/month, ≤10 synthetic monthly active users, one small on-demand table with 1–10 KB average items, ≤0.5 GB logs/month, no more than 10,000 async jobs if SQS is later added, no Bedrock, no SMS, no cross-region traffic and no purchased domain.

| Component | Low-traffic planning estimate | Cost basis / note |
| --- | ---: | --- |
| CloudFront preview distribution | `$0/month` if the flat-rate Free plan is available and usage is within 1M requests/100 GB. Otherwise budget roughly `$1–$3/month` for the stated small pay-as-you-go preview and verify in Calculator. | The Free plan includes CDN, TLS, DNS, logs and monthly S3 storage credits. Confirm account eligibility and plan terms before selecting it. |
| S3 static build | `$0–$0.10/month` | One small build and request volume; included S3 credits may cover it on a CloudFront plan. No cross-region or direct public S3 delivery. |
| ACM public certificate | `$0` for a non-exportable certificate used by CloudFront/API Gateway. | Custom domain only; CloudFront certificate is requested in `us-east-1`. |
| HTTP API Gateway | About `$0.01/month` at 10,000 requests. | AWS’s HTTP API example is `$1.00` per million requests in the first tier. Payload transfer is low under the stated size limit. |
| Lambda | About `$0.02/month` at 10,000 requests, 512 MB, 200 ms average, before free-tier credits. | Includes request and x86 duration estimate; actual duration, memory, retries and account free usage change this. |
| DynamoDB Standard on-demand | Roughly `$0.10–$1/month` at 10,000 small transaction paths, depending on STATE/item sizes and transaction units. | AWS lists US East examples at `$0.625/M` write units and `$0.125/M` read units; transactional operations consume extra units. Adapter operations and item bytes must be measured before finalizing. First 25 GB storage free tier only if available in this account. |
| Cognito | `$0` expected for ≤10 direct/social MAUs on Lite/Essentials, if the account’s free tier applies and SMS is not used. | SAML/OIDC federation has a 50-MAU free tier; higher tiers, advanced features, SMS and email delivery can add cost. Select and verify the tier. |
| CloudWatch | `$0–$0.25/month` for ≤0.5 GB log ingestion under the current 5 GB free allowance; otherwise `$0.50/GB` at the first standard ingestion tier, plus any retained storage/queries. | Seven-day retention and redacted, low-volume logs assumed. Do not enable verbose request logs. |
| SQS + DLQ, if later needed | `$0` expected at 30,000 request actions; then `$0.40 per million` standard queue requests after the first million monthly requests. | 10,000 jobs × send/receive/delete. Batch where appropriate; payload size and retries increase request count. |
| Route 53 hosted zone, optional | Add `$0.50/month` for the first hosted zone, plus queries. | Avoid by using the CloudFront hostname. Domain registration is excluded. |

**Planning total:** Preview only is approximately `$0–$3/month`. Preview plus low-traffic API/Cognito/DynamoDB is approximately `$1–$8/month`; add `$0.50/month` if a Route 53 zone is needed. The plan leaves headroom under `$25`, but traffic, logs, free-tier eligibility, retries, item size, domain registration, support, taxes or other pre-existing account usage can change the bill. AWS Budgets sends alerts and optional actions; it cannot guarantee a hard account spend cap. Keep Bedrock disabled because token/model/region usage is variable and is not included.

Official references: [AWS CLI v2 install](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), [IAM Identity Center CLI setup/device flow](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html), [CloudFront plans](https://aws.amazon.com/cloudfront/pricing/), [S3](https://aws.amazon.com/s3/pricing/), [API Gateway](https://aws.amazon.com/api-gateway/pricing/), [Lambda](https://aws.amazon.com/lambda/pricing/), [DynamoDB](https://aws.amazon.com/dynamodb/pricing/), [Cognito](https://aws.amazon.com/cognito/pricing/), [SQS](https://aws.amazon.com/sqs/pricing/), [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/), [ACM](https://aws.amazon.com/certificate-manager/pricing/), [Route 53](https://aws.amazon.com/route53/pricing/), [AWS Budgets pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/) and [AWS Budgets alert timing](https://docs.aws.amazon.com/cost-management/latest/userguide/bcm-lite-use-budget.html). Prices/free allowances can change and can depend on account eligibility; recheck before authorization.

## Required permissions

The active profile is the AWS managed `ReadOnlyAccess` permission set, which is sufficient for identity/read-only verification and cannot deploy. No staging deployment permission set has been inspected or assigned. Do not use root or attach `AdministratorAccess` as a shortcut. Separate any later stage-specific deployment/control-plane identity from Lambda/worker runtime roles.

| Actor/stage | Permission families to request after review |
| --- | --- |
| Read-only verification | `sts:GetCallerIdentity`; no service mutation permission. |
| Preview provisioning | S3 bucket/object/policy/versioning/lifecycle actions limited to the one named bucket; CloudFront distribution and Origin Access Control create/describe/update/disable/delete for the named distribution; optional ACM request/describe/delete for the certificate; optional Route 53 record changes for the existing named hosted zone; Cost Explorer/Budgets read and budget/notification setup if approved. |
| API staging control plane | API Gateway HTTP API create/update/delete; Lambda create/update/delete and pass execution role; Cognito user-pool/app-client/group provisioning; DynamoDB table create/describe/update/delete and billing-mode/on-demand limit configuration; CloudWatch log-group/retention/alarm management; optional SQS queue/DLQ create/update/delete only when worker code exists; AWS Budgets and cost-allocation-tag activation as authorized. IAM role/policy creation and `iam:PassRole` must be constrained to the exact staging roles and intended services. |
| Runtime API role | Existing adapter’s transaction-scoped DynamoDB item actions only: `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem` on the exact table ARN, with `dynamodb:EnclosingOperation` limited to `TransactGetItems`/`TransactWriteItems` and `dynamodb:LeadingKeys` limited to `ROOM#*`. Add only exact log-group write actions. No table administration, `DeleteItem`, `Query`, `Scan`, IAM, Cognito admin or broad resource wildcard. |
| Runtime worker role, only if implemented | Only the specific queue’s send/read/delete/get-attributes actions, exact table transaction needs and exact log group. No raw prompt text in the queue; do not grant Bedrock until its separate KE10 scope is authorized. |

The runtime IAM row reflects the current [`infra/README.md`](README.md) adapter design and is still a review example; re-check it against KE13B’s actual SDK commands and table ARN before authorizing. A key-prefix condition does not replace application membership authorization.

## Cleanup and expiry

Use synthetic test records only. Set a dated cleanup reminder at creation. Cleanup is a documented future procedure; do not execute it without explicit scope approval and resource-ID review.

1. Disable public preview traffic or restrict access; record the final build hash/evidence; remove DNS aliases only if they were created for this staging deployment.
2. Disable the CloudFront distribution and wait until deployment state is disabled; then delete the distribution and its Origin Access Control only after confirming no other distribution references it.
3. Delete every object version and delete marker from the dedicated build bucket; delete the bucket after CloudFront releases it. Confirm the bucket contains no unrelated objects.
4. For API staging, stop/disable API routes and Lambda event sources; delete the API and only the named Lambda functions. Remove only the scoped runtime role/policy after its functions are gone.
5. Purge synthetic SQS messages; delete the dedicated DLQ and source queue. Remove only matching staging log groups after exporting any approved redacted evidence; delete staging alarms/metrics that incur charges.
6. Delete Cognito synthetic users/groups and the dedicated pool/app clients after confirming no other stage depends on them. No private/real user data belongs in this pool.
7. Delete the dedicated DynamoDB staging table only after confirming it contains synthetic test state and no separate acceptance evidence needs retention. Check and remove on-demand backups, exports and point-in-time recovery state created for this stage; do not delete unrelated tables or backups.
8. Remove the optional ACM certificate after distribution/API associations are removed. Delete only staging Route 53 records. Do not delete a shared hosted zone or register/transfer a domain as part of cleanup.
9. Remove staging-specific budget filters, alarm targets and cost-allocation tags only if they were created solely for this stage; retain any account-wide budget or shared control. Verify the AWS bill and resource inventory after cleanup; record residual charges and the cleanup date.

## Open blockers / next action

- The user’s `known-enough-staging-ro` IAM Identity Center profile remains authenticated. Read-only inventory shows no S3 buckets, CloudFront distributions, or AWS Budgets. The current `ReadOnlyAccess` role cannot create resources; no write permission set has been assigned. Stage 0 is authorized, but deployment awaits the required independent review and a scoped write permission set.
- The hosted preview build and checks exist in the isolated working clone. Do not deploy it until the exact diff and artifact have passed independent review.
- A `$25/month` AWS Budget with alerts should be created before the resources. Alerts are informational, not a hard spend cap; check credits for applicable service/region and expiry terms in the account console.
- KE00 and KE13A are accepted. B04/B04.5 remain REVIEW; KE12 and downstream gates remain unchanged. KE13B and final KE13 operational acceptance remain separate and blocked.
- Next: complete the independent sequential review, then provide the user the exact Identity Center steps/policy for Stage 0 deployment plus budget setup. The current identity can perform read-only checks but cannot create those resources.
