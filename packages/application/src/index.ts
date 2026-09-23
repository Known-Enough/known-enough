import {
  CommandEnvelope, ERROR_HTTP_STATUS, Id, OwnerSnapshot, PublicRoomSnapshot,
  hashPublicProposal, normalizeDisclosureText,
} from '@deal-table/contracts';
import type {
  CommandResult, DisclosureGrant, ExceptionScope, Interval, PublicHashPayload, PublicPlanFacts,
} from '@deal-table/contracts';
import { solveDecision } from '@deal-table/domain';
import type { OwnedExceptionGrant, SolveDecisionInput } from '@deal-table/domain';
import { MAX_PERMISSION_HISTORY_RECORDS, RepositoryCapacityError } from './types.ts';
import type {
  ApplicationOptions, ErrorCode, ExpectedVersion, OwnerRecord, RetiredDisclosureGrant, RoomRecord, RoomSeed, TrustedPrincipal,
} from './types.ts';
export type * from './types.ts';
export { MAX_PERMISSION_HISTORY_RECORDS, RepositoryCapacityError } from './types.ts';

export class ApplicationError extends Error {
  readonly httpStatus: number;
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = 'ApplicationError';
    this.httpStatus = ERROR_HTTP_STATUS[code];
  }
}
function fail(code: ErrorCode): never { throw new ApplicationError(code); }
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
const MAX_PERMISSION_GRANTS_PER_OWNER = 32;
const MAX_AGREEMENT_RECEIPTS_PER_ROOM = 64;
const MAX_PUBLISHED_DISCLOSURES_PER_ROOM = 32;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

const version = (room: RoomRecord): ExpectedVersion => ({
  contextToken: room.contextToken, decisionRevision: room.decisionRevision, controlVersion: room.controlVersion,
});
const freshOwner = (memberId: string): OwnerRecord => ({
  memberId, revision: 0, acceptedContext: null, confirmed: null, reviewedIntervals: null,
  draft: null, offers: [], previews: [], exceptions: [], disclosures: [], approval: null,
});
function archiveDisclosureGrant(grant: DisclosureGrant): RetiredDisclosureGrant {
  return {
    id: grant.id,
    version: grant.version,
    preview: {
      id: grant.preview.id,
      textHash: grant.preview.textHash,
      audienceMemberIds: [...grant.preview.audienceMemberIds],
      roomId: grant.preview.roomId,
      contextToken: grant.preview.contextToken,
      decisionRevision: grant.preview.decisionRevision,
      expiresAt: grant.preview.expiresAt,
      inferenceWarning: grant.preview.inferenceWarning,
    },
    status: grant.status,
    publishedAt: grant.publishedAt,
  };
}
function copyInterval(value: Interval): Interval {
  return { date: value.date, timezone: value.timezone, startMinute: value.startMinute, endMinute: value.endMinute };
}
function publicFacts(value: PublicPlanFacts): PublicPlanFacts {
  return {
    meeting: { id: value.meeting.id, interval: copyInterval(value.meeting.interval) },
    assignments: value.assignments.map(a => ({ participantId: a.participantId, duty: {
      id: a.duty.id, label: a.duty.label, interval: copyInterval(a.duty.interval),
      loadPoints: a.duty.loadPoints, qualifiedMemberIds: [...a.duty.qualifiedMemberIds],
    } })),
  };
}

export class DealTableApplication {
  private readonly solver;
  private readonly permissionTtlMs;
  private readonly proposalTtlMs;
  constructor(private readonly options: ApplicationOptions) {
    this.solver = options.solver ?? solveDecision;
    this.permissionTtlMs = options.permissionTtlMs ?? 15 * 60_000;
    this.proposalTtlMs = options.proposalTtlMs ?? 15 * 60_000;
    if (![this.permissionTtlMs, this.proposalTtlMs].every(x => Number.isSafeInteger(x) && x > 0))
      throw new Error('Positive finite lifetimes required');
  }
  private id(): string { return Id.parse(this.options.ids.next()); }
  private now(): string {
    const now = this.options.clock.now();
    if (!Number.isFinite(Date.parse(now))) throw new Error('Invalid application clock');
    return new Date(now).toISOString();
  }
  private until(now: string, ttl: number): string { return new Date(Date.parse(now) + ttl).toISOString(); }

