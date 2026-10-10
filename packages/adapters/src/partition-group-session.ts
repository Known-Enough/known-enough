import { createHash, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { KnownEnoughApplicationError, type TrustedPrincipal, type DecisionArchitectRequest } from '@deal-table/application';
import { ArchivedGroupRow } from './partition-archive.ts';
import { PartitionMembershipError } from './partition-membership.ts';
import { genericCandidateCatalog } from './generic-candidates.ts';
import { createPartitionedGroupRepository, checkPartitionRow, partitionAccountKey, partitionGroupKey,
  partitionIO, partitionCall, PartitionStorageError, type PartitionIOContext, type PartitionScope,
  type PartitionTransport, type PartitionFence } from './partitioned-group-repository.ts';

// Inactive participant boundary: trusted identity and managed activation/atomic decision selection are external.
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const remove = z.strictObject({ memberId: id, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
const label = z.string().max(160).refine(value => [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127))
  .transform(value => value.trim()).pipe(z.string().min(1).max(80));
const email = z.string().max(512).transform(value => value.trim().toLowerCase()).pipe(z.string().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/));
const create = z.strictObject({ name: label, idempotencyKey: id });
const registration = z.strictObject({ displayName: label });
const profile = z.strictObject({ subject: id, email, verified: z.literal(true) });
const invite = z.strictObject({ email, replace: z.boolean() });
const accept = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{32,80}$/) });
const draftGeneration = z.strictObject({ objective: z.string().max(2000).trim().min(1), idempotencyKey: id });
const draftCreation = z.strictObject({ revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
const architectureOutput = z.strictObject({ draftId: id, revision: z.literal(1), status: z.enum(['DEFINING', 'NEEDS_CLARIFICATION']),
  frame: KE.PublicDecisionFrame, clarificationQuestions: Groups.GroupDraft.shape.clarificationQuestions,
  participantInformationRequirements: z.array(z.strictObject({ participantId: id, prompt: z.string().min(1).max(500) })).max(64) });
const draftEdit = z.strictObject({ revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  title: KE.PublicDecisionFrame.shape.title, objective: KE.PublicDecisionFrame.shape.objective,
  variables: KE.PublicDecisionFrame.shape.variables, rules: KE.PublicDecisionFrame.shape.rules });
const cursor = z.string().regex(/^[A-Za-z0-9_-]{40,1600}$/);
const listing = z.strictObject({ limit: z.number().int().min(1).max(20).default(10), cursor: cursor.optional() });
const discoveryPage = z.strictObject({ groups: z.array(Groups.GroupSnapshot.pick({ id: true, name: true, version: true, isOrganizer: true })).max(20),
  cursor: cursor.nullable() });
/** Trusted discovery only; returned summaries never authorize a group or supply its public fields. */
export type PartitionGroupDiscovery = (request: { subject: string; limit: number; cursor?: string }, context: PartitionIOContext) => Promise<unknown>;
/** Captured trusted server port; only public roster fields enter its request and output is revalidated. */
export type PartitionDraftArchitect = (subject: string, request: DecisionArchitectRequest, context: PartitionIOContext) => Promise<unknown>;
type Invitation = { tokenHash: string; recipientHash: string; expiresAt: number };
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
    if (error instanceof PartitionMembershipError) {
      if (error.code === 'MEMBERSHIP_DENIED') return deny('FORBIDDEN');
      if (error.code === 'MEMBERSHIP_STALE') return deny('STALE_CONTEXT');
      const code = error.code === 'MEMBERSHIP_TIMEOUT' ? 'SESSION_TIMEOUT'
        : error.code === 'MEMBERSHIP_REQUEST_LIMIT' ? 'SESSION_REQUEST_LIMIT'
          : error.code === 'MEMBERSHIP_INVALID' ? 'SESSION_INVALID' : 'SESSION_STORAGE_UNAVAILABLE';
      throw new PartitionSessionError(code, { cause: error });
    }
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
function currentDraft(state: Groups.GroupState, who: string, selected: string, draftId: string): Groups.GroupDraft {
  const group = current(state, who, selected, true);
  const draft = group.drafts.find(value => value.id === draftId);
  if (!draft) return deny('NOT_FOUND');
  if (draft.groupVersion !== group.version) return deny('STALE_CONTEXT');
  if (!Number.isSafeInteger(draft.revision)) throw new PartitionSessionError('SESSION_INVALID');
  return draft;
}
function publicRoster(state: Groups.GroupState, group: Groups.Group) {
  return group.members.map(subject => {
    const account = state.accounts.find(value => value.subject === subject);
    if (account?.status !== 'APPROVED') return deny('FORBIDDEN');
    return { id: partitionMemberId(subject), displayName: account.displayName, requiredForApproval: true };
  });
}
export function createPartitionGroupSession(transport: PartitionTransport,
  options: { now?: () => number; timeoutMs?: number; maxRequests?: number; emailKey?: string; token?: () => string;
    discovery?: PartitionGroupDiscovery; draftArchitect?: PartitionDraftArchitect } = {}) {
  const limits = { ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxRequests === undefined ? {} : { maxRequests: options.maxRequests }) };
  partitionIO(limits); const clock = options.now ?? Date.now;
  const emailKey = options.emailKey; const tokenSource = options.token ?? (() => randomBytes(32).toString('base64url'));
  const discovery = options.discovery;
  const draftArchitect = options.draftArchitect; let generating = 0;
  if (discovery !== undefined && typeof discovery !== 'function') throw new PartitionSessionError('SESSION_INVALID');
  if (draftArchitect !== undefined && typeof draftArchitect !== 'function') throw new PartitionSessionError('SESSION_INVALID');
  if (emailKey !== undefined && (typeof emailKey !== 'string' || emailKey.length < 32 || emailKey.length > 4096)) throw new PartitionSessionError('SESSION_INVALID');
  function emailHash(value: string) {
    if (!emailKey) throw new PartitionSessionError('SESSION_INVALID');
    return createHmac('sha256', emailKey).update(value).digest('hex');
  }
  const repository = createPartitionedGroupRepository(transport, limits);
  function now() { const time = clock(); if (!Number.isSafeInteger(time) || time < 0) throw new PartitionSessionError('SESSION_INVALID'); return time; }
  async function scope(who: string, selected: string, io: PartitionIOContext, allowMissing = false, admission?: Invitation): Promise<PartitionScope> {
    const keys = [partitionAccountKey(who), partitionGroupKey(selected)];
    const rows = transport.readMany ? await partitionCall(io, () => transport.readMany!(keys, io))
      : [await partitionCall(io, () => transport.read(keys[0]!, io)), await partitionCall(io, () => transport.read(keys[1]!, io))];
    if (!Array.isArray(rows) || rows.length !== 2) throw new PartitionSessionError('SESSION_INVALID');
    const account = rows[0] === null ? null : checkPartitionRow(rows[0], keys[0]!);
    if (account?.kind !== 'ACCOUNT' || account.value.status !== 'APPROVED') return deny('FORBIDDEN');
    if (rows[1] === null) return allowMissing ? { groupId: selected, accountSubjects: [who] } : deny('NOT_FOUND');
    const archived = ArchivedGroupRow.safeParse(rows[1]);
    if (archived.success) {
      if (archived.data.groupId !== selected) throw new PartitionSessionError('SESSION_INVALID');
      return deny('NOT_FOUND');
    }
    const header = checkPartitionRow(rows[1], keys[1]!);
    if (header.kind !== 'GROUP' || new Set(header.value.members).size !== header.value.members.length) throw new PartitionSessionError('SESSION_INVALID');
    if (admission) {
      const invitation = header.value.invitations.find(value => value.tokenHash === admission.tokenHash);
      if (!invitation || invitation.recipientHash !== admission.recipientHash || invitation.expiresAt !== admission.expiresAt
        || account.value.emailHash !== admission.recipientHash || invitation.expiresAt <= now()
        || (invitation.acceptedBy !== null && (invitation.acceptedBy !== who || !header.value.members.includes(who)))) return deny('NOT_FOUND');
    } else if (!header.value.members.includes(who)) return deny('NOT_FOUND');
    const subjects = [...new Set([...header.value.members, who])];
    if (subjects.length > 16) throw new PartitionSessionError('SESSION_CAPACITY');
    return { groupId: selected, accountSubjects: subjects };
  }
  async function selected<T>(who: string, selected: string, io: PartitionIOContext,
    work: (resolved: PartitionScope) => Promise<T>, allowMissing = false, admission?: Invitation): Promise<T> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const resolved = await scope(who, selected, io, allowMissing, admission);
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
    list(principal: TrustedPrincipal | null, raw: unknown = {}, supplied?: PartitionIOContext) {
      return safe(async () => {
        const who = participant(principal); const request = listing.safeParse(raw);
        if (!request.success) return deny('INVALID_COMMAND');
        if (!discovery) throw new PartitionSessionError('SESSION_INVALID');
        const io = supplied ?? partitionIO(limits);
        const account = await repository.fence({ accountSubjects: [who] }, state => {
          if (state.accounts.find(value => value.subject === who)?.status !== 'APPROVED') return deny('FORBIDDEN');
        }, io);
        const page = discoveryPage.safeParse(await partitionCall(io, () => discovery({ subject: who, limit: request.data.limit,
          ...(request.data.cursor === undefined ? {} : { cursor: request.data.cursor }) }, io)));
        if (!page.success || page.data.groups.length > request.data.limit
          || new Set(page.data.groups.map(group => group.id)).size !== page.data.groups.length) throw new PartitionSessionError('SESSION_INVALID');
        const guards = new Map(account.mutations.map(mutation => [JSON.stringify(mutation.key), mutation]));
        const groups: Groups.GroupSnapshot[] = [];
        for (const candidate of page.data.groups) {
          try {
            await selected(who, candidate.id, io, async resolved => {
              let value: Groups.GroupSnapshot | undefined;
              const fence = await repository.fence(resolved, state => { value = snapshot(state, current(state, who, candidate.id), who); }, io);
              for (const mutation of fence.mutations) {
                if (mutation.next !== null) throw new PartitionSessionError('SESSION_INVALID');
                const key = JSON.stringify(mutation.key); const prior = guards.get(key);
                if (prior && prior.expected !== mutation.expected) return deny('STALE_CONTEXT');
                guards.set(key, mutation);
              }
              groups.push(value!);
            });
          } catch (error) {
            // A stale index entry can disappear, but never authorize a missing or removed group.
            if (!(error instanceof KnownEnoughApplicationError) || error.code !== 'NOT_FOUND') throw error;
          }
        }
        if (guards.size > 100) throw new PartitionSessionError('SESSION_CAPACITY');
        // Publish the entire page only if every included group/account remains current together.
        if (!await partitionCall(io, () => transport.commit([...guards.values()], io))) return deny('STALE_CONTEXT');
        return { groups, cursor: page.data.cursor };
      });
    },
    register(principal: TrustedPrincipal | null, rawProfile: unknown, raw: unknown) {
      return safe(async () => {
        const who = participant(principal); const verified = profile.safeParse(rawProfile); const request = registration.safeParse(raw);
        if (!verified.success || verified.data.subject !== who) return deny('FORBIDDEN');
        if (!request.success) return deny('INVALID_COMMAND');
        const hash = emailHash(verified.data.email); const io = partitionIO(limits);
        try {
          return await repository.transaction({ accountSubjects: [who] }, async state => {
            let account = state.accounts.find(value => value.subject === who);
            if (account) {
              if (account.emailHash !== hash) return deny('FORBIDDEN');
              const owner = await repository.lookup({ type: 'EMAIL', emailHash: hash }, io);
              if (owner?.type !== 'EMAIL' || owner.subject !== who) return deny('FORBIDDEN');
            } else {
              account = { subject: who, emailHash: hash, displayName: request.data.displayName, status: 'PENDING', version: 1 };
              state.accounts.push(account);
            }
            return Groups.AccountSnapshot.parse({ status: account.status, displayName: account.displayName, version: account.version });
          }, io);
        } catch (error) {
          if (error instanceof PartitionStorageError && error.code === 'PARTITION_IDENTITY_CONFLICT') return deny('FORBIDDEN');
          throw error;
        }
      });
    },
    status(principal: TrustedPrincipal | null) {
      return safe(async () => {
        const who = participant(principal); const io = partitionIO(limits);
        return repository.transaction({ accountSubjects: [who] }, state => {
          const account = state.accounts.find(account => account.subject === who);
          return account ? Groups.AccountSnapshot.parse({ status: account.status, displayName: account.displayName, version: account.version }) : null;
        }, io);
      });
    },
    create(principal: TrustedPrincipal | null, raw: unknown) {
      return safe(async () => {
        const who = participant(principal); const request = create.safeParse(raw);
        if (!request.success) return deny('INVALID_COMMAND');
        // The verified server subject binds replay; caller identity never chooses the partition.
        const key = `group-${createHash('sha256').update(JSON.stringify([who, request.data.idempotencyKey])).digest('hex').slice(0, 40)}`;
        const io = partitionIO(limits);
        return selected(who, key, io, resolved => repository.transaction(resolved, state => {
          if (state.accounts.find(account => account.subject === who)?.status !== 'APPROVED') return deny('FORBIDDEN');
          let group = state.groups.find(group => group.id === key);
          if (group) {
            if (group.organizer !== who || !group.members.includes(who)) return deny('NOT_FOUND');
            if (group.name !== request.data.name) return deny('STALE_CONTEXT');
          } else {
            group = { id: key, name: request.data.name, organizer: who, version: 1,
              members: [who], invitations: [], decisions: [], drafts: [] };
            state.groups.push(group);
          }
          return snapshot(state, group, who);
        }, io), true);
      });
    },
    invite(principal: TrustedPrincipal | null, rawId: string, raw: unknown) {
      return safe(async () => {
        const who = participant(principal); const key = groupId(rawId); const request = invite.safeParse(raw);
        if (!request.success) return deny('INVALID_COMMAND');
        const recipientHash = emailHash(request.data.email); const token = tokenSource();
        if (!accept.shape.token.safeParse(token).success) throw new PartitionSessionError('SESSION_INVALID');
        const tokenHash = createHash('sha256').update(token).digest('hex'); const expiresAt = now() + 86_400_000;
        if (!Number.isSafeInteger(expiresAt)) throw new PartitionSessionError('SESSION_CAPACITY');
        const io = partitionIO(limits);
        // Replacement must never recycle a retained identifier, even for the same recipient.
        if (await repository.lookup({ type: 'INVITATION', tokenHash }, io)) throw new PartitionSessionError('SESSION_INVALID');
        return selected(who, key, io, resolved => repository.transaction(resolved, state => {
          const group = current(state, who, key, true); const time = now();
          if (group.members.some(subject => state.accounts.find(account => account.subject === subject)?.emailHash === recipientHash)) return deny('INVALID_COMMAND');
          if (expiresAt <= time) return deny('STALE_CONTEXT');
          if (!request.data.replace && group.invitations.some(value => value.recipientHash === recipientHash && !value.acceptedBy && value.expiresAt > time)) return deny('STALE_CONTEXT');
          group.invitations = group.invitations.filter(value => value.recipientHash !== recipientHash && value.expiresAt > time);
          if (group.invitations.length >= 64) throw new PartitionSessionError('SESSION_CAPACITY');
          group.invitations.push({ tokenHash, recipientHash, expiresAt, acceptedBy: null });
          // Organizer-private copy-link response; secrets never appear in GroupSnapshot.
          return { token, expiresAt, delivery: 'COPY_LINK' as const };
        }, io));
      });
    },
    accept(principal: TrustedPrincipal | null, raw: unknown) {
      return safe(async () => {
        const who = participant(principal); const request = accept.safeParse(raw);
        if (!request.success) return deny('INVALID_COMMAND');
        const tokenHash = createHash('sha256').update(request.data.token).digest('hex'); const io = partitionIO(limits);
        const directory = await repository.lookup({ type: 'INVITATION', tokenHash }, io);
        if (directory?.type !== 'INVITATION' || directory.expiresAt <= now()) return deny('NOT_FOUND');
        return selected(who, directory.groupId, io, resolved => repository.transaction(resolved, state => {
          const account = state.accounts.find(value => value.subject === who);
          if (account?.status !== 'APPROVED') return deny('FORBIDDEN');
          const group = state.groups.find(value => value.id === directory.groupId);
          if (!group) return deny('NOT_FOUND');
          if (state.accounts.find(value => value.subject === group.organizer)?.status !== 'APPROVED') return deny('FORBIDDEN');
          const invitation = group.invitations.find(value => value.tokenHash === tokenHash);
          if (!invitation || invitation.recipientHash !== directory.recipientHash || invitation.expiresAt !== directory.expiresAt
            || invitation.recipientHash !== account.emailHash || invitation.expiresAt <= now()) return deny('NOT_FOUND');
          if (invitation.acceptedBy) {
            if (invitation.acceptedBy !== who || !group.members.includes(who)) return deny('NOT_FOUND');
          } else {
            if (!group.members.includes(who)) {
              if (group.members.length >= 16 || group.version >= Number.MAX_SAFE_INTEGER) throw new PartitionSessionError('SESSION_CAPACITY');
              group.members.push(who); group.version++;
            }
            invitation.acceptedBy = who;
          }
          return snapshot(state, group, who);
        }, io), false, directory);
      });
    },
    snapshot(principal: TrustedPrincipal | null, rawId: string) {
      return safe(async () => {
        const who = participant(principal); const key = groupId(rawId); const io = partitionIO(limits);
        return selected(who, key, io, resolved => repository.transaction(resolved,
          state => snapshot(state, current(state, who, key), who), io));
      });
    },
    generateDraft(principal: TrustedPrincipal | null, rawId: string, raw: unknown, supplied?: PartitionIOContext) {
      return safe(async () => {
        const who = participant(principal); const key = groupId(rawId); const request = draftGeneration.safeParse(raw);
        if (!request.success) return deny('INVALID_COMMAND');
        const io = supplied ?? partitionIO(limits);
        const draftId = `draft-${createHash('sha256').update(JSON.stringify([key, who, request.data.idempotencyKey])).digest('hex').slice(0, 40)}`;
        const before = await selected(who, key, io, resolved => repository.transaction(resolved, state => {
          const group = current(state, who, key, true); const participants = publicRoster(state, group);
          const bodyHash = createHash('sha256').update(JSON.stringify([request.data.objective, group.version])).digest('hex');
          const existing = group.drafts.find(value => value.id === draftId);
          if (existing && (existing.bodyHash !== bodyHash || existing.groupVersion !== group.version)) return deny('STALE_CONTEXT');
          if (!existing && group.drafts.length >= 64) throw new PartitionSessionError('SESSION_CAPACITY');
          return { groupVersion: group.version, participants, bodyHash, existing: existing ?? null };
        }, io));
        if (before.existing) return Groups.GroupDraft.parse(before.existing);
        if (!draftArchitect) throw new PartitionSessionError('SESSION_INVALID');
        const rawOutput = await partitionCall(io, () => {
          if (generating >= 8) throw new PartitionSessionError('SESSION_CAPACITY');
          generating++;
          return Promise.resolve().then(() => {
            if (io.signal.aborted) throw new PartitionSessionError('SESSION_TIMEOUT');
            return draftArchitect(who, { draftId, revision: 1, objective: request.data.objective,
              participants: before.participants.map(({ id, displayName }) => ({ id, displayName })), allowedOptions: [], generateOptions: true }, io);
          }).finally(() => { generating--; });
        });
        let serialized: string | undefined;
        try { serialized = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput); }
        catch { throw new PartitionSessionError('SESSION_INVALID'); }
        if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > 256 * 1024) throw new PartitionSessionError('SESSION_INVALID');
        let output: z.infer<typeof architectureOutput>;
        try { output = architectureOutput.parse(JSON.parse(serialized)); }
        catch { throw new PartitionSessionError('SESSION_INVALID'); }
        if (output.draftId !== draftId || output.frame.objective !== request.data.objective
          || output.frame.frameVersion !== 1 || output.frame.semanticVersion !== 1
          || JSON.stringify(output.frame.participants) !== JSON.stringify(before.participants)
          || JSON.stringify(output.frame.requiredParticipantIds) !== JSON.stringify(before.participants.map(value => value.id))
          || output.frame.variables.some(value => value.visibility !== 'PUBLIC')
          || output.participantInformationRequirements.some(value => !before.participants.some(person => person.id === value.participantId))
          || (output.status === 'NEEDS_CLARIFICATION') !== (output.clarificationQuestions.length > 0)) throw new PartitionSessionError('SESSION_INVALID');
        const questions = [...output.clarificationQuestions]; const catalog = genericCandidateCatalog(output.frame);
        if (catalog.clarificationQuestion && !questions.includes(catalog.clarificationQuestion)) questions.push(catalog.clarificationQuestion);
        const draft = Groups.GroupDraft.parse({ id: draftId, bodyHash: before.bodyHash, revision: 1, groupVersion: before.groupVersion,
          frame: output.frame, clarificationQuestions: questions.slice(0, 12), createdDecisionId: null });
        return selected(who, key, io, resolved => repository.transaction(resolved, state => {
          const group = current(state, who, key, true);
          if (group.version !== before.groupVersion || JSON.stringify(publicRoster(state, group)) !== JSON.stringify(before.participants)) return deny('STALE_CONTEXT');
          const existing = group.drafts.find(value => value.id === draftId);
          if (existing) {
            if (existing.bodyHash !== before.bodyHash || existing.groupVersion !== before.groupVersion) return deny('STALE_CONTEXT');
            return Groups.GroupDraft.parse(existing);
          }
          if (group.drafts.length >= 64) throw new PartitionSessionError('SESSION_CAPACITY');
          group.drafts.push(draft); return Groups.GroupDraft.parse(draft);
        }, io));
      });
    },
    readDraft(principal: TrustedPrincipal | null, rawId: string, rawDraftId: string, supplied?: PartitionIOContext) {
      return safe(async () => {
        const who = participant(principal); const key = groupId(rawId); const draftId = groupId(rawDraftId);
        const io = supplied ?? partitionIO(limits);
        return selected(who, key, io, resolved => repository.transaction(resolved,
          state => Groups.GroupDraft.parse(currentDraft(state, who, key, draftId)), io));
      });
    },
    editDraft(principal: TrustedPrincipal | null, rawId: string, rawDraftId: string, raw: unknown, supplied?: PartitionIOContext) {
      return safe(async () => {
        const who = participant(principal); const key = groupId(rawId); const draftId = groupId(rawDraftId); const request = draftEdit.safeParse(raw);
        if (!request.success) return deny('INVALID_COMMAND');
        const io = supplied ?? partitionIO(limits);
        return selected(who, key, io, resolved => repository.transaction(resolved, state => {
          const draft = currentDraft(state, who, key, draftId);
          if (draft.createdDecisionId || request.data.revision !== draft.revision) return deny('STALE_CONTEXT');
          if (draft.revision >= Number.MAX_SAFE_INTEGER) throw new PartitionSessionError('SESSION_CAPACITY');
          const frame = KE.PublicDecisionFrame.safeParse({ ...draft.frame, title: request.data.title, objective: request.data.objective,
            variables: request.data.variables, rules: request.data.rules });
          if (!frame.success || frame.data.variables.some(value => value.visibility !== 'PUBLIC') || frame.data.rules.some(value => value.visibility !== 'PUBLIC')) return deny('INVALID_COMMAND');
          draft.frame = frame.data; draft.revision++;
          const catalog = genericCandidateCatalog(draft.frame);
          // Editing never answers a previously unresolved model or public-catalog question.
          if (catalog.clarificationQuestion && !draft.clarificationQuestions.includes(catalog.clarificationQuestion))
            draft.clarificationQuestions = [...draft.clarificationQuestions, catalog.clarificationQuestion].slice(0, 12);
          return Groups.GroupDraft.parse(draft);
        }, io));
      });
    },
    /** Prepare a server-only bundle; its mutations must join the actual decision creation. */
    prepareDraftCreation(principal: TrustedPrincipal | null, rawId: string, rawDraftId: string, raw: unknown, supplied?: PartitionIOContext) {
      return safe(async () => {
        const who = participant(principal); const key = groupId(rawId); const draftId = groupId(rawDraftId); const request = draftCreation.safeParse(raw);
        if (!request.success) return deny('INVALID_COMMAND');
        const io = supplied ?? partitionIO(limits);
        return selected(who, key, io, async resolved => {
          let result!: { definition: KE.DecisionDefinition; memberships: { subject: string; participantId: string; active: boolean }[];
            creationBodyHash: string; created: boolean };
          const fence = await repository.fence(resolved, state => {
            const group = current(state, who, key, true); const draft = currentDraft(state, who, key, draftId);
            if (request.data.revision !== draft.revision) return deny('STALE_CONTEXT');
            const roster = publicRoster(state, group);
            if (JSON.stringify(draft.frame.participants) !== JSON.stringify(roster)
              || JSON.stringify(draft.frame.requiredParticipantIds) !== JSON.stringify(roster.map(member => member.id))) return deny('STALE_CONTEXT');
            const catalog = genericCandidateCatalog(draft.frame);
            if (draft.clarificationQuestions.length || catalog.clarificationQuestion || !catalog.candidates.length)
              throw new KnownEnoughApplicationError('NEEDS_CLARIFICATION');
            if (draft.frame.variables.some(value => value.visibility !== 'PUBLIC') || draft.frame.rules.some(value => value.visibility !== 'PUBLIC'))
              throw new PartitionSessionError('SESSION_INVALID');
            const decisionId = `groupdecision-${createHash('sha256').update(JSON.stringify([key, draftId])).digest('hex').slice(0, 40)}`;
            const created = draft.createdDecisionId !== null;
            if (created && (draft.createdDecisionId !== decisionId || !group.decisions.some(binding => binding.id === decisionId && binding.version === group.version))) return deny('STALE_CONTEXT');
            if (!created) {
              if (group.decisions.some(binding => binding.id === decisionId)) return deny('STALE_CONTEXT');
              if (group.decisions.length >= 64) throw new PartitionSessionError('SESSION_CAPACITY');
              group.decisions.push({ id: decisionId, version: group.version }); draft.createdDecisionId = decisionId;
            }
            result = { created, definition: KE.DecisionDefinition.parse({ ...draft.frame, decisionId,
              variables: draft.frame.variables.map(variable => ({ ...variable, ownerParticipantId: null })) }),
              memberships: group.members.map(subject => ({ subject, participantId: partitionMemberId(subject), active: true })),
              creationBodyHash: createHash('sha256').update(JSON.stringify([key, draftId, draft.revision, draft.groupVersion, draft.frame])).digest('hex') };
          }, io);
          return { ...structuredClone(result), fence: { mutations: structuredClone(fence.mutations),
            assertCurrent: () => safe(() => fence.assertCurrent()) } };
        });
      });
    },
    /** Private organizer roster for decision construction; never a public HTTP snapshot. */
    roster(principal: TrustedPrincipal | null, rawId: string, supplied?: PartitionIOContext) {
      return safe(async () => {
        const who = participant(principal); const key = groupId(rawId); const io = supplied ?? partitionIO(limits);
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
    /** Explicit organizer recovery of a stale binding; pending changes MUST join the decision revision. */
    prepareRoster(principal: TrustedPrincipal | null, rawId: string, rawDecisionId: string,
      expectedGroupVersion?: number, supplied?: PartitionIOContext) {
      return safe(async () => {
        const who = participant(principal); const key = groupId(rawId); const decisionId = groupId(rawDecisionId);
        if (expectedGroupVersion !== undefined && (!Number.isSafeInteger(expectedGroupVersion) || expectedGroupVersion < 1)) return deny('INVALID_COMMAND');
        const io = supplied ?? partitionIO(limits);
        const directory = await repository.lookup({ type: 'DECISION', decisionId }, io);
        if (directory?.type !== 'DECISION' || directory.groupId !== key) return deny('NOT_FOUND');
        let version = 0; let members: { subject: string; participantId: string; displayName: string }[] = [];
        const fence = await selected(who, key, io, resolved => repository.fence(resolved, state => {
          const group = current(state, who, key, true);
          const binding = group.decisions.find(value => value.id === decisionId);
          if (!binding) return deny('NOT_FOUND');
          if (expectedGroupVersion !== undefined && group.version !== expectedGroupVersion) return deny('STALE_CONTEXT');
          version = group.version;
          members = publicRoster(state, group).map(person => ({ subject: group.members.find(subject => partitionMemberId(subject) === person.id)!,
            participantId: person.id, displayName: person.displayName }));
          if (expectedGroupVersion !== undefined) binding.version = group.version;
        }, io));
        return { version, members: structuredClone(members), fence: { mutations: structuredClone(fence.mutations),
          assertCurrent: () => safe(() => fence.assertCurrent()) } };
      });
    },
    /** A verified display grant permits only its room's public publication, independently of membership. */
    displayFence(rawPrincipal: TrustedPrincipal | null, rawDecisionId: string, supplied?: PartitionIOContext): Promise<PartitionFence> {
      return safe(async () => {
        if (rawPrincipal?.kind !== 'display' || !id.safeParse(rawPrincipal.subject).success
          || rawPrincipal.roomId !== rawDecisionId) return deny('FORBIDDEN');
        const who = rawPrincipal.subject; const decisionId = groupId(rawDecisionId); const io = supplied ?? partitionIO(limits);
        const directory = await repository.lookup({ type: 'DECISION', decisionId }, io);
        if (directory?.type !== 'DECISION') return deny('NOT_FOUND');
        const accountKey = partitionAccountKey(who); const headerKey = partitionGroupKey(directory.groupId);
        for (let attempt = 0; attempt < 6; attempt++) {
          const rawHeader = await partitionCall(io, () => transport.read(headerKey, io));
          if (rawHeader === null || ArchivedGroupRow.safeParse(rawHeader).success) return deny('NOT_FOUND');
          const header = checkPartitionRow(rawHeader, headerKey);
          if (header.kind !== 'GROUP') throw new PartitionSessionError('SESSION_INVALID');
          const rawAccount = await partitionCall(io, () => transport.read(accountKey, io));
          const account = rawAccount === null ? null : checkPartitionRow(rawAccount, accountKey);
          if (account !== null && (account.kind !== 'ACCOUNT' || account.value.status !== 'APPROVED')) return deny('FORBIDDEN');
          try {
            const fence = await repository.fence({ groupId: directory.groupId, accountSubjects: [...header.value.members] }, state => {
              const group = state.groups.find(value => value.id === directory.groupId);
              const binding = group?.decisions.find(value => value.id === decisionId);
              if (!group || !binding) return deny('NOT_FOUND');
              if (binding.version !== group.version) return deny('STALE_CONTEXT');
            }, io);
            const expected = account?.revision ?? 0;
            const actorGuard = fence.mutations.find(item => item.key.PK === accountKey.PK && item.key.SK === accountKey.SK);
            if (actorGuard && actorGuard.expected !== expected) return deny('STALE_CONTEXT');
            const guards = actorGuard ? fence.mutations : [...fence.mutations, { key: accountKey, expected, next: null }];
            return { mutations: structuredClone(guards), assertCurrent: async () => {
              await safe(() => fence.assertCurrent());
              const latest = await partitionCall(io, () => transport.read(accountKey, io));
              const current = latest === null ? null : checkPartitionRow(latest, accountKey);
              if ((current?.revision ?? 0) !== expected) return deny('STALE_CONTEXT');
            } };
          } catch (error) {
            if (!(error instanceof PartitionStorageError) || error.code !== 'PARTITION_STALE') throw error;
          }
        }
        return deny('STALE_CONTEXT');
      });
    },
    /** Conditions MUST join the actual decision transaction; assertCurrent alone cannot authorize a write. */
    decisionFence(principal: TrustedPrincipal | null, rawDecisionId: string, supplied?: PartitionIOContext): Promise<PartitionFence> {
      return safe(async () => {
        const who = participant(principal); const decisionId = groupId(rawDecisionId); const io = supplied ?? partitionIO(limits);
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
