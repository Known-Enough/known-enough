const kinds = ['ARCHITECT', 'OWNER', 'NEGOTIATION'];
const stages = ['PROVIDER', 'TOOL_ENVELOPE', 'TOOL_OUTPUT', 'ARCHITECT_CALL', 'ARCHITECT_FIELDS', 'ARCHITECT_REQUIREMENTS', 'ARCHITECT_DEFINITION', 'ARCHITECT_OPTIONS', 'ARCHITECT_PUBLIC_SCHEMA', 'SCENARIO_DEFINITION', 'SCENARIO_CLARIFICATION', 'SCENARIO_PERSISTENCE', 'SCENARIO_READBACK', 'NEGOTIATION_KERNEL_REJECTION', 'NEGOTIATION_OUTPUT_ENVELOPE', 'NEGOTIATION_QUESTION_INTENTS', 'NEGOTIATION_PUBLIC_VALUES', 'NEGOTIATION_PERMISSION_DEPENDENCIES', 'NEGOTIATION_CANDIDATE_SCHEMA', 'NEGOTIATION_CATALOG_MISMATCH', 'NEGOTIATION_VALIDATION_EXCEPTION', 'NEGOTIATION_MODEL_ERROR'];
export function safeModelFailures(values) {
  if (!Array.isArray(values)) return [];
  const result = new Map();
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== 'kind|stage' || !kinds.includes(value.kind) || !stages.includes(value.stage)) continue;
    result.set(value.kind + ':' + value.stage, { kind: value.kind, stage: value.stage });
  }
  return [...result.values()];
}
export function modelFailuresFromLogs(events) {
  const values=[];
  for (const event of Array.isArray(events) ? events : []) {
    const message=event?.message;
    if (typeof message !== 'string') continue;
    const start=message.indexOf('{');
    if (start < 0) continue;
    try {
      const value=JSON.parse(message.slice(start));
      if (value && Object.keys(value).sort().join('|') === 'event|kind|stage' && value.event === 'ke14-model-failure') values.push({kind:value.kind,stage:value.stage});
    } catch { /* Raw log messages, paths, IDs and errors never leave this parser. */ }
  }
  return safeModelFailures(values);
}
