import { Id, KnownEnough as KE } from '@deal-table/contracts';
import type { KnownEnough as KETypes } from '@deal-table/contracts';
import { evaluateKnownEnoughCandidate, MAX_ACTIVE_CONFIRMED_CONSTRAINTS } from '@deal-table/domain';
import { RepositoryCapacityError } from './types.ts';
import type {
  Clock, DecisionJob, DecisionMembership, IdSource, KnownEnoughOwnerRecord, KnownEnoughRecord,
  KnownEnoughRepository, TrustedPrincipal,
} from './types.ts';

type DecisionErrorCode = Extract<KETypes.DecisionCommandResult, { ok: false }>['error']['code'];
type DecisionCommand = KETypes.DecisionCommand;
type DecisionOwner = KnownEnoughOwnerRecord;

export interface KnownEnoughApplicationOptions {
  repository: KnownEnoughRepository;
  clock: Clock;
  ids: IdSource;
}

export interface DecisionNegotiationContext {
  job: DecisionJob;
  proposalVersion: number;
  definition: KETypes.DecisionDefinition;
  publicSnapshot: KETypes.PublicDecisionSnapshot;
  confirmedConstraints: Omit<KE.ConfirmedConstraint, 'sourceSummary'>[];
  activeNegotiationPermissions: KE.NegotiationPermission[];
  pendingCandidate: KE.CandidateProposal | null;
}
export interface NegotiationFailureTarget {
  ownerParticipantId: string;
  constraintId: string;
  constraintVersion: number;
}

export class KnownEnoughApplicationError extends Error {
  constructor(readonly code: DecisionErrorCode) {
    super(code);
    this.name = 'KnownEnoughApplicationError';
  }
}

function fail(code: DecisionErrorCode): never { throw new KnownEnoughApplicationError(code); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function emptyOwner(participantId: string): DecisionOwner {
  return {
    participantId, ownerVersion: 0, readiness: 'NOT_STARTED', draftVersion: null, draft: null,
    confirmedConstraints: [], pendingQuestions: [], refusedRequests: [],
    negotiationPermissions: [], disclosurePermissions: [], approval: null,
  };
}
function requiredConfirmed(decision: KnownEnoughRecord): boolean {
  const confirmed = new Set(decision.frameConfirmations.map(item => item.participantId));
  return decision.definition.requiredParticipantIds.every(id => confirmed.has(id));
}
function readinessStatus(decision: KnownEnoughRecord): KnownEnoughRecord['status'] {
  if (!requiredConfirmed(decision)) return 'COLLECTING_FRAME_CONFIRMATION';
  if (decision.owners.some(owner => owner.readiness === 'NEEDS_CLARIFICATION')) return 'NEEDS_CLARIFICATION';
  if (decision.definition.requiredParticipantIds.some(id =>
    decision.owners.find(owner => owner.participantId === id)?.readiness !== 'READY')) return 'COLLECTING_PRIVATE_INPUT';
  return 'READY';
}
function ownerRulesValid(
  definition: KETypes.DecisionDefinition,
  ownerParticipantId: string,
  rules: KETypes.ValidationRule[],
): boolean {
  const visibleVariables = definition.variables.filter(variable => variable.visibility === 'PUBLIC'
    || variable.ownerParticipantId === ownerParticipantId);
  return KE.DecisionDefinition.safeParse({ ...definition, variables: visibleVariables, rules }).success;
}
function validateDraftAgainstDefinition(definition: KETypes.DecisionDefinition, draft: KETypes.AIConstraintDraft): void {
  const rules = draft.proposedConstraints.map(constraint => constraint.kind === 'PREFERENCE' ? {
    id: constraint.constraintId, visibility: 'TRUSTED_BACKEND' as const, operator: 'COMPARE' as const,
    variableId: constraint.preference.variableId, comparison: 'EQ' as const, value: constraint.preference.value,
  } : constraint.rule);
  if (!ownerRulesValid(definition, draft.ownerParticipantId, rules)) fail('INVALID_COMMAND');
}
function publicFrame(definition: KETypes.DecisionDefinition): KETypes.PublicDecisionFrame {
  const variables = definition.variables.filter(variable => variable.visibility !== 'OWNER_PRIVATE').map(variable => {
    const { ownerParticipantId, ...publicVariable } = variable;
    void ownerParticipantId;
    return publicVariable;
  });
  return KE.PublicDecisionFrame.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    decisionId: definition.decisionId,
    frameVersion: definition.frameVersion,
    semanticVersion: definition.semanticVersion,
    contextToken: definition.contextToken,
    title: definition.title,
    objective: definition.objective,
    description: definition.description,
    participants: definition.participants,
    requiredParticipantIds: definition.requiredParticipantIds,
    variables,
    rules: definition.rules.filter(rule => rule.visibility === 'PUBLIC'),
  });
}
function currentApprovals(decision: KnownEnoughRecord): string[] {
  const proposal = decision.candidate;
  if (!proposal) return [];
  return decision.owners.filter(owner => owner.approval
    && owner.approval.proposalId === proposal.proposalId
    && owner.approval.proposalVersion === proposal.proposalVersion
    && owner.approval.publicHash === decision.publicProposal?.publicHash
    && owner.approval.contextToken === decision.definition.contextToken)
    .map(owner => owner.participantId);
}
function retireDisclosureRequests(decision: KnownEnoughRecord, proposal: KE.CandidateProposal): void {
  for (const owner of decision.owners) {
    const retained = [];
    for (const permission of owner.disclosurePermissions) {
      const belongsToProposal = permission.proposalId === proposal.proposalId
        && permission.proposalVersion === proposal.proposalVersion;
      if (belongsToProposal && permission.status === 'PENDING') continue;
      retained.push(belongsToProposal && permission.status === 'ACTIVE'
        ? { ...permission, status: 'SUPERSEDED' as const, permissionVersion: permission.permissionVersion + 1 }
        : permission);
    }
    owner.disclosurePermissions = retained;
  }
}
function supersedeOtherProposalDisclosures(decision: KnownEnoughRecord, current: KE.CandidateProposal): void {
  for (const owner of decision.owners) {
    owner.disclosurePermissions = owner.disclosurePermissions.filter(permission => permission.status !== 'PENDING')
      .map(permission => permission.status === 'ACTIVE'
        && (permission.proposalId !== current.proposalId || permission.proposalVersion !== current.proposalVersion)
        ? { ...permission, status: 'SUPERSEDED' as const, permissionVersion: permission.permissionVersion + 1 }
        : permission);
  }
}
function retireCurrentProposal(decision: KnownEnoughRecord): void {
  if (decision.candidate) {
    const proposal = decision.candidate;
    decision.supersededCandidates.push(structuredClone(proposal));
    if (decision.supersededCandidates.length > 64) decision.supersededCandidates.shift();
    decision.publicRevision += 1;
    retireDisclosureRequests(decision, proposal);
  }
  decision.pendingCandidate = null;
  decision.candidate = null;
  decision.publicProposal = null;
  decision.owners.forEach(owner => { owner.approval = null; });
  decision.job = null;
  decision.solveEpoch += 1;
}
function dependencyStillAuthorized(
  decision: KnownEnoughRecord,
  dependency: KE.CandidateProposal['permissionDependencies'][number],
  now: string,
): boolean {
  const owner = decision.owners.find(item => item.negotiationPermissions.some(permission =>
    permission.permissionId === dependency.permissionId)
      || item.disclosurePermissions.some(permission => permission.permissionId === dependency.permissionId));
  if (!owner) return false;
  if (dependency.kind === 'NEGOTIATION') {
    return owner.negotiationPermissions.some(permission => permission.permissionId === dependency.permissionId
      && permission.permissionVersion === dependency.permissionVersion && permission.status === 'ACTIVE'
      && permission.expiresAt === dependency.expiresAt && Date.parse(permission.expiresAt) > Date.parse(now));
  }
  const permission = owner.disclosurePermissions.find(item => item.permissionId === dependency.permissionId);
  if (!permission || permission.expiresAt !== dependency.expiresAt) return false;
  if (permission.permissionVersion === dependency.permissionVersion && permission.status === 'ACTIVE'
    && Date.parse(permission.expiresAt) > Date.parse(now)) return true;
  return permission.permissionVersion === dependency.permissionVersion + 1 && permission.status === 'PUBLISHED'
    && decision.publishedDisclosures.some(item => item.proposalId === decision.candidate?.proposalId
      && item.contextToken === decision.definition.contextToken);
}
function permissionHistoryUsage(decision: KnownEnoughRecord): number {
  return decision.owners.reduce((sum, owner) => sum + owner.refusedRequests.length
    + owner.negotiationPermissions.length
    + owner.disclosurePermissions.filter(permission => permission.status !== 'PENDING').length
    + owner.pendingQuestions.filter(question => question.status === 'PENDING').length
    + owner.disclosurePermissions.filter(permission => permission.status === 'PENDING').length, 0)
    + decision.retiredPermissions.reduce((sum, owner) => sum + owner.refusedRequests.length
      + owner.negotiationPermissions.length + owner.disclosurePermissions.length, 0);
}
function retireOwnerPermissions(decision: KnownEnoughRecord, owner: DecisionOwner): void {
  if (!owner.refusedRequests.length && !owner.negotiationPermissions.length && !owner.disclosurePermissions.length) return;
  let retired = decision.retiredPermissions.find(item => item.participantId === owner.participantId);
  if (!retired) {
    retired = { participantId: owner.participantId, refusedRequests: [], negotiationPermissions: [], disclosurePermissions: [] };
    decision.retiredPermissions.push(retired);
  }
  retired.refusedRequests.push(...structuredClone(owner.refusedRequests));
  retired.negotiationPermissions.push(...structuredClone(owner.negotiationPermissions));
  retired.disclosurePermissions.push(...structuredClone(owner.disclosurePermissions));
}
function publicSnapshot(
  decision: KnownEnoughRecord,
  viewerParticipantId: string | null,
): KETypes.PublicDecisionSnapshot {
  const audiences = decision.publishedDisclosures.filter(disclosure => viewerParticipantId === null
    ? decision.definition.requiredParticipantIds.every(id => disclosure.audienceParticipantIds.includes(id))
    : disclosure.audienceParticipantIds.includes(viewerParticipantId));
  return KE.PublicDecisionSnapshot.parse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    frame: publicFrame(decision.definition),
    viewerParticipantId,
    semanticVersion: decision.definition.semanticVersion,
    contextToken: decision.definition.contextToken,
    publicRevision: decision.publicRevision,
    status: decision.status,
    frameConfirmations: decision.frameConfirmations,
    currentProposal: decision.publicProposal,
    approvedParticipantIds: currentApprovals(decision),
    publishedDisclosures: audiences,
  });
}
function commandRequestId(raw: unknown): string {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const value = (raw as Record<string, unknown>).requestId;
    if (typeof value === 'string' && Id.safeParse(value).success) return value;
  }
  return 'invalid-request';
}
function errorResult(requestId: string, code: DecisionErrorCode): KETypes.DecisionCommandResult {
  return { ok: false, requestId, error: { code, httpStatus: KE.DECISION_ERROR_HTTP_STATUS[code] } };
}

