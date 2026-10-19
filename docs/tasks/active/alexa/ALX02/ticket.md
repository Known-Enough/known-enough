# ALX02 — Durable group chat and private assistant

Status: CODE_READY / implementation claim released. Coordinated publication is pending. B direct worker; no helper agents.

Direct user request: pull latest main, add Group chat and Private assistant tabs to the Alexa+ simulator; normal bubbles, verified names and timestamps, one composer, small Technical details link. Persist messages across reopening until decision deletion or retention expiry. Group notice: “Everyone in this decision can see these messages.” Private sharing requires an explicit preview and post.

Natural language uses the existing approved Bedrock provider with durable usage/idempotency/unknown-call safeguards. The model selects a bounded response plan; server projections supply all status, approval and result facts. No approval, answer-save, permission or participant mutation is available to chat. Private context never crosses into group/provider context.

Baseline: clean main ff-only pull to 1d45162 succeeded, zero ahead/behind. Existing E2E02 documentation preserved in local stash and restored with both shared histories. Scope: chat contracts/application/storage codec/erasure, authenticated native HTTP/model runtime, simulator UI/CSS and focused privacy/replay/retention checks; existing tables/provider/permissions only. Exact serving model/effort unavailable. No live provider or participant probes planned.

Validation: 173 focused checks and three dedicated browser scenarios pass; type/lint/build, native API/worker compilation, reference/planning and whitespace checks pass. Full check has 1,650 passes/32 failures/two skips/one unhandled error; all failure names reproduce on pulled baseline. Three older compact-decision browser failures reproduce there too. [Implementation report](../../../../review-artifacts/ALX02/report.md), [exact evidence](../../../../review-artifacts/ALX02/validation.json). No live provider call or deployment occurred.
