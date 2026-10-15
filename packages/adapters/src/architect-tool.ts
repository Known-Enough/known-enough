import { ArchitectOutput } from '@deal-table/contracts';
import { modelValidationIssues } from '@deal-table/application';
import type { ModelValidationIssue } from '@deal-table/application';
import { z } from 'zod';

/** Keep Nova's top-level schema to its documented three supported fields. */
export function architectToolSchema(): { type: string; properties: Record<string, unknown>; required: string[] } {
  const json = z.toJSONSchema(ArchitectOutput.Output, { unrepresentable: 'throw', reused: 'inline' });
  // Singleton enums use the same ordinary enum syntax as the other tool fields.
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => key === 'const'
      ? [['enum', [item]]] : [[key, normalize(item)]]));
  };
  return { type: 'object', properties: normalize(json.properties) as Record<string, unknown>, required: json.required ?? [] };
}

export class ArchitectWireError extends Error {
  constructor(readonly validation: ModelValidationIssue[]) { super('ARCHITECT_WIRE_SCHEMA'); }
}

/** Decode structure only; never infer missing choices, restrictions, ownership or consent. */
export function decodeArchitectOutput(value: unknown, selected: boolean): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  // Canonical arrays from existing internal model ports remain application-validated.
  // A mixed new/legacy envelope cannot fall through this compatibility path.
  if (Array.isArray(input.rules) && (selected || Array.isArray(input.variables))) return value;
  const parsed = (selected ? ArchitectOutput.SelectedOutput : ArchitectOutput.Output).safeParse(value);
  if (!parsed.success) throw new ArchitectWireError(modelValidationIssues(parsed.error.issues, value));
  const output = parsed.data as Record<string, unknown>;
  const flatten = (groups: unknown, definitions: readonly { tag: string }[], discriminator: string) => {
    const values = groups as Record<string, Record<string, unknown>[] | undefined>;
    return definitions.flatMap(group => (values[group.tag] ?? []).map(item => ({ ...item,
      [discriminator]: group.tag, visibility: 'PUBLIC', ...(discriminator === 'type' ? { ownerParticipantId: null } : {}) })));
  };
  return { ...output,
    ...(!selected ? { variables: flatten(output.variables, ArchitectOutput.VariableGroups, 'type') } : {}),
    rules: flatten(output.rules, ArchitectOutput.RuleGroups, 'operator') };
}
