import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
// @ts-expect-error Operational JS tested offline.
import { cumulativeLimits, reserveTotal, emptyTotals, authorizationTransaction } from '../../scripts/live-qa/cumulative.mjs';
// @ts-expect-error Operational JS tested offline.
import { standingAuthorization } from '../../scripts/live-qa/config.mjs';
// @ts-expect-error Operational JS tested offline.
import { beginLease } from '../../scripts/live-qa/fixture-core.mjs';
import { budgetedTransport } from '../../scripts/live-qa/budget.mjs';
const now = Date.parse('2026-10-02T03:16:41Z');
const a = { ...Object.fromEntries(Object.entries(JSON.parse(readFileSync('infra/live-qa/config.example.json', 'utf8')).authorization).filter(([key]) => !key.endsWith('Total'))),
  approved: true, expiresAt: '2026-10-09T03:16:41Z', maxRunsPerDay: 4, maxAttemptsPerRun: 200,
  maxTokensPerRun: 250000, maxCostMicrosPerRun: 250000, attemptCostMicros: 1,
  maxSignupMessagesPerRun: 2, maxSignupMessagesPerDay: 8, retentionReviewed: true, invocationLoggingDisabled: true };
const item = (value: unknown, version = '1') => ({ payload: { S: JSON.stringify(value) }, version: { N: version } });
test('legacy envelope is limited to 28 runs, 7 million reserved tokens/micros and 56 messages without changing its expiry', () => {
  const saved = JSON.stringify(a); expect(cumulativeLimits(a)).toEqual({ runs: 28, reservedTokens: 7000000, reservedCostMicros: 7000000, messages: 56 });
  expect(JSON.stringify(a)).toBe(saved);
});
test('eight UTC dates cannot allow a 29th run, even with room left in a daily budget', () => {
  let total = emptyTotals();
  for (let run = 0; run < 28; run++) total = reserveTotal(total, a, { runs: 1 });
  expect(() => reserveTotal(total, a, { runs: 1 })).toThrow('CUMULATIVE_BUDGET_EXHAUSTED');
});
test.each(['reservedTokens', 'reservedCostMicros', 'messages'])('%s total is enforced independently of daily/per-run allowances', field => {
  const limits = cumulativeLimits(a); const total = { ...emptyTotals(), [field]: limits[field] };
  expect(() => reserveTotal(total, a, { [field]: 1 })).toThrow('CUMULATIVE_BUDGET_EXHAUSTED');
});
test('explicit tighter total caps are configurable and malformed or missing counters fail closed', () => {
  const explicit = { ...a, maxRunsTotal: 2, maxTokensTotal: 1000, maxCostMicrosTotal: 1000, maxSignupMessagesTotal: 2 };
  expect(cumulativeLimits(explicit).runs).toBe(2);
  expect(() => reserveTotal({ ...emptyTotals(), runs: 2 }, explicit, { runs: 1 })).toThrow();
  for (const total of [null, {}, { ...emptyTotals(), runs: -1 }, { ...emptyTotals(), messages: NaN }, { ...emptyTotals(), extra: 1 }])
    expect(() => reserveTotal(total, a, { runs: 1 })).toThrow();
  expect(() => cumulativeLimits({ ...a, maxRunsTotal: 2 })).toThrow('INVALID_AUTHORIZATION');
  expect(() => reserveTotal(emptyTotals(), a, { messages: -1 })).toThrow();
});
test('same active run resumes without a new lease; a clean run cannot be resurrected without charging', () => {
  const lease = beginLease(null, 'run-12345', a, now);
  expect(beginLease(lease, 'run-12345', a, now)).toEqual(lease);
  expect(() => beginLease({ ...lease, status: 'CLEAN' }, 'run-12345', a, now)).toThrow('RUN_ID_ALREADY_USED');
  expect(() => beginLease(null, 'run-67890', a, Date.parse(a.expiresAt))).toThrow('EXPIRED');
});
test('installer initializes only unused history and preserves counters/auth expiry through reinstallation', () => {
  const total = item({ ...emptyTotals(), runs: 19, messages: 38 });
  const lease = item({ id: 'run-12345', status: 'CLEAN' });
  const transaction = authorizationTransaction('control', item(a), lease, total, a);
  expect(transaction.TransactItems).toHaveLength(3);
  expect(JSON.stringify(transaction)).toContain('TOTAL');
  expect(transaction.TransactItems.some((entry: { Put?: { Item: { PK: { S: string } } } }) => entry.Put?.Item.PK.S === 'TOTAL')).toBe(false);
  expect(transaction.TransactItems[1].Put.Item.payload.S).toBe(JSON.stringify(a));
  expect(() => authorizationTransaction('control', item(a), lease, undefined, a)).toThrow('MIGRATION_REQUIRES_RECONCILIATION');
  expect(() => authorizationTransaction('control', item(a), item({ status: 'ACTIVE' }), total, a)).toThrow('ACTIVE_LEASE');
  const fresh = authorizationTransaction('control', undefined, undefined, undefined, a);
  expect(fresh.TransactItems[2].Put.Item.payload.S).toBe(JSON.stringify(emptyTotals()));
  expect(fresh.TransactItems[2].Put.ConditionExpression).toBe('attribute_not_exists(PK)');
});
interface Cell { payload: { S: string }; version: { N: string } }
interface Operation { Update?: { Key: { PK: { S: string } }; ExpressionAttributeValues: Record<string, { S?: string; N?: string }> }; ConditionCheck?: { Key: { PK: { S: string } }; ExpressionAttributeValues: Record<string, { N: string }> } }
function modelStore(total = emptyTotals()) {
  const cells: Record<string, Cell> = { AUTH: item(a), LEASE: item(beginLease(null, 'run-12345', a, now)), TOTAL: item(total) };
  const transactions: Operation[][] = [];
  const db = { send: async (command: GetItemCommand & { input: { TransactItems?: Operation[] } }) => {
    if (command.input.Key) return { Item: structuredClone(cells[command.input.Key.PK!.S!]) };
    const items = command.input.TransactItems!; transactions.push(items);
    for (const entry of items) { const op = entry.Update ?? entry.ConditionCheck!;
      if (cells[op.Key.PK.S]!.version.N !== op.ExpressionAttributeValues[':v']!.N) throw new Error('CAS_LOST'); }
    for (const entry of items) if (entry.Update) { const op = entry.Update;
      cells[op.Key.PK.S] = { payload: { S: op.ExpressionAttributeValues[':p']!.S! }, version: { N: op.ExpressionAttributeValues[':n']!.N! } }; }
    return {};
  } } as unknown as DynamoDBClient;
  const sent: unknown[] = [];
  const transport = budgetedTransport({ send: async (command: unknown) => { sent.push(command); return {output:{message:{role:'assistant',content:[{text:'synthetic'}]}},stopReason:'end_turn',usage:{inputTokens:0,outputTokens:0,totalTokens:0},metrics:{latencyMs:0},$metadata:{}}; } }, db, 'control', () => now);
  const invoke = () => transport.send(new ConverseCommand({ modelId: 'amazon.nova-lite-v1:0', messages: [], inferenceConfig: { maxTokens: 100 } }), { abortSignal: new AbortController().signal });
  return { cells, sent, transactions, invoke };
}
test('concurrent model reservations have one winner and cannot overspend or send before CAS', async () => {
  const h = modelStore(); const result = await Promise.allSettled([h.invoke(), h.invoke()]);
  expect(result.filter(value => value.status === 'fulfilled')).toHaveLength(1); expect(h.sent).toHaveLength(1);
  const lease = JSON.parse(h.cells.LEASE!.payload.S); const total = JSON.parse(h.cells.TOTAL!.payload.S);
  expect(total.reservedTokens).toBe(lease.reservedTokens); expect(total.reservedCostMicros).toBe(lease.reservedCostMicros);
  expect(h.transactions[0]!.map(op => (op.Update ?? op.ConditionCheck!)?.Key.PK.S)).toEqual(['AUTH', 'LEASE', 'TOTAL']);
});
test('total exhaustion prevents model transport even with an unused per-run allowance', async () => {
  const h = modelStore({ ...emptyTotals(), reservedCostMicros: 7000000 });
  await expect(h.invoke()).rejects.toThrow('CUMULATIVE_BUDGET_EXHAUSTED'); expect(h.sent).toHaveLength(0); expect(h.transactions).toHaveLength(0);
});

