import { CommandResult, OwnerSnapshot, PublicRoomSnapshot, type CommandEnvelope, type CommandResult as CommandResultType, type OwnerSnapshot as OwnerSnapshotType, type PublicRoomSnapshot as PublicRoomSnapshotType } from '@deal-table/contracts';

export const LOCAL_API_ORIGIN = 'http://127.0.0.1:8787';

export type LocalIdentity = 'maya' | 'leo' | 'nina' | 'display';

function identityHeader(identity: LocalIdentity): HeadersInit {
  return { 'X-Deal-Table-Test-Identity': `NON_PRODUCTION ${identity}` };
}

async function json(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { throw new Error('Local API returned invalid JSON'); }
}

export class LocalApiClient {
  constructor(readonly identity: LocalIdentity, readonly origin = LOCAL_API_ORIGIN, readonly fetcher: typeof fetch = fetch) {}

  async publicRoom(roomId = 'room-synthetic'): Promise<PublicRoomSnapshotType> {
    const response = await this.fetcher.call(globalThis, `${this.origin}/rooms/${encodeURIComponent(roomId)}/public`, { headers: identityHeader(this.identity) });
    return PublicRoomSnapshot.parse(await json(response));
  }

  async ownerRoom(roomId = 'room-synthetic'): Promise<OwnerSnapshotType> {
    const response = await this.fetcher.call(globalThis, `${this.origin}/rooms/${encodeURIComponent(roomId)}/me`, { headers: identityHeader(this.identity) });
    return OwnerSnapshot.parse(await json(response));
  }

  async command(command: CommandEnvelope): Promise<CommandResultType> {
    let response: Response;
    try {
      response = await this.fetcher.call(globalThis, `${this.origin}/rooms/${encodeURIComponent(command.roomId)}/commands`, {
        method: 'POST', headers: { ...identityHeader(this.identity), 'content-type': 'application/json', 'x-request-id': command.requestId }, body: JSON.stringify(command),
      });
    } catch { throw new Error('Local API request did not complete'); }
    return CommandResult.parse(await json(response));
  }
}
