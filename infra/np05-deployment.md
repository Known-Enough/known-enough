# NP05 deployment checklist — no operations performed

NP01 local code is opt-in through `NP_GROUPS_ENABLED=true`. Before deploying, A must authorize/provision a dedicated DynamoDB table with PK/SK keys, grant Lambda exact GetItem/PutItem on it and supply `NP_GROUP_TABLE_NAME`, a stable secret `NP_GROUP_EMAIL_KEY` (32+ characters), and exact `NP_COGNITO_DOMAIN`. Protect the key in configured secret storage; rotation needs a migration because invitation/account recipient hashes depend on it. The bounded aggregate allows 256 accounts, 32 groups, 16 members/group and rejects data over 300 KB. Strong reads/version CAS prevent lost membership/admission writes. Operator credentials have write authority over this state and must be restricted to A.

Enable Cognito self-signup, verified email and the participant client's `openid email` scopes and hosted sign-up UI only through authorized settings changes. The server fetches `/oauth2/userInfo` with the already verified participant access token, checks matching subject and verified email, then registers PENDING. It never trusts caller email/approval claims. All group/decision requests reread approval state; disabling denies old sessions immediately at application admission. Unconfigured legacy deployment stays unchanged. New users cannot use an unconfigured group server.

Prepare/add exact `/account`, `/account/register`, `/groups`, `/groups/accept`, `/groups/{groupId}/invitations`, `/groups/{groupId}/remove` routes with existing JWT authorizer, integration and CORS. No operator route is exposed. Run on A's authorized host:

```sh
AWS_PROFILE=<A-scoped-profile> AWS_REGION=us-east-1 NP_GROUP_TABLE_NAME=<approved-table> node --experimental-transform-types scripts/group-operator.mjs list
# Use the returned verified subject/version. No email or token is printed.
AWS_PROFILE=<A-scoped-profile> AWS_REGION=us-east-1 NP_GROUP_TABLE_NAME=<approved-table> node --experimental-transform-types scripts/group-operator.mjs approve <subject> <version> --confirm
```

`reject` is limited to pending accounts; `disable` blocks any current account. Exact repeated target states are idempotent; changes require the observed version. CLI failures suppress SDK details. Perform role simulation/readback and real synthetic registration/admission/persistence/replay/expiry/old-session denial in NP05. Live credentials/recipient addresses/tokens never enter repository evidence.

Optional transactional email is deferred: copyable links work without a sender, no live send/configuration is performed. Sender implementation/configuration/delivery evidence needs separately authorized scope in NP05. Source commits carry `[skip ci]` until NP05 approves deployment; authorize workflow dispatch on exact tested main source rather than silently publishing intermediate commits.
## Optional invitation email preview (not sent)

Subject: Invitation to join {{group name}} in Known Enough

{{organizer display name}} invited you to {{group name}}. Sign in or register with the email this invitation was issued for, verify your email, and request access if needed. Accepting joins the group; it does not confirm a decision, share your private needs or approve an agreement. This link expires in 24 hours: {{recipient-bound link}}. If you were not expecting it, ignore it. No automatic reminders or marketing mail.

NP05 must implement a sender adapter with validated destination/origin, escape rendered HTML and authorize the exact recipient before sending. An app link preview does not establish delivery.

## NP02 additions

Authorize exact GET/POST `/groups/{groupId}/drafts`, `/groups/{groupId}/drafts/{draftId}`, POST `/groups/{groupId}/drafts/{draftId}/create`, GET `/groups/{groupId}/decisions/{decisionId}/review` and POST `/groups/{groupId}/decisions/{decisionId}/revise`, plus CORS/JWT integration. With groups enabled, the general model path may omit `KE14_MEMBER_BINDINGS`; legacy templates are available only with their directory explicitly configured. Existing paid-runtime/retention/logging guards remain required. Paid scope/budget must be authorized anew; this feature does not extend old allowances.

Public drafts and their exact revisions live in the bounded group aggregate. Group membership revision deliberately freezes linked decisions, including public reads, until explicit roster review clears old authority. Removed users are denied before application access. Generated offers derive from public typed domains; no real price/availability lookup or universal optimization is claimed. Unsupported domains require clarification. Qualify general signup/group/roster/cold-retry and model prompt quality in NP05.
