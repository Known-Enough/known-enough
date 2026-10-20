import { applicationOrigins } from './application-origins.ts';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { Alexa, Groups } from '@deal-table/contracts';
import type { HttpApiEvent, HttpApiResult } from './ke13b-lambda';

type Handler = (event: HttpApiEvent) => Promise<HttpApiResult>;
/** Stateless MCP transport. Each tool delegates to the original verified app read path. */
export function withSharedMcp(app: Handler, allowedOrigin: string): Handler {
  return async event => {
    if (event.rawPath !== '/mcp') return app(event);
    const requestId = randomUUID();
    let status = 503;
    const headers = new Headers();
    if (event.headers && typeof event.headers === 'object' && !Array.isArray(event.headers)) {
      for (const [key, value] of Object.entries(event.headers)) if (typeof value === 'string' && !/[\r\n]/.test(value)) headers.set(key, value);
    }
    const origin = headers.get('origin');
    const origins = applicationOrigins(allowedOrigin);
    const cors = { 'cache-control': 'no-store',
      ...(origin && origins.includes(origin) ? { 'access-control-allow-origin': origin } : {}),
      'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id',
      'access-control-expose-headers': 'MCP-Session-Id, MCP-Protocol-Version, X-Request-Id', vary: 'Origin', 'x-request-id': requestId };
    const reply = (code: number, message: string): HttpApiResult => { status = code; return { statusCode: code, headers: { ...cors, ...(code === 405 ? { allow: 'POST, OPTIONS' } : {}), 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }), isBase64Encoded: false }; };
    let server: McpServer | undefined;
    try {
      if (origin && !origins.includes(origin)) return reply(403, 'Origin is not allowed.');
      const method = event.requestContext?.http?.method;
      if (method === 'OPTIONS') { status = 204; return { statusCode: 204, headers: cors, body: '', isBase64Encoded: false }; }
      if (!['GET', 'POST'].includes(String(method))) return reply(405, 'Method not supported.');
      if (event.rawQueryString) return reply(400, 'Query parameters are not supported.');
      if (!/^Bearer [A-Za-z0-9._~-]+$/i.test(headers.get('authorization') ?? '')) return reply(401, 'Sign in to Known Enough.');
      const read = async (path: string): Promise<unknown> => {
        const [rawPath, rawQueryString = ''] = path.split('?');
        const result = await app({ ...event, rawPath, rawQueryString, body: undefined, isBase64Encoded: false,
          requestContext: { ...event.requestContext, http: { ...event.requestContext?.http, method: 'GET' } } });
        if (result.statusCode !== 200) throw Object.assign(new Error('Shared information is unavailable.'), { status: result.statusCode });
        return JSON.parse(result.body);
      };
      // Initialize/list-tools are authenticated too; downstream verifies the token and current admission.
      const account = await read('/account') as { account?: unknown };
      if (Groups.AccountSnapshot.parse(account.account).status !== 'APPROVED') return reply(403, 'App access is required.');
      if (method === 'GET') return reply(405, 'Server notifications are not enabled.');
      if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 16384) return reply(400, 'Invalid MCP request.');
      let parsed: unknown;
      try { parsed = JSON.parse(event.body); } catch { return reply(400, 'Invalid JSON.'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return reply(400, 'A single MCP message is required.');
      server = new McpServer({ name: 'known-enough-shared', version: '1.0.0' }, { instructions: 'Read current shared decisions only. Never infer private reasons, grant permissions, or approve for anyone.' });
      const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
      const success = (value: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value });
      const failure = () => ({ isError: true, content: [{ type: 'text' as const, text: 'This shared information could not be read. Check your current access and try again.' }] });
      server.registerTool('list_groups', { description: 'List groups accessible to the signed-in account; returns an opaque cursor for the next page.', annotations,
        inputSchema: z.strictObject({ cursor: z.string().min(1).max(4096).optional() }) }, async ({ cursor }) => {
        try {
          const raw = await read('/groups?limit=5' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')) as { groups?: unknown[]; cursor?: unknown };
          if (!Array.isArray(raw.groups)) throw new Error('Invalid list');
          return success(Alexa.GroupList.parse({ groups: raw.groups.map(group => { const value = Groups.GroupSnapshot.parse(group); return { id: value.id, name: value.name }; }), cursor: raw.cursor ?? null }));
        } catch { return failure(); }
      });
      server.registerTool('list_group_decisions', { description: 'List shared decision titles and IDs in one authorized group.', annotations,
        inputSchema: z.strictObject({ groupId: Alexa.Identifier }) }, async ({ groupId }) => {
        try { const raw = await read(`/groups/${groupId}`) as { group?: unknown }; const group = Groups.GroupSnapshot.parse(raw.group);
          if (group.id !== groupId) throw new Error('Wrong group');
          return success(Alexa.GroupDecisions.parse({ groupId, name: group.name, decisions: group.decisions.map(decision => ({ id: decision.id, title: decision.title ?? 'Untitled decision', current: decision.current })) }));
        } catch { return failure(); }
      });
      for (const name of ['get_decision_progress', 'get_decision_outcome'] as const) server.registerTool(name, {
        description: name === 'get_decision_progress' ? 'Get current public participant answer/approval status for an authorized decision. Never returns private answers.' : 'Get the current shared proposal or agreed outcome with approval status. No private conditions or explanations.',
        annotations, inputSchema: z.strictObject({ decisionId: Alexa.Identifier }),
      }, async ({ decisionId }) => {
        try { const summary = Alexa.sharedDecisionSummary(await read(`/decisions/${decisionId}/public`));
          if (summary.decisionId !== decisionId) throw new Error('Wrong decision');
          return success(name === 'get_decision_progress' ? { ...summary, choices: [] } : summary);
        } catch { return failure(); }
      });
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      await server.connect(transport);
      const result = await transport.handleRequest(new Request(URL.parse('/mcp', allowedOrigin)!, { method: 'POST', headers, body: event.body }));
      status = result.status;
      return { statusCode: status, headers: { ...Object.fromEntries(result.headers), ...cors }, body: await result.text(), isBase64Encoded: false };
    } catch (error) {
      const code = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 503;
      return reply([401, 403, 404].includes(code) ? code : 503, [401, 403].includes(code) ? 'Sign in with an approved account.' : 'The shared assistant is unavailable.');
    } finally {
      await server?.close().catch(() => {});
      // Correlation only; never question text, arguments, tokens, member names or model content.
      console.info(JSON.stringify({ event: 'shared-mcp', requestId, status }));
    }
  };
}
