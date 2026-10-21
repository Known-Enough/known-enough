# Architecture

The browser is a React/Vite application. Cognito authenticates users; API Gateway and Lambda serve authenticated application and MCP requests. DynamoDB holds accounts, memberships, decisions, private answers, chat, approvals, and model jobs. The backend runs in `us-east-1`.

## AI and decision processing

Amazon Bedrock Converse invokes `amazon.nova-lite-v1:0` for suggestions, private interpretation, outcome reasoning, and chat. Drafting and chat run through API request handlers. Outcome work runs in a separate Lambda on a one-minute EventBridge schedule, using DynamoDB job records.

Code checks model output against strict schemas and validates proposals before publication. Current progress, approval counts, and outcomes are rendered from server state. The model does not grant permissions or approve proposals.

The [MCP server](mcp.md) shares the existing access checks and exposes four read-only tools. The web chat uses authenticated application routes; opening **About the assistant** checks MCP initialization and tool discovery.

## Supporting services

Vercel and AWS Amplify host the frontend. Amazon S3 stores private release packages and recovery backups. CloudWatch Logs holds bounded operational diagnostics. Deployment and recovery storage are separate from participant-facing data.

## Source map

| Source | Responsibility |
| --- | --- |
| [apps/web](../apps/web) | Browser UI, Cognito sign-in, forms, and chat |
| [apps/api/src](../apps/api/src) | Authenticated HTTP, MCP, and runtime composition |
| [packages/contracts](../packages/contracts) | Request, response, and model-output schemas |
| [packages/domain](../packages/domain) | Typed rules and proposal validation |
| [packages/application](../packages/application) | Lifecycle, permissions, approvals, and chat projections |
| [packages/adapters](../packages/adapters) | Cognito, DynamoDB, Bedrock, and job adapters |
| [scripts/operations](../scripts/operations) and [infra/operations](../infra/operations) | Packaging, infrastructure, release, and recovery |

Entrypoints: [API](../scripts/operations/partition-entry.ts), [outcome worker](../scripts/operations/jobs-runtime-entry.ts), and [chat runtime](../apps/api/src/partition-chat-runtime.ts). The earlier [architecture direction](known-enough-architecture.md) retains the design history.