  /** Trusted composition/bootstrap API, never a participant command. */
  async createRoom(seed: RoomSeed): Promise<void> {
    const clean = PublicRoomSnapshot.parse({
      schemaVersion: 1, roomId: seed.roomId, contextToken: this.id(), decisionRevision: 1,
      controlVersion: 0, timezone: 'America/Mexico_City', schedule: seed.schedule,
      roster: seed.roster.map(p => ({ ...p, submitted: false })), policy: seed.policy,
      status: 'COLLECTING', proposal: null, approvedMemberIds: [], publishedDisclosures: [],
    });
    if (!seed.organizerSubject || new Set(seed.memberships.map(m => m.subject)).size !== seed.memberships.length
      || new Set(seed.memberships.map(m => m.memberId)).size !== seed.memberships.length
      || seed.memberships.some(m => !m.subject || !clean.roster.some(p => p.id === m.memberId))
      || clean.roster.some(p => !seed.memberships.some(m => m.memberId === p.id))) fail('INVALID_COMMAND');
    await this.options.repository.create({
      roomId: clean.roomId, schedule: clean.schedule, roster: clean.roster, policy: clean.policy,
      organizerSubject: seed.organizerSubject, memberships: structuredClone(seed.memberships),
      contextToken: clean.contextToken, decisionRevision: 1, controlVersion: 0, status: 'COLLECTING',
      owners: clean.roster.map(p => freshOwner(p.id)), retiredPermissionHistory: [], proposal: null, proposalVersion: 0,
      requiredGrants: [], publishedDisclosures: [], agreementHistory: [], roundUsed: false,
      solveEpoch: 0, job: null, replays: [],
    });
  }
  private authorize(principal: TrustedPrincipal | null, room: RoomRecord | null, operation: string): RoomRecord {
    if (!principal?.subject) fail('UNAUTHENTICATED');
    if (!room) fail('NOT_FOUND');
    const isMember = principal.kind === 'participant' && room.memberships.some(m =>
      m.subject === principal.subject && room.roster.some(p => p.id === m.memberId));
    const isOrganizer = principal.kind === 'participant' && room.organizerSubject === principal.subject;
    const isDisplay = principal.kind === 'display' && principal.roomId === room.roomId;
    const isService = principal.kind === 'service' && principal.roomIds.includes(room.roomId);
    if (!isMember && !isOrganizer && !isDisplay && !isService) fail('NOT_FOUND');
    if (operation === 'PUBLIC' && (isMember || isOrganizer || isDisplay)) return room;
    if (['PUBLISH_DISCLOSURE', 'JOB'].includes(operation) && isService) return room;
    if (['REVISE_DECISION', 'CLOSE'].includes(operation) && isOrganizer) return room;
    if (!['PUBLIC', 'PUBLISH_DISCLOSURE', 'JOB', 'REVISE_DECISION', 'CLOSE'].includes(operation) && isMember) return room;
    return fail('FORBIDDEN');
  }
  private owner(room: RoomRecord, principal: TrustedPrincipal): OwnerRecord {
    const membership = room.memberships.find(m => m.subject === principal.subject);
    return room.owners.find(o => o.memberId === membership?.memberId) ?? fail('NOT_FOUND');
  }
  private expected(room: RoomRecord, expected: ExpectedVersion): void {
    if (!same(version(room), expected)) fail('STALE_CONTEXT');
  }
  private clearProposal(room: RoomRecord, status: RoomRecord['status']): void {
    room.proposal = null;
    room.requiredGrants = [];
    for (const owner of room.owners) owner.approval = null;
    room.status = status;
  }
  private invalidate(room: RoomRecord): void {
    room.contextToken = this.id();
    room.decisionRevision += 1;
    room.solveEpoch += 1;
    room.job = null;
    room.roundUsed = false;
    this.clearProposal(room, 'SUPERSEDED');
    for (const participant of room.roster) participant.submitted = false;
    for (const owner of room.owners) {
      owner.acceptedContext = null;
      owner.offers = [];
      owner.previews = [];
      for (const grant of [...owner.exceptions, ...owner.disclosures]) {
        if (grant.status === 'ACTIVE') { grant.status = 'SUPERSEDED'; grant.version += 1; }
      }
    }
  }
  private ready(room: RoomRecord): boolean {
    return room.roster.every(p => room.owners.some(o => o.memberId === p.id
      && o.acceptedContext === room.contextToken && o.confirmed?.contextToken === room.contextToken
      && o.reviewedIntervals !== null));
  }
  private collectingStatus(room: RoomRecord): void {
    room.status = this.ready(room) ? 'READY' : 'COLLECTING';
  }
  private queue(room: RoomRecord): void {
    room.solveEpoch += 1;
    room.job = { id: this.id(), contextToken: room.contextToken, epoch: room.solveEpoch, completed: false };
    this.clearProposal(room, 'SOLVING');
  }
  private sweep(room: RoomRecord, now: string): void {
    let changed = false;
    let feasibilityChanged = false;
    for (const owner of room.owners) {
      const remainingOffers = owner.offers.filter(offer => Date.parse(offer.scope.expiresAt) > Date.parse(now));
      if (remainingOffers.length !== owner.offers.length) {
        owner.offers = remainingOffers; changed = true; feasibilityChanged = true;
      }
      const remainingPreviews = owner.previews.filter(preview => Date.parse(preview.expiresAt) > Date.parse(now));
      if (remainingPreviews.length !== owner.previews.length) changed = true;
      owner.previews = remainingPreviews;
      for (const grant of owner.exceptions) if (grant.status === 'ACTIVE' && Date.parse(grant.scope.expiresAt) <= Date.parse(now)) {
        grant.status = 'EXPIRED'; grant.version += 1; changed = true; feasibilityChanged = true;
      }
      for (const grant of owner.disclosures) if (grant.status === 'ACTIVE' && Date.parse(grant.preview.expiresAt) <= Date.parse(now)) {
        grant.status = 'EXPIRED'; grant.version += 1; changed = true;
      }
    }
    if (room.proposal && Date.parse(room.proposal.validUntil) <= Date.parse(now)) {
      this.clearProposal(room, 'SUPERSEDED'); changed = true;
    }
    if (feasibilityChanged) {
      room.solveEpoch += 1; room.job = null;
      this.clearProposal(room, room.roundUsed ? 'NO_AGREEMENT' : 'SUPERSEDED');
      for (const owner of room.owners) owner.offers = [];
    }
    if (changed) room.controlVersion += 1;
    if (room.status === 'CLOSED') this.clearProposal(room, 'CLOSED');
  }

