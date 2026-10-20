# Hackathon submission review

Requirements checked on **October 20, 2026** against the official [overview](https://amazonappdev2026.devpost.com/), [rules](https://amazonappdev2026.devpost.com/rules), [resources](https://amazonappdev2026.devpost.com/resources), and [FAQ](https://amazonappdev2026.devpost.com/details/faqs). This review documents the project; it does not submit an entry or confirm private judge access.

The deadline is **October 23, 2026, 12:00 PDT** (**13:00 Mexico City; 19:00 UTC**). Judging ends **November 20, 2026, 12:00 PST**. See the [official schedule in the rules](https://amazonappdev2026.devpost.com/rules).

## Submission checklist

The [official submission requirements](https://amazonappdev2026.devpost.com/) are covered as follows:

| Item | Coverage or remaining action |
| --- | --- |
| Project description | [README](../README.md#functionality): functionality and operation |
| GitHub source, assets, setup/run instructions | Public [repository](https://github.com/Known-Enough/known-enough); [local and connected setup](../README.md#install-and-run-locally) |
| Public open-source license | [MIT license](../LICENSE), selected by the maintainer |
| Primary track | **Alexa+ web simulation**; [source and MCP instructions](../README.md#alexa-and-mcp). Select this track in Devpost. |
| Mini challenge | **AWS Builder** integration documented below; select it in Devpost if entering. No separate Open Source contribution is claimed. |
| Working platform demonstration | Hosted browser app and MCP exchange documented; the submitted video must demonstrate them. |
| Public English YouTube/Vimeo video, under three minutes | **Not yet recorded**, confirmed by the maintainer; use only media the team may publish. |
| Product feedback | Source-based technical assessment below, prepared for the Devpost feedback field. |
| Judge testing access | **Pending dedicated approved account credentials and access verification**, supplied privately in submission testing instructions; free evaluation access through judging must be arranged. |
| English materials | README and this document are in English; apply the same requirement to the video and submission. |
| New work during the event | Repository history begins September 19, 2026; manual/AI creation, private answers, proposals, approvals, durable chat, and MCP were implemented during the event. |

Architecture diagrams are included for review clarity; the checked pages do not prescribe a README-specific diagram format. Optional feature requests and friction logs are not mandatory. The [existing friction log](friction-log.md) contains no completed service entries; it is not presented as submitted feedback.

The [FAQ](https://amazonappdev2026.devpost.com/details/faqs) permits the web simulation without gated Alexa+ tooling or physical hardware. The public repository includes an MIT license and does not require private-repository reviewer invitations.

## Product feedback and AWS Builder integration

This technical assessment covers the implemented integrations and recorded issues. Each row states use, onboarding, strengths, improvement needs, and a reuse assessment. Gated Alexa+ tools were not available for direct evaluation.

| Tool, API, or SDK | Use and onboarding | Worked well | Needs work | Reuse assessment |
| --- | --- | --- | --- | --- |
| Amazon Bedrock Converse / Amazon Nova Lite; AWS SDK for JavaScript v3 | Public option suggestions, private interpretation, outcome reasoning, chat; required model access and explicit logging/retention checks | One API supports bounded role adapters and actual token accounting | Structured output requires Nova-compatible schemas, strict decoding, and clear terminal/unknown-call handling | Yes, with output validation and usage controls |
| Amazon Cognito; `amazon-cognito-identity-js`; `aws-jwt-verify` | Email verification, SRP participant sign-in, JWT verification; required public clients, pool settings, and application admission wiring | Verified identity remains separate from application membership and permissions | Cognito confirmation alone does not create application access; onboarding needs post-confirmation and recovery wiring | Yes, with documented identity/admission setup |
| Amazon API Gateway | HTTPS app and MCP routes; required exact route, JWT, and CORS configuration | Shared authenticated entry point for both hosted frontends | Route omissions, early-error CORS, and rate limits need explicit diagnostics and deployment checks | Yes, with route and origin readback |
| AWS Lambda | API, signup intake, and scheduled outcome worker; required source-bound packages and narrowly scoped execution roles | Separate request and background execution fit the decision workflow | Coordinated API/worker publication and source checks add operational complexity | Yes, with reproducible package verification |
| Amazon DynamoDB; AWS SDK v3 | Accounts, membership, decisions, private state, chat, jobs, and usage journals; required partition policies and transaction conditions | Conditional transactions support independent saves and exact approval authority | Aggregate size, transaction conflicts, pagination, and recovery require application-specific handling | Yes, for bounded transactional state |
| Amazon EventBridge | One-minute background outcome-worker schedule; required rule and invocation permission | Durable jobs can progress after the browser request ends | Schedule cadence affects latency; schedule, job admission, and worker source must be verified together | Yes, where minute-scale scheduling fits |
| Amazon S3 | Private release artifacts and recovery backups; required protected buckets and exact object permissions | Content-addressed artifacts support verification and rollback | Private recovery material must stay separate from public diagnostic artifacts | Yes, for release and recovery storage |
| Amazon CloudWatch Logs | Bounded operational events and request-reference diagnostics; required log access and retention configuration | Correlation references support diagnosis without publishing private content | SDK/transport errors need consistent finite categories; model-content logging requires separate checks | Yes, with explicit redaction and retention |
| AWS Amplify Hosting | Secondary hosted frontend; required application configuration and guarded publication workflow | Static web assets can be read back and compared against local hashes | A successful build alone does not verify runtime configuration or matching assets | Yes, with publication verification |
| Model Context Protocol / official TypeScript SDK | Self-hosted read-only tools and browser initialization/discovery; required Streamable HTTP adapter and approved JWT | SDK handles protocol requests while tools reuse existing access checks | SDK onboarding should clearly distinguish protocol support, client execution, and unavailable native Alexa+ tools | Yes, for scoped read-only integrations |
| Alexa+ developer tooling | Implemented the permitted web-simulation path | The simulation path permits a functional backend and custom browser UI | Native console, SDK, CLI, and simulator access remain gated; no hands-on assessment of those tools is claimed | Reuse the simulation path; reassess native integration if access becomes available |
| Vercel | Primary frontend hosting; Git-connected build from `main` | Current public address and automatic deployment were verified | Exact backend-origin configuration is required; arbitrary preview domains are not authorized | Yes, with explicit backend-origin configuration |
| React, Vite, TypeScript, Zod, ESLint, Vitest, Playwright | Browser UI, builds, strict schemas, static checks, controlled tests; pinned npm workspace installation | Shared types/schemas and isolated browser contexts support the public/private boundaries | Exact runtime pins and browser dependencies must be documented; existing suite failures must remain visible | Yes, with pinned dependencies and scoped validation |

Implementation references: [Bedrock adapters](../packages/adapters/src/bedrock-models.ts), [chat model](../packages/adapters/src/assistant-chat-model.ts), [API initializer](../scripts/operations/partition-entry.ts), [worker initializer](../scripts/operations/jobs-runtime-entry.ts), [MCP server](../apps/api/src/mcp-server.ts), [frontend hosting](../infra/ke13-vercel-site.md).

Recorded evidence: [registration repair](review-artifacts/FIX04/signup-live-proof.json), [chat implementation report](review-artifacts/ALX02/report.md), [current qualification](review-artifacts/E2E04/20261020T162508Z/report.md), and [hosting migration](review-artifacts/hosting/vercel-migration.json). These records retain their original dates and validation limits.

## Submission-owner completion

1. Publish the English demo video, showing the browser experience, private/shared separation, exact approvals, and simulated Alexa+/MCP operation. Add its actual URL to the README and Devpost.
2. Supply approved judge accounts privately, identify their organizer/participant roles and any prepared example, and verify access through the judging period. The local fixtures do not replace full hosted evaluation.
3. Enter the final track and mini-challenge selections, repository/application/video links, feedback, and testing instructions in Devpost before the deadline.

These external items remain open; documentation alone does not complete them.