/** Generic decision lifecycle. Private state is projected through owner-scoped allowlists only. */
export class KnownEnoughApplication {
  constructor(private readonly options: KnownEnoughApplicationOptions) {}

  private id(): string { return Id.parse(this.options.ids.next()); }
  private now(): string {
    const value = this.options.clock.now();
    if (!Number.isFinite(Date.parse(value))) throw new Error('Invalid application clock');
    return new Date(value).toISOString();
  }
  private async contextToken(): Promise<string> { return sha256(this.id()); }

  /** Trusted provisioning operation; identity bindings must cover the exact frame roster. */
  async createDecision(input: {
    definition: unknown;
    creatorSubject: string;
    memberships: readonly DecisionMembership[];
  }): Promise<void> {
    const parsed = KE.DecisionDefinition.safeParse(input.definition);
    if (!parsed.success || !Id.safeParse(input.creatorSubject).success) fail('INVALID_COMMAND');
    const definition = KE.DecisionDefinition.parse({ ...parsed.data, contextToken: await this.contextToken() });
    const participants = definition.participants.map(item => item.id).sort();
    const memberIds = input.memberships.map(item => item.participantId).sort();
    const subjects = input.memberships.map(item => item.subject);
    if (participants.join('|') !== memberIds.join('|') || new Set(memberIds).size !== memberIds.length
      || new Set(subjects).size !== subjects.length
      || !input.memberships.some(item => item.subject === input.creatorSubject && item.active)
      || input.memberships.some(item => !Id.safeParse(item.subject).success || !Id.safeParse(item.participantId).success
        || typeof item.active !== 'boolean')) fail('INVALID_COMMAND');
    const memberships = structuredClone(input.memberships) as DecisionMembership[];
    const record: KnownEnoughRecord = {
      decisionId: definition.decisionId,
      creatorSubject: Id.parse(input.creatorSubject),
      memberships,
      definition,
      status: 'COLLECTING_FRAME_CONFIRMATION',
      publicRevision: 1,
      controlVersion: 0,
      frameConfirmations: [],
      owners: definition.participants.map(participant => emptyOwner(participant.id)),
      pendingCandidate: null,
      candidate: null,
      publicProposal: null,
      proposalVersion: 0,
      supersededCandidates: [],
      agreementHistory: [],
      retiredPermissions: [],
      publishedDisclosures: [],
      solveEpoch: 0,
      job: null,
      replays: [],
    };
    try { await this.options.repository.createDecision(record); }
    catch (error) {
      if (error instanceof RepositoryCapacityError) fail('INVALID_COMMAND');
      throw error;
    }
  }

  private member(decision: KnownEnoughRecord, principal: TrustedPrincipal | null): DecisionMembership {
    if (!principal?.subject) fail('UNAUTHENTICATED');
    if (principal.kind !== 'participant') fail('NOT_FOUND');
    return decision.memberships.find(item => item.subject === principal.subject && item.active
      && decision.definition.participants.some(participant => participant.id === item.participantId)) ?? fail('NOT_FOUND');
  }
  private service(decision: KnownEnoughRecord, principal: TrustedPrincipal | null): void {
    if (!principal?.subject) fail('UNAUTHENTICATED');
    if (principal.kind !== 'service' || !principal.roomIds.includes(decision.decisionId)) fail('FORBIDDEN');
  }
  private readViewer(decision: KnownEnoughRecord, principal: TrustedPrincipal | null): string | null {
    if (!principal?.subject) fail('UNAUTHENTICATED');
    if (principal.kind === 'participant') return this.member(decision, principal).participantId;
    if (principal.kind === 'display' && principal.roomId === decision.decisionId) return null;
    if (principal.kind === 'service' && principal.roomIds.includes(decision.decisionId)) return null;
    fail('NOT_FOUND');
  }

  async getPublicSnapshot(principal: TrustedPrincipal | null, decisionId: string): Promise<KETypes.PublicDecisionSnapshot> {
    return this.options.repository.transactionDecision(decisionId, decision => {
      if (!decision) fail('NOT_FOUND');
      const viewer = this.readViewer(decision, principal);
      this.sweep(decision, this.now());
      return publicSnapshot(decision, viewer);
    });
  }