// @ts-expect-error The broker owns an isolated pinned SDK instance.
import { DynamoDBClient as BrokerDb } from '../../scripts/live-qa/node_modules/@aws-sdk/client-dynamodb/dist-cjs/index.js';
// @ts-expect-error The broker owns an isolated pinned SDK instance.
import { SecretsManagerClient as BrokerSecrets } from '../../scripts/live-qa/node_modules/@aws-sdk/client-secrets-manager/dist-cjs/index.js';
// @ts-expect-error Real broker boundaries exercised with synthetic injected responses.
import { handler, customMessage } from '../../scripts/live-qa/broker.mjs';
import { afterEach, vi } from 'vitest';
const noNetwork = vi.hoisted(() => vi.fn(async () => { throw new Error('NO_PROVIDER_REQUEST_ALLOWED'); }));
vi.mock('../../scripts/live-qa/mailtm.mjs', () => ({ createMailtmClient: () => ({ intent: noNetwork }) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); noNetwork.mockClear(); });
function brokerStore(total: unknown, lease = { ...beginLease(null, 'run-12345', a, now), initialized: true, users: [{ actor: 'signup', email: 'synthetic@example.invalid' }] }) {
  vi.spyOn(BrokerSecrets.prototype, 'send').mockResolvedValue({SecretString:'{}'});
  vi.stubEnv('QA_MAIL_PROVIDER', 'mailtm'); vi.stubEnv('QA_CONTROL_TABLE', 'control'); vi.spyOn(Date, 'now').mockReturnValue(now);
  const cells: Record<string, Cell> = { AUTH: item(a), LEASE: item(lease), TOTAL: item(total) };
  const transactions: unknown[] = [];
  const send = vi.spyOn(BrokerDb.prototype, 'send').mockImplementation(async (...args: unknown[]) => {
    const command = args[0] as { input: { Key?: { PK: { S: string } }; TransactItems?: { Put?: { Item: Cell & { PK: { S: string } }; ExpressionAttributeValues?: Record<string, { N: string }> }; ConditionCheck?: { Key: { PK: { S: string } }; ExpressionAttributeValues: Record<string, { N: string }> } }[] } };
    if (command.input.Key) return { Item: structuredClone(cells[command.input.Key.PK.S]) };
    const items = command.input.TransactItems!; transactions.push(items);
    for (const entry of items) {
      const id = entry.Put?.Item.PK.S ?? entry.ConditionCheck!.Key.PK.S;
      const expected = entry.Put?.ExpressionAttributeValues?.[':v']?.N ?? entry.ConditionCheck?.ExpressionAttributeValues[':v']?.N;
      if (expected && cells[id]!.version.N !== expected) throw new Error('CAS_LOST');
    }
    for (const entry of items) if (entry.Put) cells[entry.Put.Item.PK.S] = entry.Put.Item;
    return {};
  });
  return { cells, transactions, send };
}
test('broker refuses a new run when total is exhausted, before mailbox or identity creation', async () => {
  const h = brokerStore({ ...emptyTotals(), runs: 28 }, { ...beginLease(null, 'previous-run', a, now), status: 'CLEAN' });
  expect((await handler({ action: 'start', runId: 'run-12345' })).status).toBe('BLOCKED');
  expect(h.transactions).toHaveLength(0); expect(noNetwork).not.toHaveBeenCalled();
  expect(h.send.mock.calls.some((args: unknown[]) => (args[0] as { input: { Key?: { PK: { S: string } } } }).input.Key?.PK.S === 'TOTAL')).toBe(true);
});
test('broker active-run retry is idempotent even when total run allowance is exhausted', async () => {
  const h = brokerStore({ ...emptyTotals(), runs: 28 });
  expect((await handler({ action: 'start', runId: 'run-12345' })).status).toBe('PASS');
  expect(h.transactions).toHaveLength(0); expect(noNetwork).not.toHaveBeenCalled();
});
const signup = () => ({ triggerSource: 'CustomMessage_SignUp', userName: 'qa-run-12345-signup', request: { userAttributes: { email: 'synthetic@example.invalid' } }, response: {} });
test('message cumulative exhaustion blocks real trigger despite spare daily/per-run budget', async () => {
  const h = brokerStore({ ...emptyTotals(), messages: 56 });
  await expect(customMessage(signup())).rejects.toThrow('CUMULATIVE_BUDGET_EXHAUSTED'); expect(h.transactions).toHaveLength(0);
});
test('concurrent message reservations atomically charge lease/day/total with only one winner', async () => {
  const h = brokerStore(emptyTotals()); const results = await Promise.allSettled([customMessage(signup()), customMessage(signup())]);
  expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
  expect(JSON.parse(h.cells.TOTAL!.payload.S).messages).toBe(1); expect(JSON.parse(h.cells.LEASE!.payload.S).signupMessages).toBe(1);
  const day = Object.keys(h.cells).find(key => key.startsWith('DAY#'))!; expect(JSON.parse(h.cells[day]!.payload.S).messages).toBe(1);
});

