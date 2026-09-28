import type { ModelInvocation } from './model-runtime.ts';
import { Id, KnownEnough as KE } from '@deal-table/contracts';
import type { KnownEnough as KETypes } from '@deal-table/contracts';

export interface DecisionArchitectParticipant {
  id: string;
  displayName: string;
}

export interface DecisionArchitectRequest {
  draftId: string;
  revision: number;
  objective: string;
  participants: readonly DecisionArchitectParticipant[];
  allowedOptions: readonly string[];
}

export interface DecisionArchitectModelInput {
  objective: string;
  participants: readonly DecisionArchitectParticipant[];
  allowedOptions: readonly string[];
}

/** A model port is injected by the caller. Raw output is always treated as untrusted. */
export interface DecisionArchitectModel {
  draft(input: DecisionArchitectModelInput, invocation?: ModelInvocation): Promise<unknown>;
}

export type DecisionArchitectureDraft = {
  draftId: string;
  revision: number;
  status: 'DEFINING' | 'NEEDS_CLARIFICATION';
  frame: KETypes.PublicDecisionFrame;
  clarificationQuestions: string[];
  participantInformationRequirements: { participantId: string; prompt: string }[];
};

export type DecisionArchitectErrorCode = 'INVALID_COMMAND' | 'STALE_CONTEXT' | 'RETRYABLE_SERVER_ERROR';

export class DecisionArchitectError extends Error {
  constructor(readonly code: DecisionArchitectErrorCode) {
    super(code);
    this.name = 'DecisionArchitectError';
  }
}

const MAX_ACTIVE_DRAFTS = 128;
const MAX_OPTIONS = 32;
const MAX_QUESTIONS = 12;
const MAX_REQUIREMENTS = 64;
const REQUIREMENT_PROMPTS: Readonly<Record<string, string>> = {
  DATES: 'Share dates or times that do not work for you privately.',
  BUDGET: 'Share a private price range that works for you.',
  PREFERENCES: 'Share preferences you want considered privately.',
  ACCESSIBILITY: 'Share accessibility needs privately.',
};
const MODEL_FIELDS = [
  'title', 'description', 'variables', 'rules', 'clarificationQuestions', 'participantInformationRequirements',
].sort();