  async getOwnerSnapshot(principal: TrustedPrincipal | null, decisionId: string): Promise<KETypes.OwnerDecisionSnapshot> {
    return this.options.repository.transactionDecision(decisionId, decision => {
      if (!decision) fail('NOT_FOUND');
      const membership = this.member(decision, principal);
      const owner = decision.owners.find(item => item.participantId === membership.participantId) ?? fail('NOT_FOUND');
      this.sweep(decision, this.now());
      const currentProposal = decision.publicProposal ? decision.candidate : null;
      const variables = decision.definition.variables.filter(variable => variable.visibility !== 'PUBLIC'
        && variable.ownerParticipantId === membership.participantId);
      const privateProposalValues = currentProposal ? {
        proposalId: currentProposal.proposalId,
        proposalVersion: currentProposal.proposalVersion,
        values: currentProposal.values.filter(assignment => variables.some(variable => variable.id === assignment.variableId)),
      } : null;
      return KE.OwnerDecisionSnapshot.parse({
        schemaVersion: KE.KE_SCHEMA_VERSION,
        publicSnapshot: publicSnapshot(decision, membership.participantId),
        ownerParticipantId: membership.participantId,
        ownInputReadiness: owner.readiness,
        privateVariables: variables,
        privateProposalValues,
        controlVersion: decision.controlVersion,
        ownerVersion: owner.ownerVersion,
        draftVersion: owner.draftVersion,
        draft: owner.draft,
        confirmedConstraints: owner.confirmedConstraints,
        // Retained owner-scoped questions anchor every granted permission to the exact refusal/consent request.
        pendingQuestions: owner.pendingQuestions,
        refusedRequests: owner.refusedRequests,
        negotiationPermissions: owner.negotiationPermissions,
        disclosurePermissions: owner.disclosurePermissions,
        ownApproval: owner.approval,
      });
    });
  }

  /** Model output is private and context-bound; raw private conversations are never stored here. */
  async storeConstraintDraft(principal: TrustedPrincipal | null, input: unknown): Promise<void> {
    const parsed = KE.AIConstraintDraft.safeParse(input);
    if (!parsed.success) fail('INVALID_COMMAND');
    const draft = parsed.data;
    await this.options.repository.transactionDecision(draft.decisionId, decision => {
      if (!decision) fail('NOT_FOUND');
      this.service(decision, principal);
      const owner = decision.owners.find(item => item.participantId === draft.ownerParticipantId) ?? fail('NOT_FOUND');
      if (!decision.frameConfirmations.some(item => item.participantId === owner.participantId
        && item.contextToken === decision.definition.contextToken)
        || draft.contextToken !== decision.definition.contextToken
        || draft.semanticVersion !== decision.definition.semanticVersion
        || draft.ownerVersion !== owner.ownerVersion
        || draft.draftVersion !== (owner.draftVersion ?? 0) + 1) fail('STALE_CONTEXT');
      validateDraftAgainstDefinition(decision.definition, draft);
      owner.draft = structuredClone(draft);
      owner.draftVersion = draft.draftVersion;
      if (!decision.candidate) {
        decision.status = requiredConfirmed(decision)
          ? draft.unsupportedConditions.length ? 'NEEDS_CLARIFICATION' : 'COLLECTING_PRIVATE_INPUT'
          : 'COLLECTING_FRAME_CONFIRMATION';
      }
      decision.controlVersion += 1;
    });
  }

  /** Create a private, version-bound negotiation question from trusted model output. */
  async askNegotiation(principal: TrustedPrincipal | null, input: {
    decisionId: string;
    participantId: string;
    constraintId: string;
    constraintVersion: number;
    adjustment: unknown;
    expiresAt: string;
  }): Promise<KETypes.NegotiationQuestion | null> {
    return this.options.repository.transactionDecision(input.decisionId, async decision => {
      if (!decision) fail('NOT_FOUND');
      this.service(decision, principal);
      if (decision.status === 'CLOSED') fail('FORBIDDEN');
      if (decision.candidate || ['PROPOSED', 'APPROVING', 'AGREED'].includes(decision.status)) fail('STALE_CONTEXT');
      if (!requiredConfirmed(decision)) fail('NEEDS_CLARIFICATION');
      const owner = decision.owners.find(item => item.participantId === input.participantId) ?? fail('NOT_FOUND');
      const constraint = owner.confirmedConstraints.find(item => item.constraintId === input.constraintId
        && item.constraintVersion === input.constraintVersion && item.status === 'ACTIVE');
      if (!constraint || constraint.kind !== 'NEGOTIABLE') fail('STALE_CONTEXT');
      const adjustment = KE.ValidationRule.parse(input.adjustment);
      if (!ownerRulesValid(decision.definition, owner.participantId, [adjustment]))
        fail('INVALID_COMMAND');
      if (adjustment.visibility !== 'TRUSTED_BACKEND' || Date.parse(input.expiresAt) <= Date.parse(this.now()))
        fail('INVALID_COMMAND');
      const requestIdentity = await sha256(KE.serializeNegotiationRequestIdentity({
        decisionId: decision.decisionId, contextToken: decision.definition.contextToken,
        semanticVersion: decision.definition.semanticVersion, targetParticipantId: owner.participantId,
        constraintId: constraint.constraintId, constraintVersion: constraint.constraintVersion, adjustment,
      }));
      if (owner.refusedRequests.some(item => item.contextToken === decision.definition.contextToken
        && item.constraintId === constraint.constraintId && item.constraintVersion === constraint.constraintVersion
        && item.requestIdentity === requestIdentity)) return null;
      const existing = owner.pendingQuestions.find(item => item.status === 'PENDING'
        && item.requestIdentity === requestIdentity && Date.parse(item.expiresAt) > Date.parse(this.now()));
      if (existing) return structuredClone(existing);
      if (owner.pendingQuestions.some(item => item.status !== 'PENDING' && item.requestIdentity === requestIdentity)) return null;
      if (owner.pendingQuestions.length >= 32
        || owner.negotiationPermissions.length >= 32
        || permissionHistoryUsage(decision) >= 192)
        fail('INVALID_COMMAND');
      const question = KE.NegotiationQuestion.parse({
        questionId: this.id(), decisionId: decision.decisionId, contextToken: decision.definition.contextToken,
        semanticVersion: decision.definition.semanticVersion, targetParticipantId: owner.participantId,
        constraintId: constraint.constraintId, constraintVersion: constraint.constraintVersion,
        adjustment, requestIdentity, expiresAt: input.expiresAt, status: 'PENDING',
      });
      owner.pendingQuestions.push(question);
      if (decision.job) {
        decision.job = null;
        decision.solveEpoch += 1;
      }
      decision.status = 'PRIVATE_NEGOTIATION';
      decision.controlVersion += 1;
      return structuredClone(question);
    });
  }

