# KE13 connected site: Vercel CLI handoff

The authenticated app runs on Vercel project `known-enough-staging` in personal team `martelaxes-projects`. It is separate from the AWS CloudFront Stage 0 mock at `https://d23eowhnwtqts3.cloudfront.net/`, which remains untouched. The Vercel app uses Cognito sign-in and the deployed AWS HTTPS API/DynamoDB slice; authenticated shared-state behavior still needs browser verification.

**Deployed 2026-09-29:** stable URL [`https://known-enough-staging.vercel.app/`](https://known-enough-staging.vercel.app/); current deployment ID `dpl_Ftgo7kyZqKB6xpZdrGLn9obMdTz4`. The page returned HTTP 200 and a browser smoke showed both sign-in choices with no page errors. Participant sign-in reached the Cognito username form. The first incomplete placeholder deployment has been superseded.

## Build and deploy

The repository-root [Vercel configuration](../vercel.json) runs pinned `npm ci`, `npm run build`, and publishes `apps/web/dist`. The configured production build omits the local test picker when the six public settings below are present. These settings contain no browser secrets or AWS credentials.

## Git auto-deployment status

The Vercel project is connected to GitHub repository `Known-Enough/known-enough`; Vercel API confirms `main` as its production branch. A push to commit `22e9323b561c8fb1416889f6b3fc61c82c2ccb17` triggered production deployment `dpl_HJcD9Uvpx42k3anHu6ogzcd2oMsj`, source `git`, status `READY`; the stable alias returned HTTP 200. Vercel team plan is `hobby`. The tested commit was authored by the team owner `martelaxe`; Vercel documents that Hobby auto-deploys require the commit author to be the team owner, so User B's own commits may be rejected. See [Vercel's Hobby deployment rule](https://vercel.com/docs/git#using-hobby-teams). If B's author differs, use a separately secured GitHub Actions deploy token or revisit plan/team access; do not change B's Git author to impersonate A. Keep the pinned local `vercel build --prod` / `vercel deploy --prebuilt --prod` fallback. The AWS backend still deploys separately through its CLI runbook.

After AWS provisioning, use the actual values returned by Cognito and API Gateway:

```sh
vercel link --yes --team martelaxes-projects --project known-enough-staging
vercel env add VITE_COGNITO_REGION production --value us-east-1 --yes --no-sensitive --scope martelaxes-projects
vercel env add VITE_COGNITO_USER_POOL_ID production --value "$KE11_POOL_ID" --yes --no-sensitive --scope martelaxes-projects
vercel env add VITE_COGNITO_DOMAIN production --value "https://${KE11_DOMAIN_PREFIX}.auth.us-east-1.amazoncognito.com" --yes --no-sensitive --scope martelaxes-projects
vercel env add VITE_COGNITO_PARTICIPANT_CLIENT_ID production --value "$KE11_PARTICIPANT_CLIENT_ID" --yes --no-sensitive --scope martelaxes-projects
vercel env add VITE_COGNITO_DISPLAY_CLIENT_ID production --value "$KE11_DISPLAY_CLIENT_ID" --yes --no-sensitive --scope martelaxes-projects
vercel env add VITE_API_BASE_URL production --value "$KE13B_API_BASE_URL" --yes --no-sensitive --scope martelaxes-projects
```

For each release, pass only the six public settings to the local build environment; this avoids pulling Vercel's short-lived `VERCEL_OIDC_TOKEN` into a local file. Use the pinned Node 24.21.0/npm 11.19.0 toolchain and the Vercel prebuilt workflow:

```sh
export VITE_COGNITO_REGION=us-east-1
export VITE_COGNITO_USER_POOL_ID="$KE11_POOL_ID"
export VITE_COGNITO_DOMAIN="https://${KE11_DOMAIN_PREFIX}.auth.us-east-1.amazoncognito.com"
export VITE_COGNITO_PARTICIPANT_CLIENT_ID="$KE11_PARTICIPANT_CLIENT_ID"
export VITE_COGNITO_DISPLAY_CLIENT_ID="$KE11_DISPLAY_CLIENT_ID"
export VITE_API_BASE_URL="$KE13B_API_BASE_URL"
# Set PATH so pinned Node and npm are first, then run:
vercel build --prod --yes --scope martelaxes-projects
vercel deploy --prebuilt --prod --yes --scope martelaxes-projects
```

The project alias is confirmed as `https://known-enough-staging.vercel.app/`; the deployment-specific URL changes on each release. Both Cognito app clients' callback/logout URLs use that exact HTTPS URL plus `/`, and Lambda's `KE13B_ALLOWED_ORIGIN` uses the origin without a trailing slash. Update all three and redeploy if the stable alias ever changes. The Vercel local builder inherited npm 10.9.0 once and failed the exact npm 11.19.0 engine check; `PATH` must expose both pinned binaries before `vercel build`. Direct remote builds are not used.

Do not upgrade Vercel, register a domain or add paid products as part of KE13. The CLI deploy completed without an upgrade prompt; the exact account plan/billing was not checked. If Vercel requires an upgrade, leave deployment paused and report the billing blocker.

## Verification and rollback

Record the production URL and deployment ID. Open the URL and confirm the configured Known Enough sign-in page loads. Confirm an unauthenticated request to `$KE13B_API_BASE_URL/decisions/christmas-decision/public` returns `401`; do not treat the local demo account picker as hosted authentication. Roll back with `vercel rollback <deployment-url> --scope martelaxes-projects` after checking the target deployment. Remove the project only during separately directed cleanup using `vercel remove known-enough-staging --scope martelaxes-projects`; do not remove it during routine rollback.
