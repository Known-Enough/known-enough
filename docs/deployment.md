# Deployment

## Hosted addresses

- Primary application: [known-enough.vercel.app](https://known-enough.vercel.app/)
- AWS Amplify mirror: [main.d143q5ravxp5av.amplifyapp.com](https://main.d143q5ravxp5av.amplifyapp.com/)

Both use the same AWS backend, accounts, and data. Vercel builds from `main`; Amplify uses the [frontend release workflow](../.github/workflows/deploy-amplify-staging.yml). Frontend releases must be published and checked on both sites. See the [hosting runbook](../infra/ke13-vercel-site.md).

## Prerequisites and configuration

Operators need AWS CLI v2, Python 3, AWS resource/IAM access, Bedrock Nova Lite access, Cognito clients, API Gateway/Lambda, DynamoDB storage, and the model-job control and retention configuration. Browser builds use the six public values in [development setup](development.md#connected-application-configuration).

A new browser origin must be configured in API/MCP CORS and in any Cognito callback/logout URLs used by its sign-in flow. The existing backend authorizes the primary and mirror origins; arbitrary preview or localhost origins are not allowed.

## Runtime publication

The [API initializer](../scripts/operations/partition-entry.ts), [worker initializer](../scripts/operations/jobs-runtime-entry.ts), [infrastructure templates](../infra/operations), and [coordinated release workflow](../.github/workflows/operations-jobs-api-release.yml) define the installed backend.

Publish compatible API/worker packages from one verified source, preserve private configuration and existing data, and use independently observed source/hash values for the guarded release. Check routes, deployed package hashes, current job admission, and the original worker schedule before completing publication. Preserve uncertain jobs and usage records across releases.

Private signing keys and resource manifests are generated and retained by the operator, outside the public repository. Current tooling targets the existing AWS installation; deploying into another account requires adapting account/resource guards and provisioning fresh private configuration. It is not a general-purpose fresh-account installer.