  /** Record an exact, pending disclosure request; participant consent is a separate command. */
  async requestDisclosure(principal: TrustedPrincipal | null, input: unknown): Promise<void> {
    const parsed = KE.DisclosurePermission.safeParse(input);
    if (!parsed.success || parsed.data.status !== 'PENDING') fail('INVALID_COMMAND');
    const permission = parsed.data;
    await this.options.repository.transactionDecision(permission.decisionId, async decision => {
      if (!decision) fail('NOT_FOUND');
      this.service(decision, principal);
      const owner = decision.owners.find(item => item.participantId === permission.ownerParticipantId) ?? fail('NOT_FOUND');
      if (decision.status === 'CLOSED' || !decision.candidate || !decision.publicProposal
        || permission.contextToken !== decision.definition.contextToken
        || permission.semanticVersion !== decision.definition.semanticVersion
        || permission.proposalId !== decision.candidate.proposalId
        || permission.proposalVersion !== decision.candidate.proposalVersion
        || permission.audienceParticipantIds.some(id => !decision.definition.participants.some(p => p.id === id))
        || Date.parse(permission.expiresAt) <= Date.parse(this.now())) fail('STALE_CONTEXT');
      if (permission.kind === 'EXACT_TEXT' && await sha256(permission.text) !== permission.textHash) fail('INVALID_COMMAND');
      if (permission.kind === 'VARIABLE_VALUES' && permission.variableIds.some(id => {
        const variable = decision.definition.variables.find(item => item.id === id);
        return !variable || variable.visibility !== 'CONSENT_REQUIRED' || variable.ownerParticipantId !== owner.participantId;
      })) fail('INVALID_COMMAND');
      if (owner.disclosurePermissions.length >= 32 || permissionHistoryUsage(decision) >= 192)
        fail('INVALID_COMMAND');
      if (owner.disclosurePermissions.some(item => item.permissionId === permission.permissionId)) fail('INVALID_COMMAND');
      owner.disclosurePermissions.push(structuredClone(permission));
      decision.controlVersion += 1;
    });
  }

  /** Begin one bounded candidate job, bound to the current semantic context and epoch. */
  async startReasoning(principal: TrustedPrincipal | null, decisionId: string): Promise<DecisionJob> {
    return this.options.repository.transactionDecision(decisionId, decision => {
      if (!decision) fail('NOT_FOUND');
      this.service(decision, principal);
      if (!['READY', 'SUPERSEDED', 'NO_AGREEMENT'].includes(decision.status) || !requiredConfirmed(decision)
        || decision.owners.some(owner => decision.definition.requiredParticipantIds.includes(owner.participantId)
          && owner.readiness !== 'READY')) fail('NEEDS_CLARIFICATION');
      if (decision.job || decision.solveEpoch >= Number.MAX_SAFE_INTEGER) fail('FORBIDDEN');
      decision.solveEpoch += 1;
      decision.job = {
        id: this.id(), contextToken: decision.definition.contextToken,
        semanticVersion: decision.definition.semanticVersion, epoch: decision.solveEpoch,
      };
      decision.status = 'REASONING';
      decision.controlVersion += 1;
      return structuredClone(decision.job);
    });
  }