test('failed fresh-run provisioning still charges once and retry cannot reset counters', async () => {
  const h = brokerStore(emptyTotals(), { ...beginLease(null, 'previous-run', a, now), status: 'CLEAN' });
  expect((await handler({ action: 'start', runId: 'run-12345' })).status).toBe('BLOCKED');
  expect(JSON.parse(h.cells.TOTAL!.payload.S).runs).toBe(1); expect(JSON.parse(h.cells.LEASE!.payload.S).id).toBe('run-12345');
  expect((await handler({ action: 'start', runId: 'run-12345' })).status).toBe('BLOCKED');
  expect(JSON.parse(h.cells.TOTAL!.payload.S).runs).toBe(1); expect(h.transactions).toHaveLength(1);
  const day = Object.keys(h.cells).find(key => key.startsWith('DAY#'))!; expect(JSON.parse(h.cells[day]!.payload.S).runs).toBe(1);
});

const standingRun = { id: 12345, run_attempt: 1, actor: { login: 'Battosai1806', id: 143764700 },
  triggering_actor: { login: 'Battosai1806', id: 143764700 }, repository: { id: 1377587215 }, head_repository: { id: 1377587215 },
  head_branch: 'main', event: 'workflow_run', status: 'in_progress', path: '.github/workflows/live-qa-release-and-check.yml', head_sha: 'a'.repeat(40) };