function fail(code: DecisionArchitectErrorCode): never { throw new DecisionArchitectError(code); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function sameKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}
function boundedStrings(value: unknown, maximum: number, length: number): value is string[] {
  return Array.isArray(value) && value.length <= maximum
    && value.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= length);
}
function normalizePublicModelFields(variables: unknown[], rules: unknown[]): { variables: unknown[]; rules: unknown[] } {
  const remaps = new Map<string, Map<string, string>>();
  const normalizedVariables = variables.map((value, variableIndex) => {
    if (!record(value) || value.visibility !== 'PUBLIC') return value;
    const variable: Record<string, unknown> = { ...value, ownerParticipantId: null };
    if ((value.type === 'ENUM' || value.type === 'ENUM_SET') && Array.isArray(value.options)
      && typeof value.id === 'string') {
      const usedIds = new Set(value.options.flatMap(option => record(option) && Id.safeParse(option.id).success
        ? [option.id as string] : []));
      const remap = new Map<string, string>();
      const ambiguous = new Set<string>();
      variable.options = value.options.map((option, optionIndex) => {
        if (!record(option) || Id.safeParse(option.id).success) return option;
        let generatedId = `ke-option-${variableIndex + 1}-${optionIndex + 1}`;
        while (usedIds.has(generatedId)) generatedId += 'x';
        usedIds.add(generatedId);
        if (typeof option.id === 'string' && option.id.length > 0) {
          if (remap.has(option.id)) ambiguous.add(option.id);
          else remap.set(option.id, generatedId);
        }
        return { ...option, id: generatedId };
      });
      for (const id of ambiguous) remap.delete(id);
      if (remap.size) remaps.set(value.id, remap);
    }
    return variable;
  });

  const rewriteValue = (value: unknown, variableId: unknown): unknown => {
    if (!record(value) || typeof variableId !== 'string') return value;
    const remap = remaps.get(variableId);
    if (!remap) return value;
    if (value.type === 'ENUM' && typeof value.optionId === 'string' && remap.has(value.optionId))
      return { ...value, optionId: remap.get(value.optionId) };
    if (value.type === 'ENUM_SET' && Array.isArray(value.optionIds))
      return { ...value, optionIds: value.optionIds.map(id => typeof id === 'string' ? remap.get(id) ?? id : id) };
    return value;
  };
  const normalizedRules = rules.map(value => {
    if (!record(value)) return value;
    const rule: Record<string, unknown> = { ...value };
    for (const field of ['value', 'minimum', 'maximum']) {
      if (Object.hasOwn(value, field)) rule[field] = rewriteValue(value[field], value.variableId);
    }
    if (Array.isArray(value.values)) rule.values = value.values.map(item => rewriteValue(item, value.variableId));
    for (const field of ['antecedent', 'consequent']) {
      const condition = value[field];
      if (record(condition)) rule[field] = { ...condition, value: rewriteValue(condition.value, condition.variableId) };
    }
    return rule;
  });
  return { variables: normalizedVariables, rules: normalizedRules };
}
async function token(id: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Produces a public frame draft only. It neither persists a decision nor
 * confirms a frame; the generic application remains the authority for that.
 */
export class DecisionArchitect {
  private readonly active = new Map<string, number>();
  private sequence = 0;

  constructor(private readonly model: DecisionArchitectModel, private readonly id: () => string, private readonly now: () => number = Date.now,
    private readonly isEnabled: () => boolean = () => true) {}

  async draft(actorSubject: string, request: DecisionArchitectRequest): Promise<DecisionArchitectureDraft> {
    if (!Id.safeParse(actorSubject).success || !Id.safeParse(request?.draftId).success
      || !Number.isSafeInteger(request?.revision) || request.revision < 1
      || typeof request?.objective !== 'string' || request.objective.trim().length === 0
      || request.objective.length > 2_000 || !Array.isArray(request.participants)
      || request.participants.length < 1 || request.participants.length > 20
      || !Array.isArray(request.allowedOptions) || request.allowedOptions.length > MAX_OPTIONS) fail('INVALID_COMMAND');

    const participants = request.participants.map(person => ({ id: person?.id, displayName: person?.displayName }));
    const participantIds = participants.map(person => person.id);
    if (participants.some(person => !Id.safeParse(person.id).success || typeof person.displayName !== 'string'
      || person.displayName.trim().length === 0 || person.displayName.length > 80)
      || new Set(participantIds).size !== participantIds.length) fail('INVALID_COMMAND');
    const allowedOptions = request.allowedOptions.map(option => typeof option === 'string' ? option.trim() : '');
    if (allowedOptions.some(option => option.length === 0 || option.length > 120)
      || new Set(allowedOptions.map(option => option.toLowerCase())).size !== allowedOptions.length) fail('INVALID_COMMAND');

    const key = `${actorSubject}:${request.draftId}`;
    if (!this.active.has(key) && this.active.size >= MAX_ACTIVE_DRAFTS) fail('RETRYABLE_SERVER_ERROR');
    const generation = ++this.sequence;
    this.active.set(key, generation);

    const invocation: ModelInvocation = {
      expiresAt: this.now() + 30_000,
      assertCurrent: async () => {
        if (!this.isEnabled() || this.active.get(key) !== generation || this.now() >= invocation.expiresAt) fail('STALE_CONTEXT');
      },
    };
    try {
      let output: unknown;
      try {
        output = await this.model.draft({
          objective: request.objective.trim(),
          participants: participants as DecisionArchitectParticipant[],
          allowedOptions,
        }, invocation);
      } catch {
        fail('RETRYABLE_SERVER_ERROR');
      }
      if (this.active.get(key) !== generation) fail('STALE_CONTEXT');
      if (typeof output === 'string') {
        if (new TextEncoder().encode(output).byteLength > 256 * 1024) fail('RETRYABLE_SERVER_ERROR');
        try { output = JSON.parse(output) as unknown; } catch { fail('RETRYABLE_SERVER_ERROR'); }
      }
      let serialized: string | undefined;
      try { serialized = JSON.stringify(output); } catch { fail('RETRYABLE_SERVER_ERROR'); }
      if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > 256 * 1024)
        fail('RETRYABLE_SERVER_ERROR');
      try { output = JSON.parse(serialized) as unknown; } catch { fail('RETRYABLE_SERVER_ERROR'); }
      if (!record(output) || !sameKeys(output, MODEL_FIELDS)
        || typeof output.title !== 'string' || output.title.trim().length === 0 || output.title.length > 160
        || typeof output.description !== 'string' || output.description.length > 4_000
        || !Array.isArray(output.variables) || !Array.isArray(output.rules)
        || !boundedStrings(output.clarificationQuestions, MAX_QUESTIONS, 500)
        || !Array.isArray(output.participantInformationRequirements)
        || output.participantInformationRequirements.length > MAX_REQUIREMENTS) fail('RETRYABLE_SERVER_ERROR');

      const knownParticipants = new Set(participantIds);
      const requirements: { participantId: string; prompt: string }[] = [];
      for (const item of output.participantInformationRequirements) {
        if (!record(item) || !sameKeys(item, ['kind', 'participantId'])
          || typeof item.participantId !== 'string' || !knownParticipants.has(item.participantId)
          || typeof item.kind !== 'string' || !Object.hasOwn(REQUIREMENT_PROMPTS, item.kind))
          fail('RETRYABLE_SERVER_ERROR');
        requirements.push({ participantId: item.participantId, prompt: REQUIREMENT_PROMPTS[item.kind]! });
      }

      const normalized = normalizePublicModelFields(output.variables, output.rules);
      const definition = KE.DecisionDefinition.safeParse({
        schemaVersion: KE.KE_SCHEMA_VERSION,
        decisionId: Id.parse(this.id()),
        frameVersion: 1,
        semanticVersion: 1,
        contextToken: await token(Id.parse(this.id())),
        title: output.title,
        objective: request.objective.trim(),
        description: output.description,
        participants: participants.map(person => ({ ...person, requiredForApproval: true })),
        requiredParticipantIds: participantIds,
        variables: normalized.variables,
        rules: normalized.rules,
      });
      if (!definition.success
        || definition.data.variables.some(variable => variable.visibility !== 'PUBLIC')
        || definition.data.rules.some(rule => rule.visibility !== 'PUBLIC')) fail('RETRYABLE_SERVER_ERROR');

      const allowed = new Set(allowedOptions.map(option => option.toLowerCase()));
      for (const variable of definition.data.variables) {
        if (variable.type === 'ENUM' || variable.type === 'ENUM_SET') {
          if (variable.options.some(option => !allowed.has(option.label.toLowerCase()))) fail('RETRYABLE_SERVER_ERROR');
        }
      }

      const frame = KE.PublicDecisionFrame.parse({
        ...definition.data,
        variables: definition.data.variables.map(variable => {
          const { ownerParticipantId, ...publicVariable } = variable;
          void ownerParticipantId;
          return publicVariable;
        }),
      });

      await invocation.assertCurrent();
      return {
        draftId: request.draftId,
        revision: request.revision,
        status: output.clarificationQuestions.length ? 'NEEDS_CLARIFICATION' : 'DEFINING',
        frame,
        clarificationQuestions: [...output.clarificationQuestions],
        participantInformationRequirements: requirements,
      };
    } finally {
      if (this.active.get(key) === generation) this.active.delete(key);
    }
  }
}