  /** Allowlisted trusted-worker context; free-text source summaries and raw conversations are excluded. */
  async getReasoningContext(principal: TrustedPrincipal | null, decisionId: string, jobId: string): Promise<DecisionNegotiationContext> {
    return this.options.repository.transactionDecision(decisionId, decision => {
      if (!decision) fail('NOT_FOUND');
      this.service(decision, principal);
      const job = decision.job;
      if (!job || job.id !== jobId || job.contextToken !== decision.definition.contextToken
        || job.semanticVersion !== decision.definition.semanticVersion || decision.status !== 'REASONING') fail('STALE_CONTEXT');
      const confirmedConstraints = decision.owners.flatMap(owner => owner.confirmedConstraints
        .filter(item => item.status === 'ACTIVE')
        .map(item => {
          const projected = Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'sourceSummary'));
          return structuredClone(projected) as Omit<KE.ConfirmedConstraint, 'sourceSummary'>;
        }));
      return {
        job: structuredClone(job),
        proposalVersion: decision.proposalVersion + 1,
        definition: structuredClone(decision.definition),
        publicSnapshot: publicSnapshot(decision, null),
        confirmedConstraints,
        activeNegotiationPermissions: structuredClone(decision.owners.flatMap(owner => owner.negotiationPermissions
          .filter(item => item.status === 'ACTIVE' && Date.parse(item.expiresAt) > Date.parse(this.now())))),
        pendingCandidate: decision.pendingCandidate ? structuredClone(decision.pendingCandidate) : null,
      };
    });
  }

  /** Release only the exact active reasoning job after bounded provider/output failure. */
  async cancelReasoning(principal: TrustedPrincipal | null, decisionId: string, jobId: string): Promise<'CANCELLED' | 'STALE'> {
    return this.options.repository.transactionDecision(decisionId, decision => {
      if (!decision) fail('NOT_FOUND');
      this.service(decision, principal);
      if (!decision.job || decision.job.id !== jobId || decision.job.epoch !== decision.solveEpoch
        || decision.status !== 'REASONING') return 'STALE';
      decision.job = null;
      decision.solveEpoch += 1;
      decision.status = readinessStatus(decision);
      decision.controlVersion += 1;
      return 'CANCELLED';
    });
  }

  /** Recompute the exact negotiable constraints currently blocking a pending candidate. */
  async getPendingNegotiationFailures(principal: TrustedPrincipal | null, decisionId: string): Promise<NegotiationFailureTarget[]> {
    return this.options.repository.transactionDecision(decisionId, async decision => {
      if (!decision) fail('NOT_FOUND');
      this.service(decision, principal);
      const candidate = decision.pendingCandidate;
      if (!candidate || decision.status !== 'PRIVATE_NEGOTIATION') return [];
      const publicFacts = KE.PublicProposalFacts.parse({
        schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: decision.decisionId,
        contextToken: decision.definition.contextToken, semanticVersion: decision.definition.semanticVersion,
        proposalVersion: candidate.proposalVersion, requiredParticipantIds: decision.definition.requiredParticipantIds,
        values: candidate.values.filter(item => decision.definition.variables.some(variable =>
          variable.id === item.variableId && variable.visibility === 'PUBLIC')),
      });
      const proposal = KE.PublicCandidateProposal.parse({
        proposalId: candidate.proposalId, facts: publicFacts,
        publicHash: await KE.hashDecisionProposal(publicFacts), createdAt: candidate.createdAt,
      });
      const result = await evaluateKnownEnoughCandidate({
        definition: decision.definition, candidate, publicProposal: proposal,
        confirmedConstraints: decision.owners.flatMap(owner => owner.confirmedConstraints.filter(item => item.status === 'ACTIVE')),
        frameConfirmations: decision.frameConfirmations,
        readyParticipantIds: decision.owners.filter(owner => owner.readiness === 'READY').map(owner => owner.participantId),
        unresolvedConditionIds: decision.owners.flatMap(owner => owner.draft?.unsupportedConditions.map(item => item.id) ?? []),
        negotiationPermissions: decision.owners.flatMap(owner => owner.negotiationPermissions),
        disclosurePermissions: decision.owners.flatMap(owner => owner.disclosurePermissions), now: this.now(),
      });
      return result.diagnostics.flatMap(item => {
        if (item.code !== 'NEGOTIABLE_PERMISSION_REQUIRED' || !item.ownerParticipantId || !item.constraintId) return [];
        const constraint = decision.owners.find(owner => owner.participantId === item.ownerParticipantId)
          ?.confirmedConstraints.find(value => value.constraintId === item.constraintId
            && value.status === 'ACTIVE' && value.kind === 'NEGOTIABLE');
        return constraint ? [{ ownerParticipantId: item.ownerParticipantId,
          constraintId: item.constraintId, constraintVersion: constraint.constraintVersion }] : [];
      });
    });
  }

  /** Confirm an injected relaxation is exact and would admit the pending candidate before asking its owner. */
  async validatePendingNegotiationAdjustment(principal: TrustedPrincipal | null, input: {
    decisionId: string; ownerParticipantId: string; constraintId: string; constraintVersion: number;
    adjustment: unknown; expiresAt: string;
  }): Promise<boolean> {
    return this.options.repository.transactionDecision(input.decisionId, async decision => {
      if (!decision) fail('NOT_FOUND');
      this.service(decision, principal);
      const candidate = decision.pendingCandidate;
      const owner = decision.owners.find(item => item.participantId === input.ownerParticipantId);
      const constraint = owner?.confirmedConstraints.find(item => item.constraintId === input.constraintId
        && item.constraintVersion === input.constraintVersion && item.status === 'ACTIVE' && item.kind === 'NEGOTIABLE');
      if (!candidate || decision.status !== 'PRIVATE_NEGOTIATION' || !owner || !constraint) return false;
      const adjustment = KE.ValidationRule.safeParse(input.adjustment);
      if (!adjustment.success || adjustment.data.visibility !== 'TRUSTED_BACKEND'
        || !ownerRulesValid(decision.definition, owner.participantId, [adjustment.data])
        || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.parse(this.now())) return false;
      const publicFacts = KE.PublicProposalFacts.parse({
        schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: decision.decisionId,
        contextToken: decision.definition.contextToken, semanticVersion: decision.definition.semanticVersion,
        proposalVersion: candidate.proposalVersion, requiredParticipantIds: decision.definition.requiredParticipantIds,
        values: candidate.values.filter(item => decision.definition.variables.some(variable =>
          variable.id === item.variableId && variable.visibility === 'PUBLIC')),
      });
      const publicProposal = KE.PublicCandidateProposal.parse({
        proposalId: candidate.proposalId, facts: publicFacts,
        publicHash: await KE.hashDecisionProposal(publicFacts), createdAt: candidate.createdAt,
      });
      const evaluationInput = {
        definition: decision.definition, candidate, publicProposal,
        confirmedConstraints: decision.owners.flatMap(item => item.confirmedConstraints.filter(value => value.status === 'ACTIVE')),
        frameConfirmations: decision.frameConfirmations,
        readyParticipantIds: decision.owners.filter(item => item.readiness === 'READY').map(item => item.participantId),
        unresolvedConditionIds: decision.owners.flatMap(item => item.draft?.unsupportedConditions.map(value => value.id) ?? []),
        negotiationPermissions: decision.owners.flatMap(item => item.negotiationPermissions),
        disclosurePermissions: decision.owners.flatMap(item => item.disclosurePermissions), now: this.now(),
      };
      const initial = await evaluateKnownEnoughCandidate(evaluationInput);
      if (!initial.diagnostics.some(item => item.code === 'NEGOTIABLE_PERMISSION_REQUIRED'
        && item.ownerParticipantId === owner.participantId && item.constraintId === constraint.constraintId)) return false;
      const requestIdentity = await sha256(KE.serializeNegotiationRequestIdentity({
        decisionId: decision.decisionId, contextToken: decision.definition.contextToken,
        semanticVersion: decision.definition.semanticVersion, targetParticipantId: owner.participantId,
        constraintId: constraint.constraintId, constraintVersion: constraint.constraintVersion, adjustment: adjustment.data,
      }));
      const permissionId = this.id();
      const permission = KE.NegotiationPermission.parse({
        permissionId, permissionVersion: 1, decisionId: decision.decisionId,
        contextToken: decision.definition.contextToken, semanticVersion: decision.definition.semanticVersion,
        ownerParticipantId: owner.participantId, questionId: this.id(), requestIdentity,
        constraintId: constraint.constraintId, constraintVersion: constraint.constraintVersion,
        adjustment: adjustment.data, status: 'ACTIVE', expiresAt: input.expiresAt,
      });
      const candidateWithPermission = KE.CandidateProposal.safeParse({
        ...candidate,
        permissionDependencies: [...candidate.permissionDependencies, {
          permissionId, permissionVersion: 1, kind: 'NEGOTIATION', expiresAt: input.expiresAt,
        }],
      });
      if (!candidateWithPermission.success) return false;
      const preview = await evaluateKnownEnoughCandidate({
        ...evaluationInput, candidate: candidateWithPermission.data,
        negotiationPermissions: [...evaluationInput.negotiationPermissions, permission],
      });
      return !preview.diagnostics.some(item => item.permissionId === permissionId);
    });
  }

  /** Validate worker output against trusted state; claimed validation and public hashes are recomputed. */
  async completeReasoning(
    principal: TrustedPrincipal | null,
    decisionId: string,
    jobId: string,
    candidateInput: unknown,
  ): Promise<'APPLIED' | 'STALE' | 'NEEDS_CLARIFICATION' | 'NEEDS_PERMISSION' | 'INVALID'> {
    const parsed = KE.CandidateProposal.safeParse(candidateInput);
    if (!parsed.success) fail('INVALID_COMMAND');
    return this.options.repository.transactionDecision(decisionId, async decision => {
      if (!decision) fail('NOT_FOUND');
      this.service(decision, principal);
      const job = decision.job;
      if (!job || job.id !== jobId || job.contextToken !== decision.definition.contextToken
        || job.semanticVersion !== decision.definition.semanticVersion || job.epoch !== decision.solveEpoch
        || decision.status !== 'REASONING') return 'STALE';
      const candidate = parsed.data;
      if (candidate.decisionId !== decision.decisionId || candidate.contextToken !== job.contextToken
        || candidate.semanticVersion !== job.semanticVersion || candidate.proposalVersion !== decision.proposalVersion + 1)
        fail('STALE_CONTEXT');
      const publicFacts = KE.PublicProposalFacts.parse({
        schemaVersion: KE.KE_SCHEMA_VERSION,
        decisionId: decision.decisionId,
        contextToken: decision.definition.contextToken,
        semanticVersion: decision.definition.semanticVersion,
        proposalVersion: candidate.proposalVersion,
        requiredParticipantIds: decision.definition.requiredParticipantIds,
        values: candidate.values.filter(assignment => decision.definition.variables.some(variable =>
          variable.id === assignment.variableId && variable.visibility === 'PUBLIC')),
      });
      const publicProposal = KE.PublicCandidateProposal.parse({
        proposalId: candidate.proposalId,
        facts: publicFacts,
        publicHash: await KE.hashDecisionProposal(publicFacts),
        createdAt: candidate.createdAt,
      });
      const evaluation = await evaluateKnownEnoughCandidate({
        definition: decision.definition,
        candidate,
        publicProposal,
        confirmedConstraints: decision.owners.flatMap(owner => owner.confirmedConstraints
          .filter(constraint => constraint.status === 'ACTIVE')),
        frameConfirmations: decision.frameConfirmations,
        readyParticipantIds: decision.owners.filter(owner => owner.readiness === 'READY').map(owner => owner.participantId),
        unresolvedConditionIds: decision.owners.flatMap(owner => owner.draft?.unsupportedConditions.map(condition => condition.id) ?? []),
        negotiationPermissions: decision.owners.flatMap(owner => owner.negotiationPermissions
          .filter(permission => permission.status === 'ACTIVE')),
        disclosurePermissions: decision.owners.flatMap(owner => owner.disclosurePermissions
          .filter(permission => permission.status === 'ACTIVE')),
        now: this.now(),
      });
      decision.job = null;
      decision.controlVersion += 1;
      if (evaluation.status !== 'VALID') {
        decision.pendingCandidate = structuredClone(candidate);
        decision.candidate = null;
        decision.publicProposal = null;
        decision.status = evaluation.status === 'NEEDS_PERMISSION' ? 'PRIVATE_NEGOTIATION'
          : evaluation.status === 'NEEDS_CLARIFICATION' ? 'NEEDS_CLARIFICATION' : 'NO_AGREEMENT';
        return evaluation.status;
      }
      const validatedCandidate = KE.CandidateProposal.parse({
        ...candidate,
        validation: {
          status: 'VALID', checkedRuleIds: evaluation.checkedRuleIds,
          failedRuleIds: [], unknownRuleIds: [], unsupportedConditionIds: [],
        },
      });
      if (decision.candidate) decision.supersededCandidates.push(structuredClone(decision.candidate));
      if (decision.supersededCandidates.length > 64) decision.supersededCandidates.shift();
      decision.candidate = validatedCandidate;
      decision.pendingCandidate = null;
      decision.publicProposal = publicProposal;
      decision.proposalVersion = candidate.proposalVersion;
      decision.owners.forEach(owner => { owner.approval = null; });
      supersedeOtherProposalDisclosures(decision, candidate);
      decision.status = 'PROPOSED';
      decision.publicRevision += 1;
      return 'APPLIED';
    });
  }

  /** Material frame changes rotate semantic authority and clear every current confirmation. */
  async reviseDecision(principal: TrustedPrincipal | null, input: {
    decisionId: string;
    expectedControlVersion: number;
    definition: unknown;
    memberships: readonly DecisionMembership[];
  }): Promise<void> {
    const parsed = KE.DecisionDefinition.safeParse(input.definition);
    if (!parsed.success) fail('INVALID_COMMAND');
    await this.options.repository.transactionDecision(input.decisionId, async decision => {
      if (!decision) fail('NOT_FOUND');
      if (!principal?.subject) fail('UNAUTHENTICATED');
      const isAuthorizedService = principal.kind === 'service' && principal.roomIds.includes(decision.decisionId);
      const isCurrentCreator = principal.kind === 'participant' && principal.subject === decision.creatorSubject
        && decision.memberships.some(item => item.subject === principal.subject && item.active
          && decision.definition.participants.some(person => person.id === item.participantId));
      if (!isAuthorizedService && !isCurrentCreator) fail('FORBIDDEN');
      if (decision.status === 'CLOSED') fail('FORBIDDEN');
      if (decision.controlVersion !== input.expectedControlVersion) fail('STALE_CONTEXT');
      if (parsed.data.decisionId !== decision.decisionId
        || parsed.data.frameVersion !== decision.definition.frameVersion + 1
        || parsed.data.semanticVersion !== decision.definition.semanticVersion + 1) fail('INVALID_COMMAND');
      const definition = KE.DecisionDefinition.parse({ ...parsed.data, contextToken: await this.contextToken() });
      const participantIds = definition.participants.map(item => item.id).sort();
      const membershipIds = input.memberships.map(item => item.participantId).sort();
      const subjects = input.memberships.map(item => item.subject);
      if (participantIds.join('|') !== membershipIds.join('|') || new Set(membershipIds).size !== membershipIds.length
        || new Set(subjects).size !== subjects.length || input.memberships.some(item =>
          !Id.safeParse(item.subject).success || !Id.safeParse(item.participantId).success)) fail('INVALID_COMMAND');
      if (decision.candidate) decision.supersededCandidates.push(structuredClone(decision.candidate));
      if (decision.candidate) retireDisclosureRequests(decision, decision.candidate);
      if (decision.supersededCandidates.length > 64) decision.supersededCandidates.shift();
      for (const owner of decision.owners) retireOwnerPermissions(decision, owner);
      decision.definition = definition;
      decision.memberships = structuredClone(input.memberships) as DecisionMembership[];
      decision.frameConfirmations = [];
      decision.owners = definition.participants.map(participant => emptyOwner(participant.id));
      if (permissionHistoryUsage(decision) > 192
        || decision.retiredPermissions.some(item => item.refusedRequests.length > 64
          || item.negotiationPermissions.length > 64 || item.disclosurePermissions.length > 64)) fail('INVALID_COMMAND');
      decision.pendingCandidate = null;
      decision.candidate = null;
      decision.publicProposal = null;
      decision.job = null;
      decision.solveEpoch += 1;
      decision.publicRevision += 1;
      decision.status = 'COLLECTING_FRAME_CONFIRMATION';
      decision.controlVersion += 1;
    });
  }

  async closeDecision(principal: TrustedPrincipal | null, decisionId: string, expectedControlVersion: number): Promise<void> {
    await this.options.repository.transactionDecision(decisionId, decision => {
      if (!decision) fail('NOT_FOUND');
      if (!principal?.subject) fail('UNAUTHENTICATED');
      const isAuthorizedService = principal.kind === 'service' && principal.roomIds.includes(decision.decisionId);
      const isCurrentCreator = principal.kind === 'participant' && principal.subject === decision.creatorSubject
        && decision.memberships.some(item => item.subject === principal.subject && item.active
          && decision.definition.participants.some(person => person.id === item.participantId));
      if (!isAuthorizedService && !isCurrentCreator) fail('FORBIDDEN');
      if (decision.controlVersion !== expectedControlVersion) fail('STALE_CONTEXT');
      if (decision.candidate) {
        decision.supersededCandidates.push(structuredClone(decision.candidate));
        retireDisclosureRequests(decision, decision.candidate);
      }
      decision.candidate = null;
      decision.publicProposal = null;
      decision.pendingCandidate = null;
      decision.job = null;
      decision.owners.forEach(owner => { owner.approval = null; });
      decision.solveEpoch += 1;
      decision.status = 'CLOSED';
      decision.publicRevision += 1;
      decision.controlVersion += 1;
    });
  }

  /** Publish only content covered by a current, active participant permission. */
  async publishDisclosure(
    principal: TrustedPrincipal | null,
    decisionId: string,
    participantId: string,
    permissionId: string,
    permissionVersion: number,
  ): Promise<void> {
    await this.options.repository.transactionDecision(decisionId, async decision => {
      if (!decision) fail('NOT_FOUND');
      this.service(decision, principal);
      const owner = decision.owners.find(item => item.participantId === participantId) ?? fail('NOT_FOUND');
      const permission = owner.disclosurePermissions.find(item => item.permissionId === permissionId);
      const candidate = decision.candidate;
      if (!permission || permission.status !== 'ACTIVE' || permission.permissionVersion !== permissionVersion
        || !candidate || !decision.publicProposal || permission.contextToken !== decision.definition.contextToken
        || permission.semanticVersion !== decision.definition.semanticVersion
        || permission.proposalId !== candidate.proposalId || permission.proposalVersion !== candidate.proposalVersion
        || Date.parse(permission.expiresAt) <= Date.parse(this.now())) fail('STALE_CONTEXT');
      let disclosure: KETypes.PublicDecisionSnapshot['publishedDisclosures'][number];
      if (permission.kind === 'EXACT_TEXT') {
        if (await sha256(permission.text) !== permission.textHash) fail('INVALID_COMMAND');
        disclosure = {
          kind: 'EXACT_TEXT', decisionId, contextToken: permission.contextToken,
          semanticVersion: permission.semanticVersion, proposalId: permission.proposalId,
          text: permission.text, audienceParticipantIds: [...permission.audienceParticipantIds], publishedAt: this.now(),
        };
      } else {
        const values = candidate.values.filter(assignment => permission.variableIds.includes(assignment.variableId));
        if (values.length !== permission.variableIds.length) fail('INVALID_COMMAND');
        disclosure = {
          kind: 'VARIABLE_VALUES', decisionId, contextToken: permission.contextToken,
          semanticVersion: permission.semanticVersion, proposalId: permission.proposalId,
          variableIds: [...permission.variableIds], values: structuredClone(values),
          audienceParticipantIds: [...permission.audienceParticipantIds], publishedAt: this.now(),
        };
      }
      if (decision.publishedDisclosures.length >= 64) fail('INVALID_COMMAND');
      decision.publishedDisclosures.push(disclosure);
      permission.status = 'PUBLISHED';
      permission.permissionVersion += 1;
      decision.publicRevision += 1;
      decision.controlVersion += 1;
    });
  }

  private expected(decision: KnownEnoughRecord, command: DecisionCommand, owner: DecisionOwner): void {
    if (command.expected.contextToken !== decision.definition.contextToken
      || command.expected.semanticVersion !== decision.definition.semanticVersion
      || command.expected.controlVersion !== decision.controlVersion) fail('STALE_CONTEXT');
    if (command.expected.ownerVersion !== owner.ownerVersion) fail('STALE_OWNER');
  }
  private sweep(decision: KnownEnoughRecord, now: string): void {
    let changed = false;
    for (const owner of decision.owners) {
      for (const question of owner.pendingQuestions) {
        if (question.status === 'PENDING' && Date.parse(question.expiresAt) <= Date.parse(now)) {
          question.status = 'EXPIRED';
          changed = true;
        }
      }
      for (const permission of owner.negotiationPermissions) {
        if (permission.status === 'ACTIVE' && Date.parse(permission.expiresAt) <= Date.parse(now)) {
          permission.status = 'EXPIRED';
          permission.permissionVersion += 1;
          changed = true;
        }
      }
      for (const permission of owner.disclosurePermissions) {
        if (permission.status === 'PENDING' && Date.parse(permission.expiresAt) <= Date.parse(now)) {
          owner.disclosurePermissions = owner.disclosurePermissions.filter(item => item.permissionId !== permission.permissionId);
          changed = true;
        } else if (permission.status === 'ACTIVE' && Date.parse(permission.expiresAt) <= Date.parse(now)) {
          permission.status = 'EXPIRED';
          permission.permissionVersion += 1;
          changed = true;
        }
      }
    }
    if (changed) {
      if (decision.candidate?.permissionDependencies.some(dependency =>
        !dependencyStillAuthorized(decision, dependency, now))) {
        retireCurrentProposal(decision);
        decision.status = 'SUPERSEDED';
      } else if (decision.status === 'PRIVATE_NEGOTIATION'
        && !decision.owners.some(owner => owner.pendingQuestions.some(question => question.status === 'PENDING'))) {
        decision.status = readinessStatus(decision);
      }
      decision.controlVersion += 1;
    }
  }

  async execute(principal: TrustedPrincipal | null, input: unknown): Promise<KETypes.DecisionCommandResult> {
    const requestId = commandRequestId(input);
    const parsed = KE.DecisionCommand.safeParse(input);
    if (!parsed.success) return errorResult(requestId, 'INVALID_COMMAND');
    const command = parsed.data;
    const rawPrincipal = principal;
    const replayCandidate = rawPrincipal?.subject ? {
      keyHash: sha256(stable([rawPrincipal.kind, rawPrincipal.subject, command.decisionId, command.type, command.idempotencyKey])),
      commandType: command.type,
    } : undefined;
    try {
      return await this.options.repository.transactionDecision(command.decisionId, async decision => {
        if (!decision) fail('NOT_FOUND');
        const membership = this.member(decision, rawPrincipal);
        const owner = decision.owners.find(item => item.participantId === membership.participantId) ?? fail('NOT_FOUND');
        const keyHash = await replayCandidate!.keyHash;
        const body = { ...command, requestId: undefined };
        const bodyHash = await sha256(stable(body));
        const replay = decision.replays.find(item => item.keyHash === keyHash);
        if (replay) {
          if (replay.bodyHash !== bodyHash) fail('IDEMPOTENCY_CONFLICT');
          return replay.result;
        }
        const before = structuredClone(decision);
        const now = this.now();
        this.sweep(decision, now);
        let result: KETypes.DecisionCommandResult;
        try {
          if (decision.status === 'CLOSED') fail('FORBIDDEN');
          this.expected(decision, command, owner);
          const working = structuredClone(decision);
          const workingOwner = working.owners.find(item => item.participantId === membership.participantId)!;
          this.applyCommand(working, workingOwner, command, now);
          working.controlVersion += 1;
          Object.assign(decision, working);
          result = {
            ok: true, requestId, status: 'APPLIED',
            contextToken: decision.definition.contextToken,
            semanticVersion: decision.definition.semanticVersion,
            controlVersion: decision.controlVersion,
            ownerVersion: workingOwner.ownerVersion,
          };
        } catch (error) {
          if (!(error instanceof KnownEnoughApplicationError)) throw error;
          if (stable(decision) !== stable(before)) Object.assign(decision, before);
          result = errorResult(requestId, error.code);
        }
        decision.replays.push({ keyHash, bodyHash, result });
        return result;
      }, replayCandidate ? { replay: replayCandidate } : undefined);
    } catch (error) {
      if (error instanceof RepositoryCapacityError) return errorResult(requestId, 'INVALID_COMMAND');
      if (error instanceof KnownEnoughApplicationError) return errorResult(requestId, error.code);
      throw error;
    }
  }

  private applyCommand(
    decision: KnownEnoughRecord,
    owner: DecisionOwner,
    command: DecisionCommand,
    now: string,
  ): void {
    switch (command.type) {
      case 'CONFIRM_FRAME': {
        if (command.payload.frameVersion !== decision.definition.frameVersion) fail('STALE_CONTEXT');
        const existing = decision.frameConfirmations.find(item => item.participantId === owner.participantId);
        if (existing && existing.frameVersion !== command.payload.frameVersion) fail('STALE_CONTEXT');
        if (existing && existing.semanticVersion === decision.definition.semanticVersion
          && existing.contextToken === decision.definition.contextToken) return;
        const confirmation = KE.FrameConfirmation.parse({
          decisionId: decision.decisionId,
          participantId: owner.participantId,
          frameVersion: decision.definition.frameVersion,
          semanticVersion: decision.definition.semanticVersion,
          contextToken: decision.definition.contextToken,
          confirmedAt: now,
        });
        decision.frameConfirmations = decision.frameConfirmations.filter(item => item.participantId !== owner.participantId);
        decision.frameConfirmations.push(confirmation);
        owner.ownerVersion += 1;
        decision.status = readinessStatus(decision);
        return;
      }
      case 'CONFIRM_CONSTRAINTS': {
        const draft = owner.draft;
        if (!draft || draft.draftId !== command.payload.draftId || draft.draftVersion !== command.payload.draftVersion
          || owner.draftVersion !== command.payload.draftVersion || draft.ownerVersion !== owner.ownerVersion
          || draft.contextToken !== decision.definition.contextToken
          || draft.semanticVersion !== decision.definition.semanticVersion) fail('STALE_DRAFT');
        const selected = new Set(command.payload.constraintIds);
        const proposed = draft.proposedConstraints.filter(item => selected.has(item.constraintId));
        if (proposed.length !== selected.size) fail('INVALID_COMMAND');
        const activeOtherOwners = decision.owners.filter(item => item.participantId !== owner.participantId)
          .reduce((sum, item) => sum + item.confirmedConstraints.filter(constraint => constraint.status === 'ACTIVE').length, 0);
        const nextActiveCount = activeOtherOwners + proposed.length;
        if (nextActiveCount > MAX_ACTIVE_CONFIRMED_CONSTRAINTS
          || owner.confirmedConstraints.length + proposed.length > KE.MAX_PRIVATE_CONSTRAINTS) fail('INVALID_COMMAND');
        retireCurrentProposal(decision);
        const nextOwnerVersion = owner.ownerVersion + 1;
        owner.confirmedConstraints = owner.confirmedConstraints.map(item => item.status === 'ACTIVE'
          ? { ...item, status: 'SUPERSEDED' as const } : item);
        for (const draftConstraint of proposed) {
          const base = {
            schemaVersion: KE.KE_SCHEMA_VERSION,
            constraintId: draftConstraint.constraintId,
            decisionId: decision.decisionId,
            ownerParticipantId: owner.participantId,
            constraintVersion: Math.max(1, ...owner.confirmedConstraints
              .filter(item => item.constraintId === draftConstraint.constraintId).map(item => item.constraintVersion + 1)),
            ownerVersion: nextOwnerVersion,
            semanticVersion: decision.definition.semanticVersion,
            contextToken: decision.definition.contextToken,
            confirmedAt: now,
            status: 'ACTIVE',
            sourceSummary: draft.sourceSummary,
          };
          const constraint = draftConstraint.kind === 'PREFERENCE'
            ? KE.ConfirmedConstraint.parse({ ...base, kind: draftConstraint.kind, preference: draftConstraint.preference })
            : KE.ConfirmedConstraint.parse({ ...base, kind: draftConstraint.kind, rule: draftConstraint.rule });
          owner.confirmedConstraints.push(constraint);
        }
        owner.ownerVersion = nextOwnerVersion;
        owner.readiness = draft.unsupportedConditions.length ? 'NEEDS_CLARIFICATION' : 'READY';
        owner.draft = null;
        owner.draftVersion = null;
        decision.status = readinessStatus(decision);
        return;
      }
      case 'ANSWER_NEGOTIATION': {
        const question = owner.pendingQuestions.find(item => item.questionId === command.payload.questionId);
        if (!question || question.status !== 'PENDING' || question.constraintVersion !== command.payload.constraintVersion
          || question.requestIdentity !== command.payload.requestIdentity
          || question.contextToken !== decision.definition.contextToken
          || question.semanticVersion !== decision.definition.semanticVersion
          || Date.parse(question.expiresAt) <= Date.parse(now)) fail('STALE_CONTEXT');
        question.status = command.payload.answer === 'ALLOW' ? 'ALLOWED' : 'DECLINED';
        if (command.payload.answer === 'ALLOW') {
          const permission = KE.NegotiationPermission.parse({
            permissionId: this.id(), permissionVersion: 1,
            decisionId: decision.decisionId, contextToken: decision.definition.contextToken,
            semanticVersion: decision.definition.semanticVersion, ownerParticipantId: owner.participantId,
            questionId: question.questionId, requestIdentity: question.requestIdentity,
            constraintId: question.constraintId, constraintVersion: question.constraintVersion,
            adjustment: question.adjustment, status: 'ACTIVE', expiresAt: question.expiresAt,
          });
          if (owner.negotiationPermissions.length >= 32) fail('INVALID_COMMAND');
          owner.negotiationPermissions.push(permission);
        } else {
          owner.refusedRequests.push(KE.RefusedNegotiationRequest.parse({
            decisionId: question.decisionId, contextToken: question.contextToken,
            semanticVersion: question.semanticVersion, ownerParticipantId: owner.participantId,
            constraintId: question.constraintId, constraintVersion: question.constraintVersion,
            requestIdentity: question.requestIdentity, refusedAt: now,
          }));
          if (owner.refusedRequests.length > 64) fail('INVALID_COMMAND');
        }
        decision.status = decision.owners.some(item => item.pendingQuestions.some(pending => pending.status === 'PENDING'))
          ? 'PRIVATE_NEGOTIATION' : readinessStatus(decision);
        return;
      }
      case 'DECIDE_DISCLOSURE': {
        const permission = owner.disclosurePermissions.find(item => item.permissionId === command.payload.permissionId);
        if (!permission || permission.status !== 'PENDING' || permission.permissionVersion !== command.payload.permissionVersion
          || permission.decisionId !== decision.decisionId
          || permission.contextToken !== decision.definition.contextToken
          || permission.semanticVersion !== decision.definition.semanticVersion
          || permission.proposalId !== decision.candidate?.proposalId
          || permission.proposalVersion !== decision.candidate?.proposalVersion
          || Date.parse(permission.expiresAt) <= Date.parse(now)) fail('STALE_CONTEXT');
        permission.status = command.payload.decision === 'ALLOW' ? 'ACTIVE' : 'DECLINED';
        return;
      }
      case 'REVOKE_NEGOTIATION': {
        const permission = owner.negotiationPermissions.find(item => item.permissionId === command.payload.permissionId);
        if (!permission || permission.status !== 'ACTIVE'
          || permission.permissionVersion !== command.payload.permissionVersion
          || permission.contextToken !== decision.definition.contextToken
          || permission.semanticVersion !== decision.definition.semanticVersion) fail('STALE_CONTEXT');
        permission.status = 'REVOKED';
        permission.permissionVersion += 1;
        if (decision.candidate?.permissionDependencies.some(item => item.kind === 'NEGOTIATION'
          && item.permissionId === permission.permissionId && item.permissionVersion === command.payload.permissionVersion)) {
          retireCurrentProposal(decision);
          decision.status = 'SUPERSEDED';
        }
        return;
      }
      case 'REVOKE_DISCLOSURE': {
        const permission = owner.disclosurePermissions.find(item => item.permissionId === command.payload.permissionId);
        if (!permission || permission.status !== 'ACTIVE'
          || permission.permissionVersion !== command.payload.permissionVersion
          || permission.contextToken !== decision.definition.contextToken
          || permission.semanticVersion !== decision.definition.semanticVersion) fail('STALE_CONTEXT');
        permission.status = 'REVOKED';
        permission.permissionVersion += 1;
        // Previously published content remains an immutable public receipt.
        if (decision.candidate?.permissionDependencies.some(item => item.kind === 'DISCLOSURE'
          && item.permissionId === permission.permissionId && item.permissionVersion === command.payload.permissionVersion)) {
          retireCurrentProposal(decision);
          decision.status = 'SUPERSEDED';
        }
        return;
      }
      case 'APPROVE_PROPOSAL': {
        const proposal = decision.candidate;
        const publicProposal = decision.publicProposal;
        if (!proposal || !publicProposal || command.payload.proposalId !== proposal.proposalId
          || command.payload.proposalVersion !== proposal.proposalVersion
          || command.payload.publicHash !== publicProposal.publicHash
          || proposal.contextToken !== decision.definition.contextToken
          || proposal.semanticVersion !== decision.definition.semanticVersion) fail('STALE_PROPOSAL');
        if (!decision.definition.requiredParticipantIds.includes(owner.participantId)) fail('FORBIDDEN');
        owner.ownerVersion += 1;
        owner.approval = KE.FinalApproval.parse({
          decisionId: decision.decisionId, proposalId: proposal.proposalId,
          proposalVersion: proposal.proposalVersion, publicHash: publicProposal.publicHash,
          semanticVersion: decision.definition.semanticVersion,
          contextToken: decision.definition.contextToken,
          participantId: owner.participantId, ownerVersion: owner.ownerVersion, approvedAt: now,
        });
        const approvals = currentApprovals(decision);
        decision.status = decision.definition.requiredParticipantIds.every(id => approvals.includes(id)) ? 'AGREED'
          : approvals.length ? 'APPROVING' : 'PROPOSED';
        if (decision.status === 'AGREED') {
          if (decision.agreementHistory.length >= 64) fail('INVALID_COMMAND');
          decision.agreementHistory.push({
            proposal: structuredClone(proposal),
            approvals: decision.owners.flatMap(item => item.approval ? [structuredClone(item.approval)] : []),
            agreedAt: now,
          });
        }
        return;
      }
      case 'WITHDRAW_APPROVAL': {
        const proposal = decision.candidate;
        const publicProposal = decision.publicProposal;
        if (!proposal || !publicProposal || !owner.approval
          || command.payload.proposalId !== proposal.proposalId
          || command.payload.proposalVersion !== proposal.proposalVersion
          || command.payload.publicHash !== publicProposal.publicHash) fail('STALE_PROPOSAL');
        owner.approval = null;
        owner.ownerVersion += 1;
        const approvals = currentApprovals(decision);
        decision.status = approvals.length ? 'APPROVING' : 'PROPOSED';
      }
    }
  }
}
