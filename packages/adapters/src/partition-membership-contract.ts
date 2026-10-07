import { z } from 'zod';

// Independent private discovery contract; the current header remains authorization.
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const PartitionMembershipRow = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('MEMBERSHIP'),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  value: z.strictObject({ subject: id, groupId: id, active: z.boolean() }) });
export type PartitionMembershipRow = z.infer<typeof PartitionMembershipRow>;
export const partitionMembershipKey = (subject: string, groupId: string) => ({
  PK: `MEMBER#${id.parse(subject)}`, SK: `GROUP#${id.parse(groupId)}`,
});
export const isPartitionMembershipKey = (key: { PK: string; SK: string }) =>
  /^MEMBER#[A-Za-z0-9_-]{1,80}$/.test(key.PK) && /^GROUP#[A-Za-z0-9_-]{1,80}$/.test(key.SK);