test('real broker migrates expired authority conditionally and preserves exhausted usage, day and receipt history', async () => {
  const prior = { runs: 28, reservedTokens: 7000000, reservedCostMicros: 7000000, messages: 56 };
  const h = brokerStore(prior, { ...beginLease(null, 'previous-run', a, now), status: 'CLEAN' });
  h.cells.AUTH = item({ ...a, expiresAt: new Date(now - 1).toISOString() });
  h.cells['DAY#historical'] = item({ runs: 4, messages: 8 }); h.cells['GITHUB-EXTRA#historical'] = item({ usedRuns: 2 });
  const saved = structuredClone(h.cells);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(standingRun), { status: 200 }));
  expect(await handler({ action: 'migrate-standing', runId: 'gh-12345-1' })).toEqual({ status: 'PASS', authorizationMode: 'standing', usagePreserved: true });
  expect(JSON.parse(h.cells.AUTH!.payload.S).mode).toBe('standing'); expect(h.cells.AUTH!.version.N).toBe('2');
  for (const id of ['TOTAL', 'LEASE', 'DAY#historical', 'GITHUB-EXTRA#historical']) expect(h.cells[id]).toEqual(saved[id]);
});
test('broker migration rejects non-CLEAN lease, missing totals, revoked authority and forged workflow identity before writes', async () => {
  for (const change of ['lease', 'total', 'revoked', 'actor']) {
    const h = brokerStore(emptyTotals());
    if (change !== 'lease') h.cells.LEASE = item({ status: 'CLEAN' });
    if (change === 'total') delete h.cells.TOTAL;
    if (change === 'revoked') h.cells.AUTH = item({ ...a, approved: false });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(change === 'actor' ? { ...standingRun, actor: { login: 'unverified', id: 1 } } : standingRun), { status: 200 }));
    expect((await handler({ action: 'migrate-standing', runId: 'gh-12345-1' })).status).toBe('BLOCKED');
    expect(h.transactions).toHaveLength(0);
    vi.restoreAllMocks();
  }
});
test('real standing message transaction crosses historical daily and cumulative ceilings but still enforces per-run count', async () => {
  const h = brokerStore({ ...emptyTotals(), messages: 56 }); h.cells.AUTH = item(standingAuthorization(a));
  const day = 'DAY#' + new Date().toISOString().slice(0, 10); h.cells[day] = item({ runs: 28, messages: 8 });
  await customMessage(signup()); await customMessage(signup());
  await expect(customMessage(signup())).rejects.toThrow('QA_MESSAGE_BUDGET');
  expect(JSON.parse(h.cells.TOTAL!.payload.S).messages).toBe(58); expect(JSON.parse(h.cells[day]!.payload.S).messages).toBe(10);
});
test('standing model transport preserves atomic cumulative usage beyond old ceilings before a provider request', async () => {
  const h = modelStore({ ...emptyTotals(), reservedCostMicros: 7000000 });
  h.cells.AUTH = item(standingAuthorization(a));
  await h.invoke();
  expect(h.sent).toHaveLength(1); expect(JSON.parse(h.cells.TOTAL!.payload.S).reservedCostMicros).toBeGreaterThan(7000000);
});
