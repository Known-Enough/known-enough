import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '@deal-table/contracts';
import { decideDisclosure, decideException, sendCommand, submitInputDraft, type CommandIds, type CommandTransport, UnknownTransportError } from './command-client';
import { ownerMockClient } from './owner-mock-adapter';

const ids: CommandIds = { requestId: () => 'request-test', idempotencyKey: () => 'key-test' };
const context = { decisionRevision: 1 };

describe('owner command client', () => {
  it('builds independent strict v1 commands without a client owner identity', async () => {
    const room = await ownerMockClient.getOwnerRoom();
    const exception = decideException(room, context, room.pendingOffers[0]!, 'ALLOW', ids);
    const disclosure = decideDisclosure(room, context, room.disclosurePreviews[0]!, 'DECLINE', ids);
    const draft = submitInputDraft(room, context, room.confirmedInputs!.values, ids);
    expect(exception).toMatchObject({ type: 'DECIDE_EXCEPTION', expected: { contextToken: room.contextToken, decisionRevision: 1, controlVersion: room.controlVersion } });
    expect(disclosure).toMatchObject({ type: 'DECIDE_DISCLOSURE', payload: { decision: 'DECLINE' } });
    expect(draft).toMatchObject({ type: 'SUBMIT_INPUT_DRAFT', payload: { expectedOwnerRevision: room.ownerRevision } });
    expect(JSON.stringify([exception, disclosure, draft])).not.toContain('ownerMemberId');
  });

  it('keeps the exact payload and idempotency key when a transport result is unknown', async () => {
    const room = await ownerMockClient.getOwnerRoom();
    const command = decideException(room, context, room.pendingOffers[0]!, 'ALLOW', ids);
    const transport: CommandTransport = { post: async () => { throw new UnknownTransportError(command); } };
    await expect(sendCommand(transport, command)).rejects.toMatchObject({ command });
    expect(command.idempotencyKey).toBe('key-test');
  });

  it('validates intercepted transport results before returning them', async () => {
    const room = await ownerMockClient.getOwnerRoom();
    const command = decideException(room, context, room.pendingOffers[0]!, 'ALLOW', ids);
    let captured: CommandEnvelope | undefined;
    const transport: CommandTransport = { post: async (_path, body) => {
      captured = body;
      return { ok: true, requestId: body.requestId, status: 'APPLIED', version: body.expected };
    } };
    await expect(sendCommand(transport, command)).resolves.toMatchObject({ ok: true, requestId: 'request-test' });
    expect(captured).toEqual(command);
  });
});
