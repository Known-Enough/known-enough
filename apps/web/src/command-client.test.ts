import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '@deal-table/contracts';
import { browserCommandTransport, confirmInputs, decideDisclosure, decideException, sendCommand, submitInputDraft, type CommandIds, type CommandTransport, UnknownTransportError } from './command-client';
import { ownerMockClient } from './owner-mock-adapter';

const ids: CommandIds = { requestId: () => 'request-test', idempotencyKey: () => 'key-test' };
const context = { decisionRevision: 1 };

describe('owner command client', () => {
  it('builds independent strict v1 commands without a client owner identity', async () => {
    const room = await ownerMockClient.getOwnerRoom();
    const exception = decideException(room, context, room.pendingOffers[0]!, 'ALLOW', ids);
    const disclosure = decideDisclosure(room, context, room.disclosurePreviews[0]!, 'DECLINE', ids);
    const draft = submitInputDraft(room, context, room.confirmedInputs!.values, ids);
    const confirmation = confirmInputs(room, context, { draftId: 'draft-nina-2', draftRevision: 2, values: room.confirmedInputs!.values }, room.availabilityReview!.intervals, ids);
    expect(exception).toMatchObject({ type: 'DECIDE_EXCEPTION', expected: { contextToken: room.contextToken, decisionRevision: 1, controlVersion: room.controlVersion } });
    expect(disclosure).toMatchObject({ type: 'DECIDE_DISCLOSURE', payload: { decision: 'DECLINE' } });
    expect(draft).toMatchObject({ type: 'SUBMIT_INPUT_DRAFT', payload: { expectedOwnerRevision: room.ownerRevision } });
    expect(confirmation).toMatchObject({ type: 'CONFIRM_INPUTS', payload: { draftId: 'draft-nina-2', draftRevision: 2, expectedOwnerRevision: room.ownerRevision, reviewedIntervals: room.availabilityReview!.intervals } });
    expect(JSON.stringify([exception, disclosure, draft, confirmation])).not.toContain('ownerMemberId');
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

  it('keeps the original envelope after malformed JSON or an unrecognized result', async () => {
    const room = await ownerMockClient.getOwnerRoom();
    const command = decideException(room, context, room.pendingOffers[0]!, 'ALLOW', ids);
    const malformed = browserCommandTransport(async () => new Response('{', { headers: { 'content-type': 'application/json' } }) as Response);
    await expect(sendCommand(malformed, command)).rejects.toMatchObject({ command });
    const unknownResult: CommandTransport = { post: async () => ({ upstream: 'unknown' }) };
    await expect(sendCommand(unknownResult, command)).rejects.toMatchObject({ command });
  });

  it('returns a structured client rejection rather than offering an unknown retry', async () => {
    const room = await ownerMockClient.getOwnerRoom();
    const command = decideException(room, context, room.pendingOffers[0]!, 'ALLOW', ids);
    const transport: CommandTransport = { post: async () => ({ ok: false, requestId: command.requestId, error: { code: 'INVALID_COMMAND', httpStatus: 422 } }) };
    await expect(sendCommand(transport, command)).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_COMMAND' } });
  });

  it('keeps the exact envelope when a safe server result says the outcome may be unknown', async () => {
    const room = await ownerMockClient.getOwnerRoom();
    const command = decideException(room, context, room.pendingOffers[0]!, 'ALLOW', ids);
    const transport: CommandTransport = { post: async () => ({
      ok: false, requestId: command.requestId, error: { code: 'RETRYABLE_SERVER_ERROR', httpStatus: 503 },
    }) };
    await expect(sendCommand(transport, command)).rejects.toMatchObject({ command });
  });
});
