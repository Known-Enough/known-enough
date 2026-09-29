# AWS Amplify staging frontend

## Purpose and current status

This is the AWS-hosted HTTPS frontend for the authenticated Known Enough staging app. Cognito remains the identity provider; the existing API Gateway, Lambda and DynamoDB remain the backend. Stage 0's CloudFront mock remains separate and unchanged.

Amplify app `known-enough-staging-amplify` (`d143q5ravxp5av`) and development branch `main` were created in `us-east-1`. The branch has no Git provider and no basic-auth gate. A GitHub Actions workflow builds the static web artifact, calls Amplify's manual deployment API, uploads a ZIP through its short-lived upload URL, and starts the deployment. It runs for frontend/package changes pushed to `main`, plus manual workflow dispatch. The active staging URL is `https://main.d143q5ravxp5av.amplifyapp.com/`; HTTPS deploy and CORS-origin checks pass. Real participant/display sign-in, authenticated scope/denial, durable write/reload/cold-start and replay/conflict checks passed on 2026-09-29; [KE13 operational/privacy completion](../docs/reviews/KE13-deployed-boundaries.md) records the exact evidence and limits.

The GitHub repo is public and was created on 2026-09-19. AWS trusts its immutable GitHub OIDC subject `repo:Known-Enough@331386621/known-enough@1377587215:ref:refs/heads/main`. The workflow gets 15-minute credentials for role `arn:aws:iam::092954139775:role/KnownEnoughAmplifyMainDeploy`. It can create/start deployments for only this app's `main` branch and read job status. It cannot change the app, branch, IAM, Cognito, API, Lambda, DynamoDB, or other Amplify sites. No AWS access key or GitHub personal access token is stored in GitHub or the repository. The app, branch, role and OIDC provider are tagged `CleanupAfter=2026-10-29`; tags do not delete resources automatically.

The deploy role scopes `amplify:CreateDeployment` to `arn:aws:amplify:us-east-1:092954139775:apps/d143q5ravxp5av/branches/main/deployments/*`; Amplify authorizes that API against the deployment child resource. `amplify:StartDeployment` is scoped to this branch and its deployment child resources, while `amplify:GetJob` is scoped to this branch's job resources. The repository's IAM JSON is the source to sync with the role. Changes to that file also trigger the deployment workflow.

## Build and deployment

The workflow is [deploy-amplify-staging.yml](../.github/workflows/deploy-amplify-staging.yml). It uses pinned Node from `.nvmrc`, runs `npm ci` and `npm run build`, then packages only `apps/web/dist/`. The six `VITE_*` values are public Cognito/API configuration compiled into browser code, not passwords or credentials. Do not put tokens or private data in these variables.

Each app/package change merged or pushed to `main` queues one staging deployment. A newer push cancels a deployment still running so the latest main build wins. Documentation-only changes do not consume a build. User B's author identity does not affect deployment; pushes on `main` use the same repository OIDC subject. Any intermediate KE12 build is staging content and can be replaced by the next successful push.

The deployment uses AWS's manual deployment flow without connecting an Amplify Git provider: [CreateDeployment API](https://docs.aws.amazon.com/amplify/latest/APIReference/API_CreateDeployment.html) returns a `zipUploadUrl` and job ID; the workflow uploads the ZIP and calls `StartDeployment`. AWS accepts manual Amplify hosting without a Git repository: [manual deployments](https://docs.aws.amazon.com/amplify/latest/userguide/manual-deploys.html). GitHub OIDC exchanges a GitHub Actions identity token for short-lived AWS credentials; no long-lived AWS credentials are needed: [GitHub OIDC for AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).

## First activation and live verification

After the first Amplify job succeeds:

1. **Done 2026-09-29:** workflow run `36620734722` deployed commit `d0a482b`; Amplify job 2 succeeded and the HTTPS URL returned 200. The build ran the production bundle scan.
2. **Done 2026-09-29:** added `https://main.d143q5ravxp5av.amplifyapp.com/` to callback and logout URLs on both existing Cognito clients. Vercel URLs remain allowed; authorization-code OAuth, `openid`, and token lifetimes were preserved.
3. **Done 2026-09-29:** changed Lambda `KE13B_ALLOWED_ORIGIN` from Vercel to `https://main.d143q5ravxp5av.amplifyapp.com`, preserving its other environment variables. Vercel remains hosted and its Cognito callback is allowed, but its browser cannot call the authenticated API after this origin switch. Restore the former Lambda origin for rollback.
4. **Done 2026-09-29:** Amplify-origin CORS preflight returned 204 with its exact `Access-Control-Allow-Origin`; Vercel-origin preflight returned no `Access-Control-Allow-Origin`. Unauthenticated API GET returned 401. Authenticated browser/API verification subsequently passed in the KE13 completion below.
5. **Done 2026-09-29:** real participant/display Cognito sign-in, shared-state write/reload/cold-start, membership denial, replay/conflict and display-write denial passed. [Evidence](../docs/reviews/KE13-deployed-boundaries.md) records user-operated participant checks separately from independent live probes. KE13 is DONE; native Alexa, model enablement, volunteers and release gates remain separate.

The front-end values are public: `us-east-1`, pool `us-east-1_V9OMjd0zx`, auth domain `known-enough-092954139775.auth.us-east-1.amazoncognito.com`, participant client `3accf7paalvon2m8ue8okfi853`, display client `481ru24906sv26f30i569gq8g0`, and API `https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com`. The build never receives a Cognito secret because both app clients are public clients.

## Cost and cleanup

The build runs in GitHub Actions rather than Amplify's build fleet, so Amplify build-minute charges do not apply to this deployment path. AWS's current Amplify page lists, outside applicable free allowances, `$0.023/GB-month` stored and `$0.15/GB` transferred; it lists 5 GB storage and 15 GB transfer at no cost for eligible accounts. For example, 1 GB stored and 1 GB served beyond free allowances is about `$0.17/month`, before credits/tax. This is an example, not an account estimate; actual build artifact size, traffic, free-tier eligibility and the user's reported credits have not been verified. No WAF or custom domain is enabled. See [Amplify pricing](https://aws.amazon.com/amplify/pricing/).

If staging is no longer needed:

1. Remove this workflow and push that change to `main` to stop future deployments.
2. Restore or remove the Amplify callback/logout URL from both Cognito clients. If returning to Vercel, restore the Vercel URL and Lambda origin recorded in [KE13](../docs/tasks/KE13.md).
3. Delete the Amplify app (which removes its branches and hosted artifacts):

   ```sh
   aws amplify delete-app --app-id d143q5ravxp5av --profile known-enough-staging-bootstrap --region us-east-1 --no-cli-pager
   ```

4. Remove the workflow deploy role:

   ```sh
   aws iam delete-role-policy --role-name KnownEnoughAmplifyMainDeploy --policy-name DeployOneAmplifyBranch --profile known-enough-staging-bootstrap --no-cli-pager
   aws iam delete-role --role-name KnownEnoughAmplifyMainDeploy --profile known-enough-staging-bootstrap --no-cli-pager
   ```

5. Delete the GitHub OIDC provider only if `list-open-id-connect-providers` and `list-roles-for-provider` confirm no other workflow uses it:

   ```sh
   aws iam delete-open-id-connect-provider --open-id-connect-provider-arn arn:aws:iam::092954139775:oidc-provider/token.actions.githubusercontent.com --profile known-enough-staging-bootstrap --no-cli-pager
   ```

This cleanup does not delete the Stage 1 API/Cognito/DynamoDB or the separate Stage 0 mock. Cleanup of those resources remains a separately scoped operation.
