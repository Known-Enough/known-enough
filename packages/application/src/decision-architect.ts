import { reportModelFailure, modelValidationIssues, type ModelValidationIssue, type ModelInvocation, type ModelFailureDiagnostic } from './model-runtime.ts';
import { Id, ChoicePlan, compileChoicePlan, KnownEnough as KE } from '@deal-table/contracts';
import type { KnownEnough as KETypes } from '@deal-table/contracts';

export interface DecisionArchitectParticipant {
  id: string;
  displayName: string;
}

export interface PublicDraftFollowUp {
  previousFrame: KETypes.PublicDecisionFrame;
  answers: { question: string; answer: string }[];
}
export interface DecisionArchitectRequest {
  draftId: string;
  revision: number;
  objective: string;
  participants: readonly DecisionArchitectParticipant[];
  allowedOptions: readonly string[];
  /** Server-owned public definitions, never private values or participant authority. */
  publicVariables?: readonly KETypes.PublicDecisionVariable[];
  /** Explicit general-draft mode: propose new bounded public option labels for participant review. */
  generateOptions?: boolean;
  followUp?: PublicDraftFollowUp;
  choiceContext?: ChoicePlan;
}

export interface DecisionArchitectModelInput {
  objective: string;
  participants: readonly DecisionArchitectParticipant[];
  allowedOptions: readonly string[];
  publicVariables?: readonly KETypes.PublicDecisionVariable[];
  /** Explicit general-draft mode: propose new bounded public option labels for participant review. */
  generateOptions?: boolean;
  followUp?: PublicDraftFollowUp;
  choiceContext?: ChoicePlan;
}

/** A model port is injected by the caller. Raw output is always treated as untrusted. */
export interface DecisionArchitectModel {
  draft(input: DecisionArchitectModelInput, invocation?: ModelInvocation): Promise<unknown>;
}

export type DecisionArchitectureDraft = {
  choicePlan?: ChoicePlan;
  draftId: string;
  revision: number;
  status: 'DEFINING' | 'NEEDS_CLARIFICATION';
  frame: KETypes.PublicDecisionFrame;
  clarificationQuestions: string[];
  participantInformationRequirements: { participantId: string; prompt: string }[];
};

export type DecisionArchitectErrorCode = 'INVALID_COMMAND' | 'STALE_CONTEXT' | 'RETRYABLE_SERVER_ERROR';

