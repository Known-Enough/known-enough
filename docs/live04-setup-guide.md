# LIVE04: choose the email domain and fill in setup details

Local code preparation can continue with these inputs unknown. The offline helper below saves an incomplete draft; the installer still requires concrete values and recorded initial cloud/cost authorization. No cloud resources, DNS records, messages or deployments were created for this guide. [LIVE04](tasks/LIVE04.md) owns actual installation and online proof; [setup package](live-qa-setup.md) describes resources, costs and rollback.

## Current free option: no domain purchase

The user selected Mail.tm automatic disposable test mailboxes. Start with [the free-mode setup instructions](live-qa-setup.md#user-selected-free-verification-mailbox--2026-10-02). Use `--mailbox-provider mailtm` with a pinned package commit; domain and hosted-zone fields become null. Leave spending/installation approval disabled until the concrete AWS setup and recurring test limits are recorded. A domain search or purchase is no longer the next step. The domain/Route53 steps below remain the optional `owned-ses` alternative and historical preparation; they do not block free-mode installation.

The free mode still tests actual signup and email confirmation; provider unavailability is a visible failure. No full online PASS exists until real Cognito delivery, B's manual run and the deployment-triggered run succeed. One-time AWS installation remains required; personal credentials are not supplied to B.

## 1. What domain do we need?

Choose one **dedicated email subdomain of a domain you own or have permission to administer**, for example `qa-mail.yourdomain.com`. This is for synthetic signup verification emails only. Tests generate addresses under it, SES receives the messages into a private bucket, and the runner retrieves verification codes automatically. You do not need individual inboxes, Gmail/Outlook accounts or a website at that subdomain.

The app can keep its generated Amplify address, and login keeps the Cognito address. Neither `amplifyapp.com` nor `amazoncognito.com` is a parent domain you control for email DNS. `yourdomain.com` and `example.org` in this guide are examples, not domains to enter unless you actually control them.

SES requires public DNS MX routing for incoming email and a verified sending identity. The approved installer creates the subdomain MX record (`10 inbound-smtp.us-east-1.amazonaws.com`), three DKIM CNAMEs, SES identity and receipt rule, plus private mailbox storage. Leave those records to the installer so its ownership/conflict checks work. Choose a subdomain that does not already receive real mail; preserve the parent domain's existing mail records. [AWS SES MX instructions](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-mx-record.html).

## 2. Find an existing domain and public hosted zone

A performs these account checks using A's existing AWS session. B does not need A's credentials. The prepared package targets AWS account `092954139775`, region **US East (N. Virginia), us-east-1**; these identifiers are fixed safety boundaries rather than missing setup inputs.

1. Sign in to AWS Console and confirm the account ID in the account menu.
2. Open **Route53 → Hosted zones**. Look for a **Public** zone for a domain your team controls. Private zones cannot serve the public SES mailbox; installer validation rejects them.
3. Open the zone and record its **Hosted zone ID** (starts with `Z`), its domain name and its four name servers. A zone existing in AWS alone does not prove the public domain points to it: compare its name servers with the domain registrar's DNS settings/public DNS.
4. If the domain already uses this Route53 public zone, reserve an unused subdomain, such as `qa-mail.<owned-domain>`. Use the parent zone ID in `hostedZoneId`. No separate zone or domain purchase is needed for this path. Check that no delegated child zone or existing MX records already controls that chosen subdomain.
5. If several zones have the same name, use the one actually delegated in public DNS. Do not create a duplicate zone merely to obtain an ID.

Optional read-only CloudShell commands (no resource creation):

```bash
aws sts get-caller-identity --query Account --output text
aws route53 list-hosted-zones --query 'HostedZones[].{ID:Id,Name:Name,Private:Config.PrivateZone}' --output table
```

For the selected ID:

```bash
QA_ZONE_ID=REPLACE_WITH_SELECTED_ZONE_ID
aws route53 get-hosted-zone --id "$QA_ZONE_ID" --query 'DelegationSet.NameServers' --output text
```

Route53 may display `/hostedzone/Z...`; the configuration helper accepts that form and saves the plain `Z...` ID. These commands do not inspect secrets or private Lambda environment values. Permission denial is a setup dependency for A, not a reason to copy credentials.

## 3. If DNS is at another provider, or no domain exists yet

**Owned domain, DNS elsewhere:** keep the parent domain at its current DNS provider. When the DNS/resource changes are authorized:

1. In Route53 in the target AWS account, choose **Hosted zones → Create hosted zone**.
2. Enter the exact dedicated subdomain, for example `qa-mail.<owned-domain>`, and select **Public hosted zone**.
3. Copy the four name servers Route53 creates for that child zone.
4. At the current authoritative DNS provider for the parent domain, add an **NS record for `qa-mail`** containing all four child-zone name servers. Keep the parent's existing name servers, website and mail records. Keep the NS/SOA records Route53 created inside the child zone.
5. Wait for public DNS to resolve the child-zone delegation, then use that child zone's ID as `hostedZoneId` and its exact name as `mailDomain`. The installer supports a public parent zone or a delegated zone with the exact mail-domain name.

AWS documents [subdomain delegation without moving the parent domain](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/CreatingNewSubdomain.html). New zones and DNS changes are a separate authorized setup action; this guide does not perform them.

**No controlled domain yet:** first check whether the team can reuse an existing project/company domain or receive a delegated subdomain from its owner. Otherwise a person must choose and register a domain through a registrar, review its purchase/renewal cost, and configure authoritative public DNS. A public hosted zone alone does not register or grant ownership of a domain. Once a registered parent domain is controlled, use either section 2 or the delegation steps above. No particular brand name or top-level domain is required by this package, and the code stays configurable while this choice is pending. [Creating a Route53 public hosted zone](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/CreatingHostedZone.html).

## 4. Check email eligibility and conflicting mail routing

In AWS Console select **N. Virginia**, open **Amazon SES**, then check **Account dashboard** and **Email receiving → Rule sets**. Record whether sending is enabled, whether the account is in the sandbox, and the active receipt rule set's name.

Read-only CloudShell alternatives:

```bash
aws sesv2 get-account --region us-east-1 --query '{SendingEnabled:SendingEnabled,ProductionAccessEnabled:ProductionAccessEnabled}' --output table
aws ses describe-active-receipt-rule-set --region us-east-1 --query 'RuleSet.Name' --output text
```

The QA installer expects no unrelated active receipt rule set; it refuses to replace one. If there is an unrelated active rule set or existing MX record on the proposed mail subdomain, record the conflict in LIVE04 and prepare a separately scoped integration or choose a compatible dedicated target. Do not disable existing real mail to make the QA setup pass.

SES sandbox sending is limited to verified recipients/domains (or AWS's simulator). Our required scenario uses real synthetic signup recipients under the same domain the installer verifies; the simulator cannot replace actual verification delivery. A verified domain can cover those recipients, so production access is not automatically required merely because the account is sandboxed. Actual Cognito/SES permission, throttling and delivery eligibility must still pass LIVE04; document any service-specific failure rather than skip signup. [SES sandbox restrictions](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html). Tests stay within the separately approved message envelope.

## 5. Save a configurable draft now

From a clean local repository with pinned Node **24.21.0/npm 11.19.0**, create a private file outside the repository. On WSL, Linux, macOS or CloudShell:

```bash
node scripts/live-qa/configure.mjs init "$HOME/live-qa-config.json"
node scripts/live-qa/configure.mjs check "$HOME/live-qa-config.json"
```

Both are offline and make no AWS/network requests. `init` creates a mode-0600 file and never overwrites an existing file or follows an existing output symlink. With no inputs it returns `NEEDS_INPUTS` and names the missing domain, zone and source commit. That is a saved draft, not installation failure. Edit this same private file when details become known; no repository source edit is necessary. If creating a different fresh file after discovering values:

```bash
node scripts/live-qa/configure.mjs init "$HOME/live-qa-config-complete.json" \
  --mail-domain qa-mail.REPLACE_WITH_OWNED_DOMAIN \
  --hosted-zone-id REPLACE_WITH_PUBLIC_ZONE_ID \
  --source-commit REPLACE_WITH_LATEST_VERIFIED_40_CHARACTER_PACKAGE_COMMIT
```

Use the latest verified package in LIVE04, not an invented hash or an arbitrary branch. Domains are normalized to lowercase without a trailing DNS dot. Unknown flags, malformed DNS labels/zone IDs/commits and attempt to pass approval flags are rejected. `check` reports field names only. Complete syntax produces `READY_FOR_READ_ONLY_VALIDATION`; it does not establish DNS ownership, permissions, spending approval or installed services.

The configuration deliberately keeps `approved=false`, all limits zero and `primaryRollout=false`. The expired example timestamp is harmless while approval is disabled; supply a future exact UTC expiry only as part of the later approved envelope. Do not enable approval simply to silence a draft status.

## 6. Fill the remaining values at installation time

| Value | How to obtain it | What can stay pending now |
| --- | --- | --- |
| `mailDomain` | Owned SES: controlled unused email subdomain; Mail.tm: not needed | `null` in Mail.tm mode |
| `hostedZoneId` | Owned SES: public zone; Mail.tm: not needed | `null` in Mail.tm mode |
| `sourceCommit` | Latest verified implementation package recorded in LIVE04 | Placeholder until package is selected |
| `primaryRollout` | Enable only for coordinated primary feature installation | `false` while preparing; QA-only installation does not close LIVE04 |
| `primaryExpectedRevision` | Fresh read-only Lambda revision immediately before primary installation | `null` while `primaryRollout=false` |
| `authorization` fields | Explicit approved resources/publication, model/email limits, exact UTC expiry and retention/logging review | Disabled/zero draft |
| GitHub installed target | Installer's actual allowlisted `installed-target.json` after successful readback | Do not guess/generated-host placeholders |

A can retrieve only the fresh primary revision/model-off flags, without printing the whole environment:

```bash
aws lambda get-function-configuration --function-name known-enough-stage-api --region us-east-1 \
  --query '{RevisionId:RevisionId,ModelMode:Environment.Variables.KE14_MODEL_MODE,PaidCallsApproved:Environment.Variables.KE14_PAID_CALLS_APPROVED}' --output json
```

Coordinate primary installation with A's active NP00 work. The installer refuses enabled primary models, changed revisions and active/incomplete QA cleanup. Record that readback just before apply; do not save an old revision as an evergreen default.

For `invocationLoggingDisabled`, A checks **Amazon Bedrock → Settings → Model invocation logging** in us-east-1. The installer refuses any enabled data-delivery modality. This setting can capture full model inputs/outputs; record the actual state and coordinate any required account-level change rather than silently changing other workloads. Set the flag only after verifying the requirement. `retentionReviewed` records review of the actual provider/data retention arrangement and QA mailbox/log/fixture cleanup, not a fact the offline helper can discover. [Bedrock invocation logging](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html).

The setup page supplies the proposed finite test envelope, the resource list, model reservation limit, infrastructure estimate and rollback. Those are planning details, not an approval or total AWS billing cap. Review domain/zone charges separately if the chosen path creates them. Configuration can be prepared without deciding those costs today.

## 7. Install once, then run through GitHub

Once the concrete inputs and initial cloud/publication/model/email envelope are approved:

1. A uses the [commit-pinned CloudShell entry command](live-qa-setup.md#where-to-click-and-the-one-entry-command) with the reviewed private configuration. Start with `dry-run` (offline build), then `validate` (read-only account/zone/conflict checks). Only the separately authorized `apply` creates/publishes the reviewed resources and enables the envelope.
2. Let the installer create the approved QA/roles and primary feature setup (SES/DNS/mailbox resources only in owned SES mode); check `SETUP_READBACK_PASS`. This is setup readback, not journey acceptance. Preserve private rollback files.
3. Configure the actual GitHub target/enable variables using [the automation guide](live-qa-automation.md). Do not put credentials, raw mail, passwords or private environment snapshots into GitHub variables or Git.
4. B launches the manual GitHub check using B's own account; all required lanes must pass and clean up. A's AWS session is no longer needed for ordinary installed runs.
5. Perform the separately authorized deployment and prove its automatic matching full check. LIVE04 completes only with both actual passing run links, tested SHA, privacy/model/mail/cleanup evidence and remaining obligations resolved.

Until then, code and draft preparation remain usable and configurable; installation is the only part waiting on infrastructure choices.


## Recovery for the first low-quota Mail.tm installation

LIVE04's first apply failed because this account's Lambda concurrency limit is 10 and the earlier template requested two reserved executions for each of four functions. The repaired template uses shared account capacity, keeps API throttling and all atomic fixture/model/email reservations, and needs no quota increase. Shared capacity can still throttle competing workloads; a quota request can remain pending without blocking this setup. No function provisioned concurrency is purchased.

For the exact failed e0cd5ddd3ede595eea88aef3481c23bf01363a8a Mail.tm stack, use the latest verified repair package recorded in LIVE04 and the existing private approved configuration. Change only `sourceCommit` to the repair pin; refresh `primaryExpectedRevision` immediately before final apply and verify primary models remain off. Preserve the original exact expiry and all run/model/email limits. Do not recreate the seven-day window on retries.

Run the same pinned setup entry command with `recover` first, then `apply`. Recovery requires the owned stack to be ROLLBACK_COMPLETE with exactly the three retained QA tables and no other remaining resource. It verifies the known failed source/provider/table definitions, actual table schemas/tags and absence of an active cleanup lease, journals privately, removes only the failed stack metadata, and imports the retained tables into a new stack with an explicit recovery marker. It never deletes a table or reads/deletes table contents. The import change set may contain only three Import actions. Drift, unrelated resources or active fixtures block recovery. A successful `RETAINED_TABLES_IMPORTED` is not completed installation or live qualification.

`apply` verifies the exact imported template/resources before adding the remaining QA resources; it creates the private email key for that import skeleton rather than pretending a previous parameter exists. Final normal stack outputs replace the temporary recovery marker. A private recovery journal lets the same pin/config resume after metadata removal or import; preserve that directory. A completed import can be checked again without writes. Full installation/qualification still requires real AWS readback and B/manual plus post-deployment PASS.
