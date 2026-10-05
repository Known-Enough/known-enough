import { reportModelFailure } from './model-runtime.ts';
import type { ModelFailureDiagnostic, ModelInvocation, ModelCommitGuard } from './model-runtime.ts';
import { KnownEnough as KE } from '@deal-table/contracts';
import { KnownEnoughApplicationError } from './known-enough.ts';
import type { KnownEnoughApplication, DecisionNegotiationContext } from './known-enough.ts';
import type { Clock, TrustedPrincipal, IdSource } from './types.ts';

const MAX_ATTEMPTS = 2;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_QUESTION_TTL_MS = 10 * 60_000;

export interface NegotiationQuestionIntent {
  ownerParticipantId: string;
  constraintId: string;
  constraintVersion: number;
  adjustment: KE.ValidationRule;
}
export interface DecisionNegotiationModelInput {
  context: DecisionNegotiationContext;
  publicCandidates: KE.CandidateProposal['values'][];
  attempt: number;
  retryReason: 'INVALID_OUTPUT' | 'MODEL_ERROR' | null;
  signal: AbortSignal;
  invocation?: ModelInvocation;
}
export type DecisionNegotiationModel = (input: DecisionNegotiationModelInput) => Promise<unknown>;
export interface PublicCandidateExplanation {
  kind: 'VALIDATED_PUBLIC_VALUES';
  values: { variableId: string; label: string; value: string }[];
}
export interface DecisionNegotiationResult {
  outcome: 'APPLIED' | 'STALE' | 'NEEDS_CLARIFICATION' | 'NEEDS_PERMISSION' | 'INVALID';
  publicSnapshot: KE.PublicDecisionSnapshot;
  ownQuestions: KE.NegotiationQuestion[];
  explanation: PublicCandidateExplanation | null;
  attempts: number;
}

export class DecisionNegotiatorError extends Error {
  constructor(readonly code: 'MODEL_FAILED' | 'INVALID_MODEL_OUTPUT', readonly diagnosticReason?: NegotiationOutputFailureReason) {
    super(code);
    this.name = 'DecisionNegotiatorError';
  }
}
export type NegotiationOutputFailureReason = 'OUTPUT_ENVELOPE' | 'QUESTION_INTENTS' | 'PUBLIC_VALUES'
  | 'PERMISSION_DEPENDENCIES' | 'CANDIDATE_SCHEMA' | 'CATALOG_MISMATCH' | 'VALIDATION_EXCEPTION';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}