/** A local public label, independent of AI output and stable decision identity. */
function shortPublicTitle(idea: string): string {
  const words = idea.match(/[\p{L}\p{N}][\p{L}\p{N}'’–-]*/gu) ?? [];
  const filler = new Set(['i', 'we', 'our', 'a', 'an', 'the', 'to', 'would', 'like', 'want', 'need', 'let', "let's", 'let’s', 'us', 'please', 'help', 'decide', 'choose', 'have', 'for', 'of', 'together', 'and', 'or', 'is', 'are', 'on', 'at', 'in', 'with', 'which', 'what', 'where', 'should', 'can', 'you']);
  const meaningful = words.filter(word => !filler.has(word.toLocaleLowerCase('en-US')));
  return (meaningful.length ? meaningful : words).slice(0, 3).join(' ').slice(0, 80) || 'New group decision';
}

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
/** Tool literals are text; only the referenced public variable determines their type and units. */
function publicLiteral(value: unknown, variable: Record<string, unknown> | undefined): unknown {
  if (typeof value !== 'string' || value.length > 2048 || !variable) return value; // Existing typed/injected ports stay compatible.
  const integer = (text: string) => /^-?(0|[1-9]\d*)$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : undefined;
  const scaled = (places: unknown) => {
    if (!Number.isInteger(places) || Number(places) < 0 || Number(places) > 6 || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) return undefined;
    const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
    if (fraction.length > Number(places)) return undefined;
    const amount = BigInt((whole ?? '') + fraction.padEnd(Number(places), '0')) * (value.startsWith('-') ? -1n : 1n);
    return amount >= BigInt(Number.MIN_SAFE_INTEGER) && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : undefined;
  };
  let result: unknown;
  switch (variable.type) {
    case 'DATE': result = { type: 'DATE', date: value }; break;
    case 'DATETIME': result = { type: 'DATETIME', instant: value, displayTimeZone: variable.displayTimeZone }; break;
    case 'ENUM': result = { type: 'ENUM', optionId: value }; break;
    case 'PARTICIPANT': result = { type: 'PARTICIPANT', participantId: value }; break;
    case 'ENUM_SET': {
      try { result = { type: 'ENUM_SET', optionIds: JSON.parse(value) }; } catch { return value; }
      break;
    }
    case 'BOOLEAN': if (value !== 'true' && value !== 'false') return value; result = { type: 'BOOLEAN', value: value === 'true' }; break;
    case 'NUMBER': result = { type: 'NUMBER', coefficient: scaled(variable.scale), scale: variable.scale, unitCode: variable.unitCode }; break;
    case 'MONEY': result = { type: 'MONEY', amountMinor: scaled(variable.minorUnit), currencyCode: variable.currencyCode, minorUnit: variable.minorUnit }; break;
    case 'PERCENTAGE': result = { type: 'PERCENTAGE', basisPoints: integer(value) }; break;
    case 'DURATION': result = { type: 'DURATION', seconds: integer(value) }; break;
    default: return value;
  }
  const parsed = KE.DecisionValue.safeParse(result);
  return parsed.success ? parsed.data : value; // Malformed text still fails the unchanged strict definition validator.
}
function normalizePublicModelFields(variables: unknown[], rules: unknown[]): { variables: unknown[]; rules: unknown[] } {
  const remaps = new Map<string, Map<string, string>>();
  const domainRules: unknown[] = [];
  const usedRuleIds = new Set(rules.flatMap(rule => record(rule) && typeof rule.id === 'string' ? [rule.id] : []));
  const normalizedVariables = variables.map((value, variableIndex) => {
    if (!record(value) || value.visibility !== 'PUBLIC') return value;
    const variable: Record<string, unknown> = { ...value, ownerParticipantId: null };
    if (Object.hasOwn(value, 'allowedValues')) {
      if (!Array.isArray(value.allowedValues) || value.allowedValues.length > 32) return value;
      delete variable.allowedValues;
      if (value.allowedValues.length) {
        let ruleId = `ke-domain-${variableIndex + 1}`;
        while (usedRuleIds.has(ruleId)) ruleId += 'x';
        usedRuleIds.add(ruleId);
        domainRules.push({ id: ruleId, visibility: 'PUBLIC', operator: 'IN', variableId: value.id,
          values: value.allowedValues.map(item => publicLiteral(item, value)) });
      }
    }
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
    if (typeof variableId !== 'string') return value;
    const variable = variables.find(item => record(item) && item.id === variableId);
    value = publicLiteral(value, record(variable) ? variable : undefined);
    if (!record(value)) return value;
    const remap = remaps.get(variableId);
    if (!remap) return value;
    if (value.type === 'ENUM' && typeof value.optionId === 'string' && remap.has(value.optionId))
      return { ...value, optionId: remap.get(value.optionId) };
    if (value.type === 'ENUM_SET' && Array.isArray(value.optionIds))
      return { ...value, optionIds: value.optionIds.map(id => typeof id === 'string' ? remap.get(id) ?? id : id) };
    return value;
  };
  const normalizedRules = [...rules, ...domainRules].map(value => {
    if (!record(value)) return value;
    const rule: Record<string, unknown> = { ...value };
    for (const field of ['value', 'minimum', 'maximum']) {
      if (Object.hasOwn(value, field)) rule[field] = rewriteValue(value[field], value.variableId);
    }
    if (Object.hasOwn(value, 'target') && Array.isArray(value.variableIds)) rule.target = rewriteValue(value.target, value.variableIds[0]);
    if (Array.isArray(value.values)) rule.values = value.values.map(item => rewriteValue(item, value.variableId));
    for (const field of ['antecedent', 'consequent']) {
      const condition = value[field];
      if (record(condition)) rule[field] = { ...condition, value: rewriteValue(condition.value, condition.variableId) };
    }
    return rule;
  });
  return { variables: normalizedVariables, rules: normalizedRules };
}
type ArchitectQuestion = string | { question: string; purpose: 'PUBLIC_SCOPE' | 'PRIVATE_NEED'; variableId: string };
function questionsValid(value: unknown): value is ArchitectQuestion[] {
  return Array.isArray(value) && value.length <= MAX_QUESTIONS && value.every(item =>
    typeof item === 'string' ? boundedStrings([item], 1, 500) // Existing injected model ports remain compatible.
      : record(item) && sameKeys(item, ['purpose', 'question', 'variableId'])
        && boundedStrings([item.question], 1, 500) && ['PUBLIC_SCOPE', 'PRIVATE_NEED'].includes(String(item.purpose))
        && typeof item.variableId === 'string' && (item.variableId === '' || Id.safeParse(item.variableId).success));
}
function publicQuestions(questions: ArchitectQuestion[], frame: KETypes.PublicDecisionFrame): string[] {
  const boundedChoice = (variable: KETypes.PublicDecisionFrame['variables'][number]) =>
    ['ENUM', 'BOOLEAN', 'PARTICIPANT'].includes(variable.type)
    || variable.type === 'ENUM_SET' && variable.options.length <= 6
    || frame.rules.some(rule => 'variableId' in rule && rule.variableId === variable.id
      && (rule.operator === 'IN' || rule.operator === 'COMPARE' && rule.comparison === 'EQ'));
  const choicesSpecified = frame.variables.length > 0 && frame.variables.every(boundedChoice);
  return questions.flatMap(item => {
    if (typeof item === 'string') return choicesSpecified ? [] : [item];
    if (item.purpose === 'PRIVATE_NEED') return [];
    if (item.variableId) {
      const variable = frame.variables.find(value => value.id === item.variableId);
      if (!variable) fail('RETRYABLE_SERVER_ERROR');
      if (boundedChoice(variable)) return [];
    } else if (choicesSpecified) return [];
    // These are draft choices for explicit review, not selected values or agreement.
    // The candidate catalog separately enforces size, completeness and feasibility.
    return [item.question];
  });
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
    private readonly isEnabled: () => boolean = () => true,
    private readonly diagnostic?: (value: ModelFailureDiagnostic) => void) {}

  private rejectModel(stage: ModelFailureDiagnostic['stage'], validation?: ModelValidationIssue[]): never {
    reportModelFailure(this.diagnostic, 'ARCHITECT', stage, validation);
    return fail('RETRYABLE_SERVER_ERROR');
  }

  async draft(actorSubject: string, request: DecisionArchitectRequest): Promise<DecisionArchitectureDraft> {
    if (!Id.safeParse(actorSubject).success || !Id.safeParse(request?.draftId).success
      || !Number.isSafeInteger(request?.revision) || request.revision < 1
      || typeof request?.objective !== 'string' || request.objective.trim().length === 0
      || request.objective.length > 2_000 || !Array.isArray(request.participants)
      || request.participants.length < 1 || request.participants.length > 20
      || !Array.isArray(request.allowedOptions) || request.allowedOptions.length > MAX_OPTIONS) fail('INVALID_COMMAND');

    if (request.followUp && (!KE.PublicDecisionFrame.safeParse(request.followUp.previousFrame).success
      || !Array.isArray(request.followUp.answers) || request.followUp.answers.length > 36
      || request.followUp.answers.some(item => typeof item.question !== 'string' || !item.question || item.question.length > 500
        || typeof item.answer !== 'string' || !item.answer.trim() || item.answer.length > 500))) fail('INVALID_COMMAND');
    const participants = request.participants.map(person => ({ id: person?.id, displayName: person?.displayName }));
    const participantIds = participants.map(person => person.id);
    if (participants.some(person => !Id.safeParse(person.id).success || typeof person.displayName !== 'string'
      || person.displayName.trim().length === 0 || person.displayName.length > 80)
      || new Set(participantIds).size !== participantIds.length) fail('INVALID_COMMAND');
    const allowedOptions = request.allowedOptions.map(option => typeof option === 'string' ? option.trim() : '');
    if (allowedOptions.some(option => option.length === 0 || option.length > 120)
      || new Set(allowedOptions.map(option => option.toLowerCase())).size !== allowedOptions.length) fail('INVALID_COMMAND');

    let publicVariables: KETypes.PublicDecisionVariable[] | undefined;
    if (request.publicVariables !== undefined) {
      if (!Array.isArray(request.publicVariables) || request.publicVariables.length < 1
        || request.publicVariables.length > KE.MAX_DECISION_VARIABLES) fail('INVALID_COMMAND');
      publicVariables = request.publicVariables.map(variable => {
        const parsed = KE.PublicDecisionVariable.safeParse(variable);
        if (!parsed.success || parsed.data.visibility !== 'PUBLIC') fail('INVALID_COMMAND');
        return parsed.data;
      });
      const allowed = new Set(allowedOptions.map(option => option.toLowerCase()));
      if (new Set(publicVariables.map(variable => variable.id)).size !== publicVariables.length
        || publicVariables.some(variable => (variable.type === 'ENUM' || variable.type === 'ENUM_SET')
          && variable.options.some(option => !allowed.has(option.label.toLowerCase())))) fail('INVALID_COMMAND');
    }

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
      let choicePlan: ChoicePlan | undefined;
      try {
        output = await this.model.draft({
          objective: request.objective.trim(),
          participants: participants as DecisionArchitectParticipant[],
          allowedOptions,
          ...(request.choiceContext ? { choiceContext: ChoicePlan.parse(request.choiceContext) } : {}),
          ...(request.followUp ? { followUp: structuredClone(request.followUp) } : {}),
          ...(request.generateOptions === true ? { generateOptions: true } : {}),
          ...(publicVariables ? { publicVariables: structuredClone(publicVariables) } : {}),
        }, invocation);
      } catch {
        this.rejectModel('ARCHITECT_CALL');
      }
      if (this.active.get(key) !== generation) fail('STALE_CONTEXT');
      if (typeof output === 'string') {
        if (new TextEncoder().encode(output).byteLength > 256 * 1024) {
          this.rejectModel('ARCHITECT_FIELDS');
        }
        try { output = JSON.parse(output) as unknown; } catch {
          this.rejectModel('ARCHITECT_FIELDS');
        }
      }
      let serialized: string | undefined;
      try { serialized = JSON.stringify(output); } catch {
        this.rejectModel('ARCHITECT_FIELDS');
      }
      if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > 256 * 1024) {
        this.rejectModel('ARCHITECT_FIELDS');
      }
      try { output = JSON.parse(serialized) as unknown; } catch {
        this.rejectModel('ARCHITECT_FIELDS');
      }
      if (record(output) && Object.keys(output).join('|') === 'choicePlan') {
        const parsed = ChoicePlan.safeParse(output.choicePlan);
        if (!parsed.success) this.rejectModel('ARCHITECT_FIELDS');
        choicePlan = parsed.data;
        if (request.choiceContext?.topics.length) {
          const previous = ChoicePlan.parse(request.choiceContext);
          choicePlan = ChoicePlan.parse({ ...choicePlan, title: previous.title.trim() || choicePlan.title,
            topics: previous.topics.map((topic, index) => {
              const suggestion = choicePlan!.topics.find(value => value.label.trim().toLowerCase() === topic.label.trim().toLowerCase())
                ?? (!topic.label.trim() ? choicePlan!.topics[index] : undefined);
              return { label: topic.label.trim() || suggestion?.label || '', kind: topic.label.trim() ? topic.kind : suggestion?.kind ?? topic.kind,
                options: topic.options.some(value => value.trim()) ? topic.options : suggestion?.options ?? [] };
            }) });
        }
        choicePlan = { ...choicePlan, title: choicePlan.title.trim() || shortPublicTitle(request.objective) };
        const compiled = compileChoicePlan(choicePlan);
        output = { title: choicePlan.title.trim() || request.objective.trim().split(/\s+/).slice(0, 3).join(' ').slice(0,80),
          description: choicePlan.description, variables: compiled.variables, rules: compiled.rules,
          clarificationQuestions: compiled.questions.map(question => ({ question, purpose: 'PUBLIC_SCOPE', variableId: '' })),
          participantInformationRequirements: [] };
      }
      if (!record(output) || !sameKeys(output, MODEL_FIELDS)
        || typeof output.title !== 'string' || output.title.trim().length === 0 || output.title.length > 160
        || typeof output.description !== 'string' || output.description.length > 4_000
        || !Array.isArray(output.variables) || !Array.isArray(output.rules)
        || !questionsValid(output.clarificationQuestions)
        || !Array.isArray(output.participantInformationRequirements)
        || output.participantInformationRequirements.length > MAX_REQUIREMENTS) {
        const shape = record(output) ? output : {};
        const fields = MODEL_FIELDS.filter(field => !Object.hasOwn(shape, field)
          || ['variables', 'rules', 'clarificationQuestions', 'participantInformationRequirements'].includes(field) && !Array.isArray(shape[field])
          || ['title', 'description'].includes(field) && typeof shape[field] !== 'string');
        this.rejectModel('ARCHITECT_FIELDS', modelValidationIssues(fields.length ? fields.map(field => ({ code: 'invalid_type', path: [field],
          expected: ['title', 'description'].includes(field) ? 'string' : 'array' })) : [{ code: 'custom', path: [] }], output));
      }

      const knownParticipants = new Set(participantIds);
      const requirements: { participantId: string; prompt: string }[] = [];
      for (const item of output.participantInformationRequirements) {
        if (!record(item) || !sameKeys(item, ['kind', 'participantId'])
          || typeof item.participantId !== 'string' || !knownParticipants.has(item.participantId)
          || typeof item.kind !== 'string' || !Object.hasOwn(REQUIREMENT_PROMPTS, item.kind))
          this.rejectModel('ARCHITECT_REQUIREMENTS', modelValidationIssues([{ code: 'custom', path: ['participantInformationRequirements', requirements.length] }], output));
        requirements.push({ participantId: item.participantId, prompt: REQUIREMENT_PROMPTS[item.kind]! });
      }

      const normalized = normalizePublicModelFields(output.variables, output.rules);
      const definitionValue = {
        schemaVersion: KE.KE_SCHEMA_VERSION,
        decisionId: Id.parse(this.id()),
        frameVersion: 1,
        semanticVersion: 1,
        contextToken: await token(Id.parse(this.id())),
        title: choicePlan?.title || shortPublicTitle(request.objective),
        objective: request.objective.trim(),
        description: output.description,
        participants: participants.map(person => ({ ...person, requiredForApproval: true })),
        requiredParticipantIds: participantIds,
        variables: normalized.variables,
        rules: normalized.rules,
      };
      const definition = KE.DecisionDefinition.safeParse(definitionValue);
      if (!definition.success) {
        const validation = modelValidationIssues(definition.error.issues, definitionValue);
        const roots = definition.error.issues.map(issue => issue.path[0]);
        if (roots.every(root => root === 'rules')) {
          if (normalized.rules.some(rule => !KE.ValidationRule.safeParse(rule).success)) this.rejectModel('ARCHITECT_RULE_FIELDS', validation);
          if (definition.error.issues.some(issue => issue.message === 'Rule references an unknown variable')) this.rejectModel('ARCHITECT_RULE_REFERENCE', validation);
          if (definition.error.issues.some(issue => issue.message === 'Rule value does not match the referenced variable type or domain')) this.rejectModel('ARCHITECT_RULE_VALUE', validation);
          if (definition.error.issues.some(issue => /unique|duplicate/i.test(issue.message))) this.rejectModel('ARCHITECT_RULE_DUPLICATE', validation);
          this.rejectModel('ARCHITECT_SCHEMA_RULES', validation);
        }
        this.rejectModel(roots.every(root => root === 'variables') ? 'ARCHITECT_SCHEMA_VARIABLES' : 'ARCHITECT_SCHEMA_OTHER', validation);
      }
      if (definition.data.variables.some(variable => variable.visibility !== 'PUBLIC')
        || definition.data.rules.some(rule => rule.visibility !== 'PUBLIC')) {
        this.rejectModel('ARCHITECT_PRIVATE_FIELDS');
      }

      if (publicVariables) {
        // Compare complete validated public definitions by ID; never silently repair model-selected identities/types.
        const received = new Map(definition.data.variables.map(variable => {
          const { ownerParticipantId, ...publicVariable } = variable;
          void ownerParticipantId;
          return [variable.id, publicVariable] as const;
        }));
        if (received.size !== publicVariables.length || publicVariables.some(variable => {
          const parsed = KE.PublicDecisionVariable.safeParse(received.get(variable.id));
          return !parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(variable);
        })) {
          this.rejectModel('ARCHITECT_PUBLIC_SCHEMA');
        }
      }

      const allowed = new Set(allowedOptions.map(option => option.toLowerCase()));
      for (const variable of definition.data.variables) {
        if (variable.type === 'ENUM' || variable.type === 'ENUM_SET') {
          if (request.generateOptions !== true && variable.options.some(option => !allowed.has(option.label.toLowerCase()))) {
            this.rejectModel('ARCHITECT_OPTIONS');
          }
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

      const clarificationQuestions = choicePlan ? compileChoicePlan(choicePlan).questions : publicQuestions(output.clarificationQuestions, frame);
      await invocation.assertCurrent();
      return {
        ...(choicePlan ? { choicePlan } : {}),
        draftId: request.draftId,
        revision: request.revision,
        status: clarificationQuestions.length ? 'NEEDS_CLARIFICATION' : 'DEFINING',
        frame,
        clarificationQuestions,
        participantInformationRequirements: requirements,
      };
    } finally {
      if (this.active.get(key) === generation) this.active.delete(key);
    }
  }
}
