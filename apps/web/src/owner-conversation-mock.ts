export interface LocalOwnerDraft {
  status: 'DRAFT' | 'NEEDS_CLARIFICATION';
  hardLimits: string[];
  preferences: string[];
  negotiableConditions: string[];
  clarificationQuestions: string[];
}

export type LocalOwnerInterpreter = (statement: string) => Promise<unknown>;

export const LOCAL_OWNER_SAMPLE = 'My hard maximum is $2,000. I prefer to stay at or below $1,500. I can flex up to $2,000 for a direct flight. My synthetic private reason is a personal loan; keep that reason private.';

const sampleDraft: LocalOwnerDraft = {
  status: 'DRAFT',
  hardLimits: ['Total budget cannot exceed $2,000.'],
  preferences: ['Prefer a total at or below $1,500.'],
  negotiableConditions: ['The amount above $1,500 is negotiable only for a direct flight, and never above $2,000.'],
  clarificationQuestions: [],
};

const fallbackDraft: LocalOwnerDraft = {
  status: 'NEEDS_CLARIFICATION', hardLimits: [], preferences: [], negotiableConditions: [],
  clarificationQuestions: ['This local fixture cannot safely interpret that wording. Please rewrite it as one clear hard limit, preference, or conditional trade-off.'],
};

/** Finite synthetic fixture; arbitrary text is never sent to a model or network. */
export const localOwnerInterpreter: LocalOwnerInterpreter = async statement => {
  await Promise.resolve();
  return statement.trim() === LOCAL_OWNER_SAMPLE ? structuredClone(sampleDraft) : structuredClone(fallbackDraft);
};

export function validateLocalOwnerDraft(value: unknown): LocalOwnerDraft | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join('|') !== 'clarificationQuestions|hardLimits|negotiableConditions|preferences|status'
    || (raw.status !== 'DRAFT' && raw.status !== 'NEEDS_CLARIFICATION')) return null;
  const lists = [raw.hardLimits, raw.preferences, raw.negotiableConditions, raw.clarificationQuestions];
  if (lists.some(list => !Array.isArray(list) || list.length > 8
    || !list.every(item => typeof item === 'string' && item.length > 0 && item.length <= 500))) return null;
  return {
    status: raw.status,
    hardLimits: [...raw.hardLimits as string[]], preferences: [...raw.preferences as string[]],
    negotiableConditions: [...raw.negotiableConditions as string[]],
    clarificationQuestions: [...raw.clarificationQuestions as string[]],
  };
}