  async getPublicSnapshot(principal: TrustedPrincipal | null, roomId: string): Promise<PublicRoomSnapshot> {
    return this.options.repository.transaction(roomId, stored => {
      const room = this.authorize(principal, stored, 'PUBLIC');
      const closed = room.status === 'CLOSED';
      this.sweep(room, this.now());
      if (closed) room.status = 'CLOSED';
      else if (room.status === 'COLLECTING') this.collectingStatus(room);
      return PublicRoomSnapshot.parse({
        schemaVersion: 1, roomId: room.roomId, contextToken: room.contextToken,
        decisionRevision: room.decisionRevision, controlVersion: room.controlVersion,
        timezone: 'America/Mexico_City',
        schedule: { slots: room.schedule.slots.map(s => ({ id: s.id, interval: copyInterval(s.interval) })),
          duties: room.schedule.duties.map(d => ({ id: d.id, label: d.label, interval: copyInterval(d.interval),
            loadPoints: d.loadPoints, qualifiedMemberIds: [...d.qualifiedMemberIds] })) },
        roster: room.roster.map(p => ({ id: p.id, displayName: p.displayName, submitted: p.submitted, sharedPriorLoad: p.sharedPriorLoad })),
        policy: room.policy, status: room.status,
        proposal: room.proposal === null ? null : {
          id: room.proposal.id, facts: { schemaVersion: 1, roomId: room.roomId,
            contextToken: room.contextToken, proposalVersion: room.proposal.facts.proposalVersion,
            rosterMemberIds: [...room.proposal.facts.rosterMemberIds], policy: room.policy,
            plan: publicFacts(room.proposal.facts.plan) },
          planHash: room.proposal.planHash, validUntil: room.proposal.validUntil, policyLabel: room.proposal.policyLabel,
        },
        approvedMemberIds: room.owners.filter(o => o.approval !== null).map(o => o.memberId),
        publishedDisclosures: room.publishedDisclosures.filter(d => d.contextToken === room.contextToken
          && (principal!.kind === 'display'
            ? room.roster.every(p => d.audienceMemberIds.includes(p.id))
            : room.memberships.some(m => m.subject === principal!.subject && d.audienceMemberIds.includes(m.memberId)
              && room.roster.some(p => p.id === m.memberId))))
          .map(d => ({ text: d.text,
          audienceMemberIds: [...d.audienceMemberIds], publishedAt: d.publishedAt,
          contextToken: d.contextToken, decisionRevision: d.decisionRevision })),
      });
    });
  }
  async getOwnerSnapshot(principal: TrustedPrincipal | null, roomId: string): Promise<OwnerSnapshot> {
    return this.options.repository.transaction(roomId, stored => {
      const room = this.authorize(principal, stored, 'OWNER');
      const closed = room.status === 'CLOSED';
      this.sweep(room, this.now());
      if (closed) room.status = 'CLOSED';
      const owner = this.owner(room, principal!);
      return OwnerSnapshot.parse({
        schemaVersion: 1, roomId: room.roomId, contextToken: room.contextToken,
        ownerMemberId: owner.memberId, ownerRevision: owner.revision, controlVersion: room.controlVersion,
        confirmedInputs: owner.confirmed, draft: owner.draft,
        availabilityReview: owner.confirmed && owner.reviewedIntervals ? {
          contextToken: owner.confirmed.contextToken, inputRevision: owner.confirmed.inputRevision,
          intervals: owner.reviewedIntervals.map(copyInterval),
        } : null,
        pendingOffers: owner.offers, disclosurePreviews: owner.previews,
        exceptionGrants: owner.exceptions, disclosureGrants: owner.disclosures, ownApproval: owner.approval,
      });
    });
  }

