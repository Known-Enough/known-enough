# KE14 staging deployment checkpoint — 2026-09-30

**Historical code-only checkpoint; model-disabled statements below were superseded by the separately authorized [AI activation](ke14-ai-activation.md) on September 29 client date (September 30 UTC).**

**Reviewed code deployment SUCCEEDED; models remain disabled.** The user explicitly authorized deployment after the [R1/R2 follow-up PASS](reviews/KE14-KE09-followup.md#ke14-r1r2-followup), then completed AWS SSO sign-in. User A / Codex GPT-6, exact variant/effort unexposed, started from clean synchronized `main` at `93d5eda2395ff5ae7ea7bdc92d28d05441b9b167`; ff-only pull succeeded, ahead/behind 0/0. No executable source changed. The reviewed Lambda bundle and exact API creation routes are deployed; the existing frontend matches the reviewed build. Deployment claim released. KE14 remains REVIEW for model approval/activation and actual live two-scenario qualification; KE15 stays BLOCKED.

## Verified artifact and staging state

- Account `092954139775`, region `us-east-1`; existing Lambda `known-enough-stage-api`, API `u94iyvt6p9`, table `KnownEnoughStage`, runtime role `KnownEnoughStageApiRole`. Before release, Lambda Active/Successful, Node 24.x, 512 MB, 29-second timeout; original ZIP SHA-256 `8e01ad21d9233b834b76e1aee77d32e37f6898f5827c49182c64d54fe1b26211`. After revision-guarded update at `2026-09-30T02:16:59Z`, Lambda is Active/Successful with reviewed ZIP SHA-256 `017aae3553a16edbd7b3c019956b388f3e6c16bd08a238e1f705a785c220c6ca` (AWS base64 `AXquNVOhbtvXs8AZlWs4jz5sFr0Iojjh9wWnhcIgxso=`), revision `aa5e0187-23ea-440a-a03c-9268678a2c6a`. Original ZIP downloaded privately and its hash verified for rollback. Environment/runtime/role/handler/memory/timeout/layers/network/KMS/tracing compare unchanged; runtime IAM and existing data were not modified. There is still no model invocation permission.
- Reviewed source matches the successful pinned full check (417 unit/integration passes / 2 optional skips, hosted 1/1, E2E 47/47). Reused this exact-source evidence. Pinned Node 24.21.0/npm 11.19.0 and Rolldown 1.2.9 built a single root `ke13b-lambda.mjs` in the ZIP. Bundle SHA-256 `0fd0c033762bb1fbed38d9eef97bf4766a2b04b140deb45ca3bacc6ffc9a5899`; ZIP SHA-256 `017aae3553a16edbd7b3c019956b388f3e6c16bd08a238e1f705a785c220c6ca`. Artifact directory `/tmp/ke14-deploy-93d5eda`. Bundled mock-identity/unauthenticated `POST /decisions` returned 401 without cloud inference.
- Amplify app `d143q5ravxp5av`, main job 4 **SUCCEED**. [Existing hosted frontend](https://main.d143q5ravxp5av.amplifyapp.com/) `index.html`, JavaScript entry, CSS and JSX runtime all returned 200 and match the reviewed configured production build byte for byte. No redundant frontend release was started. The index SHA-256 is `867259c6c93dc3a2bb3abd6774d81d383c0631b9015d4151572ba24e2161a43d`, JS entry `29db0b86589df4fdbb2a2b3921a69e74114e914dc9296c721bf19a11f79fab18`. Full local comparison `/tmp/ke14-deploy-93d5eda/frontend-verified.json`, SHA-256 `1d21df52a3952ae2f31f71c21b5910e7d633549630a69e48318ae242149c1815`.
- Gateway’s current `ANY /decisions/{proxy+}` JWT route and `OPTIONS /decisions/{proxy+}` cover existing decisions but do not match exact `/decisions`. New `POST /decisions` route `6x2b755` now uses **the existing JWT authorizer** `vnsmtt`, both existing client audiences, and integration `odmtgut`; exact `OPTIONS /decisions` route `znqyhoe` uses the same integration with NONE authorization for preflight only. Existing routes were retained; the stage remains AutoDeploy true, burst 10/rate 5 requests per second. Authorizer/integration readback matched. Pre-release probes: existing signed-out public GET 401; exact creation POST and preflight currently 404; existing decision preflight 204 with the exact Amplify origin. No authenticated route was made public. Post-release creation POST with absent or invalid bearer is 401; exact allowed-origin preflight is 204, and unrelated-origin preflight has no usable CORS.

## Scoped release identity

The [runbook](../infra/staging-runbook.md) forbids using the root bootstrap identity for incremental releases. The Stage 0 SSO session was expired and its permissions do not cover Stage 1. Two attempts to derive restricted release credentials failed before Lambda/API mutation: AWS forbids root AssumeRole and forbids GetFederationToken with the existing temporary bootstrap credentials. The first attempt’s temporary IAM role/policy `KnownEnoughKe14Deploy20260930` was deleted; deletion was verified. No IAM access key was created.

Root bootstrap was then used only to prepare scoped Identity Center release access for the existing account owner. `KnownEnoughStage1Release`, permission set `arn:aws:sso:::permissionSet/ssoins-722328a7765eb0e8/ps-07178de9010e1399`, account-owner assignment **SUCCEEDED**, one-hour session duration; local profile `known-enough-stage1-release` uses the existing `known-enough-sso` session. No other user or application participant was changed. The user completed the device sign-in; STS verified the exact account and `AWSReservedSSO_KnownEnoughStage1Release_03e68294373fa539` assumed role. All incremental Lambda/API release actions used this scoped profile. No credentials, session tokens or device code are recorded here.

Installed inline policy, read back exactly:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ExactLambdaRelease",
      "Effect": "Allow",
      "Action": [
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:InvokeFunction"
      ],
      "Resource": "arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-api"
    },
    {
      "Sid": "ExactApiRouteRelease",
      "Effect": "Allow",
      "Action": [
        "apigateway:GET",
        "apigateway:POST",
        "apigateway:DELETE"
      ],
      "Resource": [
        "arn:aws:apigateway:us-east-1::/apis/u94iyvt6p9/routes",
        "arn:aws:apigateway:us-east-1::/apis/u94iyvt6p9/routes/*",
        "arn:aws:apigateway:us-east-1::/apis/u94iyvt6p9/authorizers/*",
        "arn:aws:apigateway:us-east-1::/apis/u94iyvt6p9/stages/*"
      ]
    }
  ]
}
```

Policy SHA-256 (original JSON bytes) `330128c111795da2bcf4ac674c4eaa74e127130f33128ec8b0df79e898dbb4fd`. AWS `SimulateCustomPolicy` passed **42 action/resource assertions**: exact Lambda code update and exact API route create/delete allowed; unrelated Lambda/API, IAM creation, direct table scan and Bedrock invocation denied. Policy simulation supplements the actual session/readback checks; it is not proof of live release success. Simulation artifact SHA-256 `31c137d2b81d2d7a7646ede4bac906fdc8125d843217e2963759fa42ae662dbc`. This operator identity does not change application membership, consent or runtime identity.

## Live verification and remaining work

- **HTTP 6/6:** existing public GET absent bearer 401; new creation POST absent/invalid bearer 401; exact creation preflight and existing public preflight 204 with the Amplify origin; unrelated-origin creation preflight 204 with no usable CORS. Direct invocation of the deployed Lambda with mock identity and no bearer returned **401**; gateway authorizer bypass did not create an authenticated actor.
- **Real Cognito PKCE smoke:** two pre-existing agent-owned synthetic QA accounts were temporarily enabled with fresh private passwords and messages suppressed. Display public read **200**, strict public fields and null viewer verified, owner read **404**, command write **403**, unrelated room **404**. Unbound participant public/owner/write/unrelated-room reads all **404**. New exact creation POST with valid QA bearer reaches Lambda and returns **404** while model services are disabled, rather than spending or creating state. Both tampered tokens return **401**, token lifetime **900 seconds**, browser errors **0**, sign-out clears session storage. Display UI contains neither private profile nor private-condition controls. No real participant account, credential, group or membership was modified.
- **Cleanup/logs:** both QA users were globally signed out and disabled, verified by readback; temporary passwords and tokens were deleted locally. Already-issued offline JWTs remain bounded by their 15-minute lifetime rather than being claimed instantly revoked. CloudWatch scan returned **82 platform events**, **0 credential/private markers**. It is a bounded scan, not a claim about every future log.

Evidence in `/tmp/ke14-deploy-93d5eda`: `http-smoke-results.json` SHA-256 `d2a61f9b228a9423412319d5fb0853b86bc6f5b3bbe4b00a259b428fc834cc37`; `browser-results.json` SHA-256 `a9af4dee454316910ec01d3daf349cde97b5576ed1ce5c79b1fde61a8e793856`; `log-scan-results.json` SHA-256 `826de8f6ec6a1e76799738f4366acec41f5b993fb641bebc716a3f418d516f3c`; `after-routes.json` SHA-256 `4892e3d2a8cf31863fbab446347c6e51c6a8237ee0ef1fdfa49fd7057856b74c`.

The separate paid-call question is still pending: deployment approval and AWS sign-in were **not** treated as approval to activate paid model calls. `KE14_MODEL_MODE` remains absent/disabled; no model guard flags or member directory were installed in Lambda and no Bedrock call occurred. Accordingly AI creation, owner interpretation and model reasoning remain unavailable. If approved, prepare/install only the separately reviewed exact Nova Lite invocation permission and set the explicit guards and trusted subject directory; verify privacy/config readback before at most eight smoke requests. No account-wide retention change is implicit.

KE14 still needs actual managed Christmas/Purchase qualification on the deployed model-enabled artifact and each participant’s own confirmations, permissions and exact approvals. Local scripted-provider checks and this code-deployment smoke do not satisfy those criteria. No booking/purchase, data migration, external message or Stage 0 modification occurred. Before a software rollback after model-created extended records exist, retain the new codec reader or handle those records explicitly; model disablement is safer than assuming the prior strict reader accepts new creation receipts.

Bedrock read-only checks: Nova Lite `amazon.nova-lite-v1:0` ACTIVE in `us-east-1`; invocation logging has no configuration, account retention mode is `inherit`. Current [logging documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html) and [retention documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html) were reviewed. No zero-retention guarantee is inferred from disabled invocation logging. No account retention setting was changed. Five existing synthetic participant subjects were verified as unique and enabled; private binding artifact hash `a176b0d20e22cb70017eca50a4ceecf8b4195de3a762a8cf8884743cc5558c37`. Subjects, private inputs and credentials are not published; no real participant passwords or memberships were changed; only the two agent-owned QA passwords were replaced temporarily for the smoke. No model call, booking/purchase, data migration, external message or Stage 0 modification occurred.
