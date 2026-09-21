import { CommandEnvelope, CommandResult, type CommandEnvelope as CommandEnvelopeType, type CommandResult as CommandResultType, type DisclosurePreview, type ExceptionOffer, type FinalApproval, type InputValues, type OwnerSnapshot, type ProposalView } from '@deal-table/contracts';

export interface CommandTransport {
  post(path: string, body: CommandEnvelopeType): Promise<unknown>;
}

export interface CommandIds {
  requestId(): string;
  idempotencyKey(): string;
}

export interface OwnerCommandContext {
  decisionRevision: number;
}

export class UnknownTransportError extends Error {
  constructor(readonly command: CommandEnvelopeType) {
    super('The command result is unknown.');
  }
}

export function browserCommandTransport(fetcher: typeof fetch = fetch): CommandTransport {
  return {
    async post(path, body) {
      let response: Response;
      try {
        response = await fetcher(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      } catch {
        throw new UnknownTransportError(body);
      }
      try {
        return await response.json();
      } catch {
        throw new UnknownTransportError(body);
      }
    },
  };
}

function randomId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

export const browserCommandIds: CommandIds = {
  requestId: () => randomId('request'),
  idempotencyKey: () => randomId('key'),
};

function envelope(room: OwnerSnapshot, context: OwnerCommandContext, ids: CommandIds, type: CommandEnvelopeType['type'], payload: unknown): CommandEnvelopeType {
  return CommandEnvelope.parse({
    schemaVersion: 1,
    roomId: room.roomId,
    requestId: ids.requestId(),
    idempotencyKey: ids.idempotencyKey(),
    expected: { contextToken: room.contextToken, decisionRevision: context.decisionRevision, controlVersion: room.controlVersion },
    type,
    payload,
  });
}

export function submitInputDraft(room: OwnerSnapshot, context: OwnerCommandContext, values: InputValues, ids = browserCommandIds): CommandEnvelopeType {
  return envelope(room, context, ids, 'SUBMIT_INPUT_DRAFT', { expectedOwnerRevision: room.ownerRevision, values });
}

export function decideException(room: OwnerSnapshot, context: OwnerCommandContext, offer: ExceptionOffer, decision: 'ALLOW' | 'DECLINE', ids = browserCommandIds): CommandEnvelopeType {
  return envelope(room, context, ids, 'DECIDE_EXCEPTION', { offerId: offer.id, offerVersion: offer.version, decision, scope: offer.scope });
}

export function decideDisclosure(room: OwnerSnapshot, context: OwnerCommandContext, preview: DisclosurePreview, decision: 'ALLOW' | 'DECLINE', ids = browserCommandIds): CommandEnvelopeType {
  return envelope(room, context, ids, 'DECIDE_DISCLOSURE', { preview, decision });
}

export function acceptProposal(room: OwnerSnapshot, context: OwnerCommandContext, proposal: ProposalView | FinalApproval, ids = browserCommandIds): CommandEnvelopeType {
  const target = 'facts' in proposal
    ? { proposalId: proposal.id, proposalVersion: proposal.facts.proposalVersion, planHash: proposal.planHash }
    : { proposalId: proposal.proposalId, proposalVersion: proposal.proposalVersion, planHash: proposal.planHash };
  return envelope(room, context, ids, 'ACCEPT_PROPOSAL', target);
}

export function withdrawApproval(room: OwnerSnapshot, context: OwnerCommandContext, approval: FinalApproval, ids = browserCommandIds): CommandEnvelopeType {
  return envelope(room, context, ids, 'WITHDRAW_APPROVAL', { proposalId: approval.proposalId, proposalVersion: approval.proposalVersion, planHash: approval.planHash });
}

export async function sendCommand(transport: CommandTransport, command: CommandEnvelopeType): Promise<CommandResultType> {
  const result = await transport.post(`/rooms/${encodeURIComponent(command.roomId)}/commands`, command);
  return CommandResult.parse(result);
}