  async execute(principal: TrustedPrincipal | null, input: unknown): Promise<CommandResult> {
    const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const requestId = Id.safeParse(raw.requestId).success ? raw.requestId as string : 'invalid-request';
    try {
      if (!principal?.subject) fail('UNAUTHENTICATED');
      const roomId = typeof raw.roomId === 'string' ? raw.roomId : '';
      const replayCandidate = typeof raw.type === 'string' && typeof raw.idempotencyKey === 'string'
        ? { keyHash: sha256(canonical([principal.kind, principal.subject, roomId, raw.type, raw.idempotencyKey])),
          commandType: raw.type }
        : undefined;
      return await this.options.repository.transaction(roomId, async stored => {
        const room = this.authorize(principal, stored, typeof raw.type === 'string' ? raw.type : 'INVALID');
        const parsed = CommandEnvelope.safeParse(input);
        if (!parsed.success) fail('INVALID_COMMAND');
        const command = parsed.data;
        const { requestId: _requestId, ...bodyData } = command;
        void _requestId;
        const bodyHash = await sha256(canonical(bodyData));
        const keyHash = await sha256(canonical([principal.kind, principal.subject, room.roomId, command.type, command.idempotencyKey]));
        const replay = room.replays.find(record => record.keyHash === keyHash);
        if (replay) {
          if (replay.bodyHash !== bodyHash) fail('IDEMPOTENCY_CONFLICT');
          return replay.result;
        }
        const now = this.now();
        const wasClosed = room.status === 'CLOSED';
        this.sweep(room, now);
        if (wasClosed) room.status = 'CLOSED';
        let result: CommandResult;
        try {
          if (wasClosed) fail('FORBIDDEN');
          this.expected(room, command.expected);
          // Failed application transitions must not leave partial permission or
          // proposal writes, but their accepted command key remains consumed.
          const working = structuredClone(room);
          const status = await this.apply(working, principal, command, now);
          working.controlVersion += 1;
          Object.assign(room, working);
          result = { ok: true, requestId, status, version: version(room) };
        } catch (error) {
          if (!(error instanceof ApplicationError)) throw error;
          result = { ok: false, requestId, error: { code: error.code, httpStatus: ERROR_HTTP_STATUS[error.code] } };
        }
        room.replays.push({ keyHash, bodyHash, result });
        return result;
      }, replayCandidate ? { replay: replayCandidate } : undefined);
    } catch (error) {
      if (error instanceof RepositoryCapacityError) {
        return { ok: false, requestId, error: { code: 'ROOM_CAPACITY_REACHED', httpStatus: 409 } };
      }
      if (!(error instanceof ApplicationError)) throw error;
      return { ok: false, requestId, error: { code: error.code, httpStatus: ERROR_HTTP_STATUS[error.code] } };
    }
  }

