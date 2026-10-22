# MCP API

Known Enough provides a self-hosted MCP server for shared decision information. The Alexa+ experience is a web simulation, without native device or gated developer-console connectivity. The [hackathon FAQ](https://amazonappdev2026.devpost.com/details/faqs) describes this submission path.

## Connection

- Endpoint: [https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com/mcp](https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com/mcp)
- Transport: Streamable HTTP, protocol `2025-11-25`, using the official TypeScript MCP SDK.
- Authentication: Cognito participant access token for an approved account. Every request checks current account and resource access.
- Sessions: stateless; no session ID is required between requests.

An unauthenticated request returns `401`. Authenticated GET returns `405` because server notifications are disabled. The endpoint accepts individual JSON-RPC messages over POST. Browser clients must use an authorized origin.

## Tools

| Tool | Arguments | Result |
| --- | --- | --- |
| `list_groups` | Optional `cursor` | Accessible group IDs and names |
| `list_group_decisions` | `groupId` | Accessible decision IDs and titles |
| `get_decision_progress` | `decisionId` | Shared answer and approval status |
| `get_decision_outcome` | `decisionId` | Current shared proposal or agreed choices |

The tools cannot read private answers, save answers, grant permissions, or approve proposals. The [web chat](../apps/web/src/alexa-chat.tsx) uses application chat routes and Bedrock. Its live decision card initializes an MCP client, discovers the shared tools and calls `get_decision_outcome`. It refreshes every 20 seconds while visible, on focus/return online, after message receipts and when the user selects Refresh. **About the assistant** shows this connection and read status. Chat replies continue to use application routes; a card read does not invoke a model.

## Client example

Requires curl with `--fail-with-body` support and your own approved Cognito participant access token. Set `KE_ACCESS_TOKEN` in a private shell through your sign-in flow, then run:

```sh
mcp_request() {
  curl --fail-with-body --silent --show-error \
    https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com/mcp \
    -H "Authorization: Bearer ${KE_ACCESS_TOKEN:?Set your participant access token}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -H 'MCP-Protocol-Version: 2025-11-25' \
    --data "$1"
}
mcp_request '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"review-client","version":"1.0.0"}}}'
mcp_request '{"jsonrpc":"2.0","method":"notifications/initialized"}'
mcp_request '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
mcp_request '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_groups","arguments":{}}}'
unset KE_ACCESS_TOKEN
```

The exchange initializes a client, discovers tools, and reads accessible groups. It makes no model calls. Use the returned group/decision IDs as arguments when invoking the other tools. Implementation: [server](../apps/api/src/mcp-server.ts) and [protocol contracts](../packages/contracts/src/alexa.ts).

## Live decision card

The card displays shared choices, proposal/agreement status and the recorded approval count from the structured tool result. Its short explanation is derived from that saved state, independently of generated conversation text. Results must match the open decision and the public schema; denied, malformed or mismatched results clear old card values. Private answers and owner snapshots are not accepted.

View agreed outcome / Review proposal refreshes the decision and opens the existing outcome modal. It sends no approval command. Unsaved decision edits and pending actions must be resolved before navigating through the card. Earlier conversation messages remain dated history; the card is a separate current read, not a rewritten message.
