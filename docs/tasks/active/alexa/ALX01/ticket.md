# ALX01 — Shared decision MCP assistant

Status: IN_PROGRESS/A. User manual acceptance; no automated product tests.

Build a self-hosted authenticated MCP endpoint and an on-demand **Simulated Alexa+** chat inside each decision. Native Alexa+ partner tools are unavailable; this is our web simulator, not a native Alexa integration.

The official MCP SDK performs initialize, tools/list and tools/call over Streamable HTTP (2025-11-25). Four read-only tools expose accessible group names/decision titles, public response and approval status, and public proposed/agreed choices. Existing JWT, approved-account, group and participant checks apply to every request. No private answers, owner documents, approval commands or paid model calls are exposed.

Open a decision → **Ask assistant**. Try “Who still needs to answer?”, “What did we agree on?”, “Who has approved?” or “Show this group’s decisions”. Supported questions are routed locally to real tools; this version is not an unrestricted language-model conversation. Connection details show the actual handshake and tool names without secrets or raw payloads. Messages stay in the open window and disappear when closed; current data is fetched for each supported question.

Delivery: compatible operations-managed API/worker publication, authenticated GET/POST /mcp plus unauthenticated OPTIONS, then matching frontend. Preserve existing runtime files, admission, totals and original worker schedule. Record publication hashes and matching workflow receipts; compilation/build is not manual end-to-end acceptance.

References: [hackathon FAQ](https://amazonappdev2026.devpost.com/details/faqs), [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
