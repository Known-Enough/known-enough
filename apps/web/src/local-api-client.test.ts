import { describe, expect, it } from 'vitest';
import { LocalApiClient } from './local-api-client';
import { commandTransport, sendCommand, submitInputDraft, UnknownTransportError } from './command-client';
import { ownerMockClient } from './owner-mock-adapter';

describe('local mutation outcomes', () => {
  for (const failure of ['network', 'json', 'schema']) it(`retains the exact envelope after an unknown ${failure} outcome`, async () => {
    const room = (await ownerMockClient.readOwnerRoom('draft')).value!;
    const command = submitInputDraft(room, { decisionRevision: 4 }, room.draft!.values);
    const sent: string[] = [];
    const client = new LocalApiClient('maya', undefined, async (_url, init) => {
      sent.push(String(init?.body));
      if (failure === 'network') throw new TypeError('fetch failed');
      return new Response(failure === 'json' ? '{' : '{}');
    });
    const transport = commandTransport((_path, body) => client.command(body));
    let saved: UnknownTransportError | undefined;
    try { await sendCommand(transport, command); } catch (error) {
      expect(error).toBeInstanceOf(UnknownTransportError);
      saved = error as UnknownTransportError;
    }
    expect(saved?.command).toBe(command);
    await expect(sendCommand(transport, saved!.command)).rejects.toBeInstanceOf(UnknownTransportError);
    expect(sent).toEqual([JSON.stringify(command), JSON.stringify(command)]);
  });

  it('keeps a structured rejection distinct from an unknown outcome', async () => {
    const room = (await ownerMockClient.readOwnerRoom('draft')).value!;
    const command = submitInputDraft(room, { decisionRevision: 4 }, room.draft!.values);
    const result = { ok: false, requestId: command.requestId, error: { code: 'STALE_CONTEXT', httpStatus: 409 } };
    const client = new LocalApiClient('maya', undefined, async () => new Response(JSON.stringify(result), { status: 409 }));
    await expect(client.command(command)).resolves.toEqual(result);
  });
});
