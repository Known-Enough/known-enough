import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Groups } from '@deal-table/contracts';
import { KnownEnoughApplicationError, type TrustedPrincipal } from '@deal-table/application';
import { ArchivedGroupRow } from './partition-archive.ts';
import { createPartitionedGroupRepository, checkPartitionRow, partitionAccountKey, partitionGroupKey,
  partitionIO, partitionCall, PartitionStorageError, type PartitionIOContext, type PartitionScope,
  type PartitionTransport, type PartitionFence } from './partitioned-group-repository.ts';

// Inactive participant boundary: trusted identity and managed activation/atomic decision selection are external.
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const remove = z.strictObject({ memberId: id, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
const deny = (code: 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_COMMAND' | 'STALE_CONTEXT'): never => {
  throw new KnownEnoughApplicationError(code);
};
export const partitionMemberId = (subject: string) => `member-${createHash('sha256').update(subject).digest('hex').slice(0, 32)}`;
export class PartitionSessionError extends Error {
  constructor(readonly code: 'SESSION_INVALID' | 'SESSION_STORAGE_UNAVAILABLE' | 'SESSION_TIMEOUT'
    | 'SESSION_REQUEST_LIMIT' | 'SESSION_CAPACITY', options?: ErrorOptions) { super(code, options); this.name = 'PartitionSessionError'; }
}
function participant(principal: TrustedPrincipal | null): string {
  if (principal?.kind !== 'participant' || !id.safeParse(principal.subject).success) return deny('FORBIDDEN');
  return principal.subject;
}
const groupId = (raw: string) => { const parsed = id.safeParse(raw); return parsed.success ? parsed.data : deny('INVALID_COMMAND'); };
async function safe<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof KnownEnoughApplicationError || error instanceof PartitionSessionError) throw error;
    if (error instanceof PartitionStorageError) {
      if (error.code === 'PARTITION_STALE' || error.code === 'PARTITION_CONFLICT') return deny('STALE_CONTEXT');
      const code = error.code === 'PARTITION_TIMEOUT' ? 'SESSION_TIMEOUT'
        : error.code === 'PARTITION_REQUEST_LIMIT' ? 'SESSION_REQUEST_LIMIT'
          : error.code === 'PARTITION_CAPACITY' ? 'SESSION_CAPACITY' : 'SESSION_INVALID';
      throw new PartitionSessionError(code, { cause: error });
    }
    throw new PartitionSessionError('SESSION_STORAGE_UNAVAILABLE', { cause: error });
  }
}
function current(state: Groups.GroupState, who: string, selected: string, organizer = false): Groups.Group {
  if (state.accounts.find(account => account.subject === who)?.status !== 'APPROVED') return deny('FORBIDDEN');
  const group = state.groups.find(group => group.id === selected && group.members.includes(who));
  if (!group) return deny('NOT_FOUND');
  if (organizer && group.organizer !== who) return deny('FORBIDDEN');
  return group;
}
export function createPartitionGroupSession(transport: PartitionTransport,
  options: { now?: () => number; timeoutMs?: number; maxRequests?: number } = {}) {
  const limits = { ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxRequests === undefined ? {} : { maxRequests: options.maxRequests }) };
  partitionIO(limits); const clock = options.now ?? Date.now;
  const repository = createPartitionedGroupRepository(transport, limits);
  function now() { const time = clock(); if (!Number.isSafeInteger(time) || time < 0) throw new PartitionSessionError('SESSION_INVALID'); return time; }
  async function scope(who: string, selected: string, io: PartitionIOContext): Promise<PartitionScope> {
    const keys = [partitionAccountKey(who), partitionGroupKey(selected)];
    const rows = transport.readMany ? await partitionCall(io, () => transport.readMany!(keys, io))
      : [await partitionCall(io, () => transport.read(keys[0]!, io)), await partitionCall(io, () => transport.read(keys[1]!, io))];
    if (!Array.isArray(rows) || rows.length !== 2) throw new PartitionSessionError('SESSION_INVALID');
    const account = rows[0] === null ? null : checkPartitionRow(rows[0], keys[0]!);
    if (account?.kind !== 'ACCOUNT' || account.value.status !== 'APPROVED') return deny('FORBIDDEN');
    if (rows[1] === null) return deny('NOT_FOUND');
    const archived = ArchivedGroupRow.safeParse(rows[1]);
    if (archived.success) {
      if (archived.data.groupId !== selected) throw new PartitionSessionError('SESSION_INVALID');
      return deny('NOT_FOUND');
    }
    const header = checkPartitionRow(rows[1], keys[1]!);
    if (header.kind !== 'GROUP' || new Set(header.value.members).size !== header.value.members.length) throw new PartitionSessionError('SESSION_INVALID');
    if (!header.value.members.includes(who)) return deny('NOT_FOUND');
    return { groupId: selected, accountSubjects: [...header.value.members] };
  }
  async function selected<T>(who: string, selected: string, io: PartitionIOContext,
    work: (resolved: PartitionScope) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const resolved = await scope(who, selected, io);
      try { return await work(resolved); }
      catch (error) { if (!(error instanceof PartitionStorageError) || error.code !== 'PARTITION_STALE') throw error; }
    }
    return deny('STALE_CONTEXT');
  }
  function snapshot(state: Groups.GroupState, group: Groups.Group, who: string) {
    const time = now();
    return Groups.GroupSnapshot.parse({ id: group.id, name: group.name, version: group.version, isOrganizer: group.organizer === who,
      members: group.members.map(subject => ({ id: partitionMemberId(subject),
        displayName: state.accounts.find(account => account.subject === subject)!.displayName, isOrganizer: subject === group.organizer })),
      drafts: group.drafts.map(draft => ({ id: draft.id, title: draft.frame.title, needsClarification: !!draft.clarificationQuestions.length,
        current: draft.groupVersion === group.version, created: !!draft.createdDecisionId })),
      pendingInvitations: group.invitations.filter(invitation => !invitation.acceptedBy && invitation.expiresAt > time).length,
      decisions: group.decisions.map(binding => ({ id: binding.id, current: binding.version === group.version })) });
  }
  return {
    status(principal: TrustedPrincipal | null) {
      return safe(async () => {
        const who = participant(principal); const io = partitionIO(limits);
        return repository.transaction({ accountSubjects: [who] }, state => {
          const account = state.accounts.find(account => account.subject === who);
          return account ? Groups.AccountSnapshot.parse({ status: account.status, displayName: account.displayName, version: account.version }) : null;
        }, io);
      });
    },
    snapshot(principal: TrustedPrincipal | null, rawId: string) {
      return safe(async () => {
        const who = participant(principal); const key = groupId(rawId); const io = partitionIO(limits);
        return selected(who, key, io, resolved => repository.transaction(resolved,
          state => snapshot(state, current(state, who, key), who), io));
      });
    },
    /** Private organizer roster for decision construction; never a public HTTP snapshot. */
    roster(principal: TrustedPrincipal | null, rawId: string) {
      return safe(async () => {
        const who = participant(principal); const key = groupId(rawId); const io = partitionIO(limits);
        return selected(who, key, io, resolved => repository.transaction(resolved, state => {
          const group = current(state, who, key, true);
          return { version: group.version, members: group.members.map(subject => {
            const account = state.accounts.find(account => account.subject === subject);
            if (account?.status !== 'APPROVED') return deny('FORBIDDEN');
            return { subject, participantId: partitionMemberId(subject), displayName: account.displayName };
          }) };
        }, io));
      });
    },
    remove(principal: TrustedPrincipal | null, rawId: string, raw: unknown) {
      return safe(async () => {
        const who = participant(principal); const key = groupId(rawId); const request = remove.safeParse(raw);
        if (!request.success) return deny('INVALID_COMMAND');
        const io = partitionIO(limits);
        return selected(who, key, io, resolved => repository.transaction(resolved, state => {
          const group = current(state, who, key, true);
          if (group.version !== request.data.version) return deny('STALE_CONTEXT');
          const target = group.members.find(subject => partitionMemberId(subject) === request.data.memberId);
          if (!target || target === who) return deny('INVALID_COMMAND');
          if (group.version >= Number.MAX_SAFE_INTEGER) throw new PartitionSessionError('SESSION_CAPACITY');
          group.members = group.members.filter(subject => subject !== target); group.version++;
          return snapshot(state, group, who);
        }, io));
      });
    },
    /** Conditions MUST join the actual decision transaction; assertCurrent alone cannot authorize a write. */
    decisionFence(principal: TrustedPrincipal | null, rawDecisionId: string): Promise<PartitionFence> {
      return safe(async () => {
        const who = participant(principal); const decisionId = groupId(rawDecisionId); const io = partitionIO(limits);
        const directory = await repository.lookup({ type: 'DECISION', decisionId }, io);
        if (directory?.type !== 'DECISION') return deny('NOT_FOUND');
        const fence = await selected(who, directory.groupId, io, resolved => repository.fence(resolved, state => {
          const group = current(state, who, directory.groupId);
          const binding = group.decisions.find(binding => binding.id === decisionId);
          if (!binding) return deny('NOT_FOUND');
          if (binding.version !== group.version) return deny('STALE_CONTEXT');
        }, io));
        return { mutations: structuredClone(fence.mutations), assertCurrent: () => safe(() => fence.assertCurrent()) };
      });
    },
  };
}