function parseQuestionIntents(value: unknown, context: DecisionNegotiationContext): NegotiationQuestionIntent[] | null {
  if (!Array.isArray(value) || value.length > KE.MAX_DECISION_PARTICIPANTS * 16) return null;
  const seen = new Set<string>();
  const result: NegotiationQuestionIntent[] = [];
  for (const item of value) {
    if (!record(item) || !exactKeys(item, ['ownerParticipantId', 'constraintId', 'constraintVersion', 'adjustment'])
      || typeof item.ownerParticipantId !== 'string' || typeof item.constraintId !== 'string'
      || !Number.isSafeInteger(item.constraintVersion)) return null;
    const key = `${item.ownerParticipantId}:${item.constraintId}:${item.constraintVersion}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const constraint = context.confirmedConstraints.find(candidate => candidate.ownerParticipantId === item.ownerParticipantId
      && candidate.constraintId === item.constraintId && candidate.constraintVersion === item.constraintVersion
      && candidate.status === 'ACTIVE' && candidate.kind === 'NEGOTIABLE');
    const adjustment = KE.ValidationRule.safeParse(item.adjustment);
    if (!constraint || !adjustment.success || adjustment.data.visibility !== 'TRUSTED_BACKEND') return null;
    result.push({ ownerParticipantId: item.ownerParticipantId, constraintId: item.constraintId,
      constraintVersion: item.constraintVersion as number, adjustment: adjustment.data });
  }
  return result;
}

type ParsedNegotiationOutput = {
  candidate: KE.CandidateProposal;
  questionIntents: NegotiationQuestionIntent[];
};
type ParseModelOutputResult = { ok: true; value: ParsedNegotiationOutput }
  | { ok: false; reason: NegotiationOutputFailureReason };
function parseModelOutput(value: unknown, context: DecisionNegotiationContext, ids: IdSource, now: string): ParseModelOutputResult {
  const expectedKeys = ['values', 'permissionDependencies', 'questionIntents'];
  if (!record(value) || (!exactKeys(value, expectedKeys) && !exactKeys(value, [...expectedKeys, 'explanationDraft']))
    || !Array.isArray(value.values) || !Array.isArray(value.permissionDependencies)) return { ok: false, reason: 'OUTPUT_ENVELOPE' };
  const questionIntents = parseQuestionIntents(value.questionIntents, context);
  if (!questionIntents) return { ok: false, reason: 'QUESTION_INTENTS' };

  const publicVariables = new Set(context.definition.variables.filter(item => item.visibility === 'PUBLIC').map(item => item.id));
  // Only catalog-backed public assignments may cross this model adapter. A future
  // owner-private output path needs its own reviewed provenance/consent policy.
  if (value.values.some(item => !record(item) || typeof item.variableId !== 'string' || !publicVariables.has(item.variableId)))
    return { ok: false, reason: 'PUBLIC_VALUES' };

  const permissionDependencies = value.permissionDependencies;
  for (const raw of permissionDependencies) {
    if (!record(raw) || !exactKeys(raw, ['permissionId', 'permissionVersion', 'kind', 'expiresAt']))
      return { ok: false, reason: 'PERMISSION_DEPENDENCIES' };
    if (!context.activeNegotiationPermissions.some(permission => permission.permissionId === raw.permissionId
      && permission.permissionVersion === raw.permissionVersion && raw.kind === 'NEGOTIATION'
      && permission.expiresAt === raw.expiresAt)) return { ok: false, reason: 'PERMISSION_DEPENDENCIES' };
  }
  const candidate = KE.CandidateProposal.safeParse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    proposalId: ids.next(), decisionId: context.definition.decisionId,
    semanticVersion: context.job.semanticVersion, contextToken: context.job.contextToken,
    proposalVersion: context.proposalVersion, values: value.values,
    validation: { status: 'VALID', checkedRuleIds: [], failedRuleIds: [], unknownRuleIds: [], unsupportedConditionIds: [] },
    permissionDependencies, createdAt: new Date(now).toISOString(),
  });
  return candidate.success
    ? { ok: true, value: { candidate: candidate.data, questionIntents } }
    : { ok: false, reason: 'CANDIDATE_SCHEMA' };
}

function publicValueIdentity(context: DecisionNegotiationContext, values: KE.CandidateProposal['values']): string {
  return KE.serializeDecisionProposal({
    schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: context.definition.decisionId,
    contextToken: context.job.contextToken, semanticVersion: context.job.semanticVersion,
    proposalVersion: context.proposalVersion, requiredParticipantIds: context.definition.requiredParticipantIds, values,
  });
}

function formatPublicValue(variable: KE.PublicDecisionSnapshot['frame']['variables'][number], value: KE.DecisionValue): string {
  if (value.type === 'ENUM') return variable.type === 'ENUM' ? variable.options.find(option => option.id === value.optionId)?.label ?? '—' : '—';
  if (value.type === 'ENUM_SET') return variable.type === 'ENUM_SET'
    ? value.optionIds.map(id => variable.options.find(option => option.id === id)?.label ?? '—').join(', ') : '—';
  if (value.type === 'MONEY') return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: value.currencyCode,
  }).format(value.amountMinor / (10 ** value.minorUnit));
  if (value.type === 'NUMBER') return `${value.coefficient / (10 ** value.scale)} ${value.unitCode}`;
  if (value.type === 'PERCENTAGE') return `${value.basisPoints / 100}%`;
  if (value.type === 'DATE') return value.date;
  if (value.type === 'DATETIME') return `${value.instant} (${value.displayTimeZone})`;
  if (value.type === 'DURATION') return `${value.seconds} seconds`;
  if (value.type === 'BOOLEAN') return value.value ? 'Yes' : 'No';
  if (value.type === 'PARTICIPANT') return variable.type === 'PARTICIPANT'
    ? variable.participantIds.filter(id => value.participantId === id).join(', ') : '—';
  return '—';
}

function publicExplanation(snapshot: KE.PublicDecisionSnapshot): PublicCandidateExplanation | null {
  const proposal = snapshot.currentProposal;
  if (!proposal || !['PROPOSED', 'APPROVING', 'AGREED'].includes(snapshot.status)) return null;
  const variables = new Map(snapshot.frame.variables.filter(item => item.visibility === 'PUBLIC').map(item => [item.id, item]));
  return {
    kind: 'VALIDATED_PUBLIC_VALUES',
    values: proposal.facts.values.flatMap(assignment => {
      const variable = variables.get(assignment.variableId);
      return variable ? [{ variableId: variable.id, label: variable.label, value: formatPublicValue(variable, assignment.value) }] : [];
    }),
  };
}

/** Bounded injected-model orchestration; only application/kernel output can become public. */
export class DecisionNegotiator {
  private readonly timeoutMs: number;
  private readonly questionTtlMs: number;
  constructor(private readonly options: {
    application: KnownEnoughApplication;
    model: DecisionNegotiationModel;
    clock: Clock;
    ids: IdSource;
    timeoutMs?: number;
    questionTtlMs?: number;
    /** Trusted, synchronous public-data-only catalog; no owner conditions or model output as its source. */
    publicCandidates?: (frame: KE.PublicDecisionFrame) => readonly KE.CandidateProposal['values'][];
    /** Trusted server offers independent of owner conditions/model output. Only their public projection reaches the model. */
    trustedCandidates?: (frame: KE.PublicDecisionFrame) => readonly KE.CandidateProposal['values'][];
    isEnabled?: () => boolean;
    diagnostic?: (value: ModelFailureDiagnostic) => void;
  }) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.questionTtlMs = options.questionTtlMs ?? DEFAULT_QUESTION_TTL_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 30_000
      || !Number.isSafeInteger(this.questionTtlMs) || this.questionTtlMs < 60_000 || this.questionTtlMs > 24 * 60 * 60_000)
      throw new Error('Invalid negotiation bounds');
  }

  private async invoke(context: DecisionNegotiationContext, publicCandidates: KE.CandidateProposal['values'][], attempt: number, retryReason: DecisionNegotiationModelInput['retryReason'], invocation: ModelInvocation): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.options.model({ context, publicCandidates: structuredClone(publicCandidates), attempt, retryReason, signal: controller.signal, invocation }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new DecisionNegotiatorError('MODEL_FAILED')); }, this.timeoutMs);
        }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }

  async generate(principal: TrustedPrincipal | null, decisionId: string): Promise<DecisionNegotiationResult> {
    // Membership is checked before the internal service capability is created.
    await this.options.application.getOwnerSnapshot(principal, decisionId);
    const service: TrustedPrincipal = { kind: 'service', subject: 'decision-negotiator', roomIds: [decisionId] };
    const job = await this.options.application.startReasoning(service, decisionId);
    let context: DecisionNegotiationContext;
    let publicCandidates: KE.CandidateProposal['values'][];
    let allowedPublicValues: Map<string, KE.CandidateProposal['values']>;
    try {
      context = await this.options.application.getReasoningContext(service, decisionId, job.id);
      const catalog = this.options.trustedCandidates?.(structuredClone(context.publicSnapshot.frame))
        ?? this.options.publicCandidates?.(structuredClone(context.publicSnapshot.frame)) ?? [];
      if (catalog.length === 0 || catalog.length > 64 || new TextEncoder().encode(JSON.stringify(catalog)).byteLength > 256 * 1024)
        throw new DecisionNegotiatorError('INVALID_MODEL_OUTPUT');
      const publicIds = new Set(context.publicSnapshot.frame.variables.filter(item => item.visibility === 'PUBLIC').map(item => item.id));
      const trustedValues = catalog.map(values => KE.CandidateProposal.shape.values.parse(values));
      if (!this.options.trustedCandidates && trustedValues.some(values => values.some(item => !publicIds.has(item.variableId))))
        throw new DecisionNegotiatorError('INVALID_MODEL_OUTPUT');
      const variableIds = new Set(context.definition.variables.map(item => item.id));
      if (trustedValues.some(values => values.some(item => !variableIds.has(item.variableId))))
        throw new DecisionNegotiatorError('INVALID_MODEL_OUTPUT');
      publicCandidates = trustedValues.map(values => KE.PublicProposalFacts.shape.values.parse(values.filter(item => publicIds.has(item.variableId))));
      allowedPublicValues = new Map(publicCandidates.map((values, index) => [publicValueIdentity(context, values), trustedValues[index]!]));
      // Two complete offers with identical public facts cannot be distinguished by this public-only model selector.
      if (allowedPublicValues.size !== catalog.length) throw new DecisionNegotiatorError('INVALID_MODEL_OUTPUT');
    } catch (error) { await this.options.application.cancelReasoning(service, decisionId, job.id); throw error; }

    const commitGuard: ModelCommitGuard = {
      principal, controlVersion: context.controlVersion,
      expiresAt: Date.parse(this.options.clock.now()) + 30_000,
      ...(this.options.isEnabled ? { isEnabled: this.options.isEnabled } : {}),
    };
    const invocation: ModelInvocation = {
      expiresAt: commitGuard.expiresAt,
      assertCurrent: async () => {
        const owner = await this.options.application.getOwnerSnapshot(principal, decisionId);
        const current = await this.options.application.getReasoningContext(service, decisionId, job.id);
        if (this.options.isEnabled?.() === false || Date.parse(this.options.clock.now()) >= commitGuard.expiresAt
          || owner.controlVersion !== commitGuard.controlVersion || current.job.epoch !== job.epoch
          || current.controlVersion !== commitGuard.controlVersion)
          throw new DecisionNegotiatorError('MODEL_FAILED');
      },
    };
    let parsed: ParsedNegotiationOutput | null = null;
    let attempts = 0;
    let retryReason: DecisionNegotiationModelInput['retryReason'] = null;
    let modelFailed = false;
    let diagnosticReason: NegotiationOutputFailureReason = 'OUTPUT_ENVELOPE';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      attempts = attempt;
      let output: unknown;
      try {
        output = await this.invoke(context, publicCandidates, attempt, retryReason, invocation);
      } catch {
        modelFailed = true;
        retryReason = 'MODEL_ERROR';
        continue;
      }
      try {
        const now = this.options.clock.now();
        if (!Number.isFinite(Date.parse(now))) throw new Error('Invalid clock');
        const parsedOutput = parseModelOutput(output, context, this.options.ids, now);
        if (!parsedOutput.ok) {
          parsed = null;
          diagnosticReason = parsedOutput.reason;
          retryReason = 'INVALID_OUTPUT';
          continue;
        }
        parsed = parsedOutput.value;
        const selected = allowedPublicValues.get(publicValueIdentity(context, parsed.candidate.values));
        if (selected) {
          // Publish the trusted catalog representation, never a model-controlled ordering/encoding.
          parsed.candidate.values = structuredClone(selected);
          if (attempt < MAX_ATTEMPTS && await this.options.application.previewReasoning(service, decisionId, job.id, parsed.candidate) === 'INVALID') {
            reportModelFailure(this.options.diagnostic, 'NEGOTIATION', 'NEGOTIATION_KERNEL_REJECTION');
            parsed = null;
            retryReason = 'INVALID_OUTPUT';
            continue;
          }
          break;
        }
        parsed = null;
        diagnosticReason = 'CATALOG_MISMATCH';
        retryReason = 'INVALID_OUTPUT';
      } catch {
        parsed = null;
        diagnosticReason = 'VALIDATION_EXCEPTION';
        retryReason = 'MODEL_ERROR';
      }
    }
    if (!parsed) {
      reportModelFailure(this.options.diagnostic, 'NEGOTIATION', modelFailed ? 'NEGOTIATION_MODEL_ERROR' : `NEGOTIATION_${diagnosticReason}`);
      await this.options.application.cancelReasoning(service, decisionId, job.id);
      throw new DecisionNegotiatorError(modelFailed ? 'MODEL_FAILED' : 'INVALID_MODEL_OUTPUT', diagnosticReason);
    }

    try {
      let outcome = await this.options.application.completeReasoning(service, decisionId, job.id, parsed.candidate, commitGuard);
      if (outcome === 'STALE') await this.options.application.cancelReasoning(service, decisionId, job.id);
      if (outcome === 'NEEDS_PERMISSION') {
        let questionsIssued = 0;
        let questionControlVersion = context.controlVersion + 1;
        const runtimeActive = () => this.options.isEnabled?.() !== false
          && Date.parse(this.options.clock.now()) < commitGuard.expiresAt;
        const targets = await this.options.application.getPendingNegotiationFailures(service, decisionId);
        const targetKeys = new Set(targets.map(target => `${target.ownerParticipantId}:${target.constraintId}:${target.constraintVersion}`));
        const now = Date.parse(this.options.clock.now());
        for (const intent of parsed.questionIntents) {
          if (!runtimeActive()) break;
          const key = `${intent.ownerParticipantId}:${intent.constraintId}:${intent.constraintVersion}`;
          if (!targetKeys.has(key)) continue;
          const expiresAt = new Date(now + this.questionTtlMs).toISOString();
          const applies = await this.options.application.validatePendingNegotiationAdjustment(service, {
            decisionId, contextToken: job.contextToken, semanticVersion: job.semanticVersion,
            ownerParticipantId: intent.ownerParticipantId,
            constraintId: intent.constraintId, constraintVersion: intent.constraintVersion,
            adjustment: intent.adjustment, expiresAt,
          });
          if (!applies) continue;
          if (!runtimeActive()) break;
          let asked: KE.NegotiationQuestion | null;
          try {
            asked = await this.options.application.askNegotiation(service, {
              decisionId, contextToken: job.contextToken, semanticVersion: job.semanticVersion,
              participantId: intent.ownerParticipantId, pendingProposalId: parsed.candidate.proposalId,
              constraintId: intent.constraintId, constraintVersion: intent.constraintVersion,
              adjustment: intent.adjustment, expiresAt,
              runtimeGuard: { expiresAt: commitGuard.expiresAt, expectedControlVersion: questionControlVersion,
                ...(this.options.isEnabled ? { isEnabled: this.options.isEnabled } : {}) },
            });
          } catch (error) {
            if (!runtimeActive() || (error instanceof KnownEnoughApplicationError && error.code === 'STALE_CONTEXT')) break;
            throw error;
          }
          if (asked) { questionsIssued++; questionControlVersion++; }
        }
        if (questionsIssued === 0 && (!runtimeActive()
          || (await this.options.application.getOwnerSnapshot(principal, decisionId)).controlVersion !== questionControlVersion)) {
          await this.options.application.abandonPendingReasoning(service, {
            decisionId, proposalId: parsed.candidate.proposalId, proposalVersion: parsed.candidate.proposalVersion,
            contextToken: job.contextToken, semanticVersion: job.semanticVersion,
          });
          outcome = 'STALE';
        }
      }

      const [publicSnapshot, ownerSnapshot] = await Promise.all([
        this.options.application.getPublicSnapshot(principal, decisionId),
        this.options.application.getOwnerSnapshot(principal, decisionId),
      ]);
      return {
        outcome,
        publicSnapshot,
        ownQuestions: ownerSnapshot.pendingQuestions.filter(question => question.status === 'PENDING'),
        explanation: publicExplanation(publicSnapshot),
        attempts,
      };
    } catch (error) {
      await this.options.application.cancelReasoning(service, decisionId, job.id);
      throw error;
    }
  }
}