  private async apply(room: RoomRecord, principal: TrustedPrincipal, command: CommandEnvelope, now: string): Promise<'APPLIED' | 'QUEUED'> {
    if (command.type === 'REVISE_DECISION') {
      const scheduleChanged = !same(command.payload.schedule, room.schedule);
      // Membership provisioning remains a trusted composition concern. A revision
      // cannot invent authenticated bindings for newly supplied public names.
      this.invalidate(room);
      const nextOwnerIds = new Set(command.payload.roster.map(participant => participant.id));
      for (const departed of room.owners) {
        if (nextOwnerIds.has(departed.memberId)
          || (departed.exceptions.length === 0 && departed.disclosures.length === 0)) continue;
        const archived = room.retiredPermissionHistory.find(history => history.ownerMemberId === departed.memberId);
        if (archived) {
          archived.exceptions.push(...structuredClone(departed.exceptions));
          archived.disclosures.push(...departed.disclosures.map(archiveDisclosureGrant));
        } else {
          room.retiredPermissionHistory.push({
            ownerMemberId: departed.memberId,
            exceptions: structuredClone(departed.exceptions),
            disclosures: departed.disclosures.map(archiveDisclosureGrant),
          });
        }
      }
      room.schedule = structuredClone(command.payload.schedule);
      room.roster = structuredClone(command.payload.roster);
      room.policy = command.payload.policy;
      room.owners = room.roster.map(p => room.owners.find(o => o.memberId === p.id) ?? freshOwner(p.id));
      if (scheduleChanged) for (const owner of room.owners) {
        if (owner.confirmed) owner.draft = {
          draftId: this.id(), draftRevision: owner.revision + 1, values: structuredClone(owner.confirmed.values),
        };
        owner.confirmed = null; owner.reviewedIntervals = null; owner.revision += 1;
      }
      return 'APPLIED';
    }
    if (command.type === 'PUBLISH_DISCLOSURE') {
      const owner = room.owners.find(o => o.disclosures.some(g => g.id === command.payload.grantId));
      const grant = owner?.disclosures.find(g => g.id === command.payload.grantId) ?? fail('NOT_FOUND');
      if (grant.version !== command.payload.grantVersion || grant.status !== 'ACTIVE'
        || grant.preview.contextToken !== room.contextToken || grant.preview.decisionRevision !== room.decisionRevision
        || grant.preview.roomId !== room.roomId || Date.parse(grant.preview.expiresAt) <= Date.parse(now)
        || !same([...grant.preview.audienceMemberIds].sort(), room.roster.map(p => p.id).sort())
        || await this.textHash(grant.preview.text) !== grant.preview.textHash) fail('STALE_CONTEXT');
      const publicationTime = this.now();
      if (Date.parse(grant.preview.expiresAt) <= Date.parse(publicationTime)) fail('STALE_CONTEXT');
      if (!grant.publishedAt) {
        if (room.publishedDisclosures.length >= MAX_PUBLISHED_DISCLOSURES_PER_ROOM) fail('ROOM_CAPACITY_REACHED');
        room.publishedDisclosures.push({ text: grant.preview.text, audienceMemberIds: [...grant.preview.audienceMemberIds],
          publishedAt: publicationTime, contextToken: room.contextToken, decisionRevision: room.decisionRevision });
        grant.publishedAt = publicationTime;
      }
      return 'APPLIED';
    }
    const owner = this.owner(room, principal);
    switch (command.type) {
      case 'SUBMIT_INPUT_DRAFT': {
        if (command.payload.expectedOwnerRevision !== owner.revision) fail('STALE_CONTEXT');
        if (command.payload.values.dutyCosts.some(cost => !room.schedule.duties.some(d => d.id === cost.dutyId))) fail('INVALID_COMMAND');
        owner.revision += 1;
        owner.draft = { draftId: this.id(), draftRevision: owner.revision, values: structuredClone(command.payload.values) };
        return 'APPLIED';
      }
      case 'CONFIRM_INPUTS': {
        if (command.payload.expectedOwnerRevision !== owner.revision || !owner.draft
          || command.payload.draftId !== owner.draft.draftId || command.payload.draftRevision !== owner.draft.draftRevision) fail('STALE_CONTEXT');
        const values = structuredClone(owner.draft.values);
        const inputRevision = (owner.confirmed?.inputRevision ?? 0) + 1;
        this.invalidate(room);
        owner.confirmed = { values, confirmed: true, confirmedAt: now, inputRevision, contextToken: room.contextToken };
        owner.reviewedIntervals = structuredClone(command.payload.reviewedIntervals);
        owner.draft = null; owner.revision += 1;
        // Confirmation of private values is distinct from acceptance of the public setup.
        this.collectingStatus(room);
        return 'APPLIED';
      }
      case 'ACCEPT_CONTEXT': {
        if (command.payload.policy !== room.policy) fail('STALE_CONTEXT');
        if (!owner.confirmed || !owner.reviewedIntervals) fail('NEEDS_CLARIFICATION');
        owner.confirmed = { ...owner.confirmed, contextToken: room.contextToken, confirmedAt: now };
        owner.acceptedContext = room.contextToken;
        owner.revision += 1;
        const participant = room.roster.find(p => p.id === owner.memberId)!;
        participant.submitted = true;
        if (['COLLECTING', 'SUPERSEDED', 'READY'].includes(room.status)) this.collectingStatus(room);
        return 'APPLIED';
      }
      case 'REQUEST_SOLVE': {
        if (!this.ready(room)) fail('NEEDS_CLARIFICATION');
        // One public probe per context; grants queue the single concession rerun.
        if (room.job || room.roundUsed || room.proposal) fail('FORBIDDEN');
        this.queue(room);
        return 'QUEUED';
      }
      case 'DECIDE_EXCEPTION': {
        const offer = owner.offers.find(o => o.id === command.payload.offerId) ?? fail('NOT_FOUND');
        if (offer.version !== command.payload.offerVersion || !same(offer.scope, command.payload.scope)
          || offer.scope.contextToken !== room.contextToken || Date.parse(offer.scope.expiresAt) <= Date.parse(now)) fail('STALE_CONTEXT');
        owner.offers = owner.offers.filter(o => o.id !== offer.id);
        if (owner.exceptions.length >= MAX_PERMISSION_GRANTS_PER_OWNER) fail('ROOM_CAPACITY_REACHED');
        owner.exceptions.push({ id: this.id(), version: 1, scope: structuredClone(offer.scope),
          status: command.payload.decision === 'ALLOW' ? 'ACTIVE' : 'DECLINED' });
        if (command.payload.decision === 'DECLINE') {
          for (const other of room.owners) other.offers = [];
          room.solveEpoch += 1; room.job = null;
          this.clearProposal(room, 'NO_AGREEMENT');
        } else {
          await this.addDisclosurePreview(room, owner, now, offer.scope.expiresAt);
          if (Date.parse(offer.scope.expiresAt) <= Date.parse(this.now())) fail('STALE_CONTEXT');
          if (!room.owners.some(o => o.offers.length)) { this.queue(room); return 'QUEUED'; }
        }
        return 'APPLIED';
      }
      case 'DECIDE_DISCLOSURE': {
        const preview = owner.previews.find(p => p.id === command.payload.preview.id) ?? fail('NOT_FOUND');
        if (!same(preview, command.payload.preview) || preview.contextToken !== room.contextToken
          || Date.parse(preview.expiresAt) <= Date.parse(now)) fail('STALE_CONTEXT');
        owner.previews = owner.previews.filter(p => p.id !== preview.id);
        if (owner.disclosures.length >= MAX_PERMISSION_GRANTS_PER_OWNER) fail('ROOM_CAPACITY_REACHED');
        owner.disclosures.push({ id: this.id(), version: 1, preview: structuredClone(preview),
          status: command.payload.decision === 'ALLOW' ? 'ACTIVE' : 'DECLINED', publishedAt: null });
        return 'APPLIED';
      }
      case 'REVOKE_EXCEPTION': {
        const grant = owner.exceptions.find(g => g.id === command.payload.grantId) ?? fail('NOT_FOUND');
        if (grant.version !== command.payload.grantVersion || grant.status !== 'ACTIVE') fail('STALE_CONTEXT');
        grant.status = 'REVOKED'; grant.version += 1;
        room.solveEpoch += 1; room.job = null;
        this.clearProposal(room, 'SUPERSEDED');
        for (const other of room.owners) other.offers = [];
        return 'APPLIED';
      }
      case 'REVOKE_DISCLOSURE': {
        const grant = owner.disclosures.find(g => g.id === command.payload.grantId) ?? fail('NOT_FOUND');
        if (grant.version !== command.payload.grantVersion || grant.status !== 'ACTIVE') fail('STALE_CONTEXT');
        grant.status = 'REVOKED'; grant.version += 1;
        return 'APPLIED';
      }
      case 'ACCEPT_PROPOSAL':
      case 'WITHDRAW_APPROVAL': {
        const proposal = room.proposal;
        if (!proposal || command.payload.proposalId !== proposal.id
          || command.payload.proposalVersion !== proposal.facts.proposalVersion || command.payload.planHash !== proposal.planHash) fail('STALE_PROPOSAL');
        if (command.type === 'WITHDRAW_APPROVAL') {
          if (!owner.approval) fail('STALE_PROPOSAL');
          // A withdrawn agreement keeps its receipt, but loses all active acceptance.
          if (room.status === 'AGREED') this.clearProposal(room, 'SUPERSEDED');
          else {
            owner.approval = null;
            room.status = room.owners.some(o => o.approval) ? 'APPROVING' : 'PROPOSED';
          }
          return 'APPLIED';
        }
        if (!this.ready(room) || !this.dependenciesActive(room, now)) fail('STALE_PROPOSAL');
        if (await hashPublicProposal(proposal.facts) !== proposal.planHash
          || !this.dependenciesActive(room, this.now())) fail('STALE_PROPOSAL');
        owner.approval = { proposalId: proposal.id, proposalVersion: proposal.facts.proposalVersion,
          contextToken: room.contextToken, planHash: proposal.planHash, acceptedAt: now };
        const unanimous = room.roster.every(p => {
          const approval = room.owners.find(o => o.memberId === p.id)?.approval;
          return approval?.proposalId === proposal.id && approval.proposalVersion === proposal.facts.proposalVersion
            && approval.contextToken === room.contextToken && approval.planHash === proposal.planHash;
        });
        if (unanimous) {
          if (!this.dependenciesActive(room, this.now())) fail('STALE_PROPOSAL');
          if (room.status !== 'AGREED') {
            if (room.agreementHistory.length >= MAX_AGREEMENT_RECEIPTS_PER_ROOM) fail('ROOM_CAPACITY_REACHED');
            room.agreementHistory.push({ proposal: structuredClone(proposal),
            approvals: room.owners.map(o => structuredClone(o.approval!)), agreedAt: now });
          }
          room.status = 'AGREED';
        } else room.status = 'APPROVING';
        return 'APPLIED';
      }
    }
  }

