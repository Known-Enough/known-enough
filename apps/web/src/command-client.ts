import { CommandEnvelope, CommandResult, type CommandEnvelope as CommandEnvelopeType, type CommandResult as CommandResultType, type DisclosurePreview, type ExceptionOffer, type FinalApproval, type InputValues, type Interval, type OwnerSnapshot, type ProposalView } from '@deal-table/contracts';

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

export function commandTransport(post: CommandTransport['post']): CommandTransport { return { post }; }

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

export function acceptContext(room: OwnerSnapshot, context: OwnerCommandContext, policy: 'LOWEST_INCONVENIENCE' | 'BALANCE_RECENT_LOAD', ids = browserCommandIds): CommandEnvelopeType {
  return envelope(room, context, ids, 'ACCEPT_CONTEXT', { policy });
}

export function requestSolve(room: OwnerSnapshot, context: OwnerCommandContext, ids = browserCommandIds): CommandEnvelopeType {
  return envelope(room, context, ids, 'REQUEST_SOLVE', {});
}

export function confirmInputs(room: OwnerSnapshot, context: OwnerCommandContext, draft: NonNullable<OwnerSnapshot['draft']>, reviewedIntervals: Interval[], ids = browserCommandIds): CommandEnvelopeType {
  return envelope(room, context, ids, 'CONFIRM_INPUTS', {
    draftId: draft.draftId,
    draftRevision: draft.draftRevision,
    expectedOwnerRevision: room.ownerRevision,
    reviewedIntervals,
  });
}

export function decideException(room: OwnerSnapshot, context: OwnerCommandContext, offer: ExceptionOffer, decision: 'ALLOW' | 'DECLINE', ids = browserCommandIds): CommandEnvelopeType {
  return envelope(room, context, ids, 'DECIDE_EXCEPTION', { offerId: offer.id, offerVersion: offer.version, decision, scope: offer.scope });
}

export function decideDisclosure(room: OwnerSnapshot, context: OwnerCommandContext, preview: DisclosurePreview, decision: 'ALLOW' | 'DECLINE', ids = browserCommandIds): CommandEnvelopeType {
  return envelope(room, context, ids, 'DECIDE_DISCLOSURE', { preview, decision });
}

export function acceptProposal(room: OwnerSnapshot, context: OwnerCommandContext, proposal: ProposalView, ids = browserCommandIds): CommandEnvelopeType {
  return envelope(room, context, ids, 'ACCEPT_PROPOSAL', {
    proposalId: proposal.id,
    proposalVersion: proposal.facts.proposalVersion,
    planHash: proposal.planHash,
  });
}

export function withdrawApproval(room: OwnerSnapshot, context: OwnerCommandContext, approval: FinalApproval, ids = browserCommandIds): CommandEnvelopeType {
  return envelope(room, context, ids, 'WITHDRAW_APPROVAL', { proposalId: approval.proposalId, proposalVersion: approval.proposalVersion, planHash: approval.planHash });
}

export async function sendCommand(transport: CommandTransport, command: CommandEnvelopeType): Promise<CommandResultType> {
  const result = await transport.post(`/rooms/${encodeURIComponent(command.roomId)}/commands`, command);
  try {
    return CommandResult.parse(result);
  } catch {
    // A response outside the command-result contract may have followed dispatch.
    // Keep the exact serialized envelope available for an explicit retry.
    throw new UnknownTransportError(command);
  }
}
