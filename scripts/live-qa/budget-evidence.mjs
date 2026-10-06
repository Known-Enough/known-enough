const fields = ['attempts', 'reservedTokens', 'reservedCostMicros', 'maxAttemptsPerRun', 'maxTokensPerRun', 'maxCostMicrosPerRun'];
// Aggregate reservation evidence only; absent or malformed observations remain unknown.
export function safeBudgetEvidence(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) return null;
    if (fields.some(key => !Number.isSafeInteger(value[key]) || value[key] < (key.startsWith('max') ? 1 : 0))) return null;
    return Object.fromEntries(fields.map(key => [key, value[key]]));
}