  private dependenciesActive(room: RoomRecord, now: string): boolean {
    if (!room.proposal || Date.parse(room.proposal.validUntil) <= Date.parse(now)) return false;
    return room.requiredGrants.every(ref => {
      const owner = room.owners.find(o => o.memberId === ref.ownerMemberId);
      const grant = owner?.exceptions.find(g => g.id === ref.id);
      const condition = owner?.confirmed?.values.conditions.find(c => c.id === grant?.scope.conditionId);
      return grant?.version === ref.version && grant.status === 'ACTIVE'
        && grant.scope.roomId === room.roomId && grant.scope.contextToken === room.contextToken
        && grant.scope.decisionRevision === room.decisionRevision && grant.scope.inputRevision === owner?.confirmed?.inputRevision
        && grant.scope.policy === room.policy && same([...grant.scope.rosterMemberIds].sort(), room.roster.map(p => p.id).sort())
        && Date.parse(grant.scope.expiresAt) > Date.parse(now) && condition?.kind === 'NEGOTIABLE_UNAVAILABLE' && condition.inviteException
        && same(grant.scope.meeting, room.proposal!.facts.plan.meeting)
        && room.proposal!.facts.plan.assignments.every(a => a.participantId !== owner?.memberId);
    });
  }
  private async textHash(text: string): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  }
  private async addDisclosurePreview(room: RoomRecord, owner: OwnerRecord, now: string, expiresAt: string): Promise<void> {
    if (owner.previews.length || owner.disclosures.some(g => g.preview.contextToken === room.contextToken)) return;
    if (owner.disclosures.length + owner.previews.length >= MAX_PERMISSION_GRANTS_PER_OWNER) fail('ROOM_CAPACITY_REACHED');
    const text = normalizeDisclosureText('A conditional availability exception makes the proposed plan possible.');
    owner.previews.push({ id: this.id(), text, textHash: await this.textHash(text),
      audienceMemberIds: room.roster.map(p => p.id), roomId: room.roomId, contextToken: room.contextToken,
      decisionRevision: room.decisionRevision, expiresAt: this.until(now, Math.min(this.permissionTtlMs, Date.parse(expiresAt) - Date.parse(now))),
      inferenceWarning: 'People may infer who changed availability from the plan. Published words cannot be made secret again.' });
  }
  private solverInput(room: RoomRecord, now: string): SolveDecisionInput {
    return structuredClone({ roomId: room.roomId, contextToken: room.contextToken,
      decisionRevision: room.decisionRevision, policy: room.policy, now,
      schedule: room.schedule, roster: room.roster,
      owners: room.owners.flatMap(owner => owner.confirmed && owner.reviewedIntervals ? [{
        ownerMemberId: owner.memberId, confirmedInputs: owner.confirmed,
        availabilityReview: { contextToken: owner.confirmed.contextToken,
          inputRevision: owner.confirmed.inputRevision, intervals: owner.reviewedIntervals },
      }] : []),
      exceptionGrants: room.owners.flatMap(owner => owner.exceptions.map(grant => ({
        id: grant.id, version: grant.version, ownerMemberId: owner.memberId, scope: grant.scope, status: grant.status,
      }))),
    });
  }
  async pendingSolveJob(principal: TrustedPrincipal | null, roomId: string): Promise<{ id: string; roomId: string } | null> {
    return this.options.repository.transaction(roomId, stored => {
      const room = this.authorize(principal, stored, 'JOB');
      if (room.status === 'CLOSED') return null;
      this.sweep(room, this.now());
      return room.job && !room.job.completed ? { id: room.job.id, roomId } : null;
    });
  }
  async runSolveJob(principal: TrustedPrincipal | null, roomId: string, jobId: string): Promise<'PUBLISHED' | 'STALE' | 'NEEDS_CLARIFICATION'> {
    const start = await this.options.repository.transaction(roomId, stored => {
      const room = this.authorize(principal, stored, 'JOB');
      if (room.status === 'CLOSED') return null;
      this.sweep(room, this.now());
      if (!room.job || room.job.id !== jobId || room.job.completed || !this.ready(room)) return null;
      return { input: this.solverInput(room, this.now()), epoch: room.job.epoch, contextToken: room.contextToken };
    });
    if (!start) return 'STALE';
    // No repository lock is held across potentially asynchronous solver work.
    const result = await this.solver(start.input);
    return this.options.repository.transaction(roomId, async stored => {
      const room = this.authorize(principal, stored, 'JOB');
      if (room.status === 'CLOSED') return 'STALE';
      const now = this.now();
      this.sweep(room, now);
      if (!room.job || room.job.id !== jobId || room.job.completed || room.job.epoch !== start.epoch
        || room.solveEpoch !== start.epoch || room.contextToken !== start.contextToken || !this.ready(room)) return 'STALE';
      room.job.completed = true;
      room.controlVersion += 1;
      if (result.status === 'NEEDS_CLARIFICATION') {
        this.clearProposal(room, 'COLLECTING');
        return 'NEEDS_CLARIFICATION';
      }
      if (result.status === 'NO_AGREEMENT') {
        if (!room.roundUsed && this.offerConcessions(room, now)) room.status = 'PRIVATE_REVIEW';
        else this.clearProposal(room, 'NO_AGREEMENT');
        return 'PUBLISHED';
      }
      room.proposalVersion += 1;
      const facts: PublicHashPayload = { schemaVersion: 1, roomId: room.roomId, contextToken: room.contextToken,
        proposalVersion: room.proposalVersion, rosterMemberIds: room.roster.map(p => p.id), policy: room.policy,
        plan: publicFacts(result.selectedPlan.facts) };
      const required = result.selectedPlan.requiredGrants.map(g => ({ id: g.id, version: g.version, ownerMemberId: g.ownerMemberId }));
      const expiries = required.map(ref => room.owners.find(o => o.memberId === ref.ownerMemberId)?.exceptions.find(g => g.id === ref.id)?.scope.expiresAt);
      const validUntil = new Date(Math.min(Date.parse(this.until(now, this.proposalTtlMs)),
        ...expiries.map(expiry => expiry ? Date.parse(expiry) : 0))).toISOString();
      room.proposal = { id: this.id(), facts, planHash: await hashPublicProposal(facts), validUntil,
        policyLabel: room.policy === 'BALANCE_RECENT_LOAD' ? 'Balance recent duty load' : 'Lowest declared inconvenience' };
      room.requiredGrants = required;
      if (!this.dependenciesActive(room, this.now())) { this.clearProposal(room, 'SUPERSEDED'); return 'STALE'; }
      for (const owner of room.owners) owner.approval = null;
      room.status = 'PROPOSED';
      return 'PUBLISHED';
    });
  }

  /** Reserve bounded history for every pending exception decision and its one possible disclosure preview. */
  private canReservePermissionResponses(room: RoomRecord, grants: OwnedExceptionGrant[]): boolean {
    const additionalOffers = new Map<string, number>();
    for (const grant of grants) additionalOffers.set(grant.ownerMemberId, (additionalOffers.get(grant.ownerMemberId) ?? 0) + 1);
    const retainedHistory = room.retiredPermissionHistory.reduce(
      (sum, history) => sum + history.exceptions.length + history.disclosures.length, 0,
    ) + room.owners.reduce((sum, owner) => sum + owner.exceptions.length + owner.disclosures.length, 0);
    const pendingResponses = room.owners.reduce((sum, owner) => {
      const pendingOffers = owner.offers.length + (additionalOffers.get(owner.memberId) ?? 0);
      const alreadyHasDisclosureResponse = owner.previews.length > 0
        || owner.disclosures.some(grant => grant.preview.contextToken === room.contextToken);
      const disclosureReservation = pendingOffers > 0 && !alreadyHasDisclosureResponse ? 1 : 0;
      return sum + pendingOffers + owner.previews.length + disclosureReservation;
    }, 0);
    if (retainedHistory + pendingResponses > MAX_PERMISSION_HISTORY_RECORDS) return false;
    return room.owners.every(owner => {
      const newOffers = additionalOffers.get(owner.memberId) ?? 0;
      const pendingOffers = owner.offers.length + newOffers;
      if (owner.exceptions.length + pendingOffers > MAX_PERMISSION_GRANTS_PER_OWNER) return false;
      const alreadyHasDisclosureResponse = owner.previews.length > 0
        || owner.disclosures.some(grant => grant.preview.contextToken === room.contextToken);
      const disclosureReservation = pendingOffers > 0 && !alreadyHasDisclosureResponse ? 1 : 0;
      return owner.disclosures.length + owner.previews.length + disclosureReservation <= MAX_PERMISSION_GRANTS_PER_OWNER;
    });
  }

  /** Finite exhaustive search: 3 meeting slots x 7 nonempty owner subsets.
   * All overlapping invited conditions for a selected owner are covered together.
   * No hard condition is ever relaxed, and only a proven feasible set is offered.
   */
  private offerConcessions(room: RoomRecord, now: string): boolean {
    room.roundUsed = true;
    const input = this.solverInput(room, now);
    const alternatives: OwnedExceptionGrant[][] = [];
    for (const meeting of room.schedule.slots) {
      const byOwner = room.owners.map(owner => owner.confirmed?.values.conditions.flatMap(condition => {
        if (condition.kind !== 'NEGOTIABLE_UNAVAILABLE' || !condition.inviteException
          || condition.interval.date !== meeting.interval.date || condition.interval.timezone !== meeting.interval.timezone
          || condition.interval.startMinute >= meeting.interval.endMinute || meeting.interval.startMinute >= condition.interval.endMinute) return [];
        const scope: ExceptionScope = { conditionId: condition.id, roomId: room.roomId, contextToken: room.contextToken,
          decisionRevision: room.decisionRevision, inputRevision: owner.confirmed!.inputRevision,
          rosterMemberIds: room.roster.map(p => p.id), policy: room.policy, meeting: structuredClone(meeting),
          predicate: 'OWNER_HAS_NO_WEEKEND_DUTIES', expiresAt: this.until(now, this.permissionTtlMs) };
        return [{ id: this.id(), version: 1, ownerMemberId: owner.memberId, scope, status: 'ACTIVE' as const }];
      }) ?? []);
      for (let mask = 1; mask < 1 << room.owners.length; mask += 1) {
        const grants = byOwner.flatMap((group, index) => mask & 1 << index ? group : []);
        if (grants.length && this.canReservePermissionResponses(room, grants)
          && solveDecision({ ...input, exceptionGrants: [...input.exceptionGrants, ...grants] }).status === 'SOLVED') alternatives.push(grants);
      }
    }
    alternatives.sort((a, b) => a.length - b.length);
    const grants = alternatives[0];
    if (!grants) return false;
    for (const grant of grants) room.owners.find(o => o.memberId === grant.ownerMemberId)!.offers.push({
      id: this.id(), version: 1, scope: structuredClone(grant.scope),
    });
    return true;
  }

  /** Local lifecycle operation until a close wire command is designed. */
  async closeRoom(principal: TrustedPrincipal | null, roomId: string, expected: ExpectedVersion): Promise<void> {
    await this.options.repository.transaction(roomId, stored => {
      const room = this.authorize(principal, stored, 'CLOSE');
      this.expected(room, expected);
      if (room.status === 'CLOSED') fail('FORBIDDEN');
      this.invalidate(room);
      this.clearProposal(room, 'CLOSED');
      room.controlVersion += 1;
    });
  }
}
