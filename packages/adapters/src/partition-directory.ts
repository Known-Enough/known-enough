import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
/** Private immutable lookup facts, never participant authorization or public snapshots. */
export const PartitionDirectoryClaim = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('EMAIL'), emailHash: hash, subject: id }),
  z.strictObject({ type: z.literal('INVITATION'), tokenHash: hash, groupId: id, recipientHash: hash,
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
  z.strictObject({ type: z.literal('DECISION'), decisionId: id, groupId: id }),
]);
export type PartitionDirectoryClaim = z.infer<typeof PartitionDirectoryClaim>;
export const PartitionDirectoryLookup = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('EMAIL'), emailHash: hash }),
  z.strictObject({ type: z.literal('INVITATION'), tokenHash: hash }),
  z.strictObject({ type: z.literal('DECISION'), decisionId: id }),
]);
export type PartitionDirectoryLookup = z.infer<typeof PartitionDirectoryLookup>;
export const PartitionDirectoryRow = z.strictObject({ schemaVersion: z.literal(1),
  revision: z.literal(1), kind: z.literal('DIRECTORY'), value: PartitionDirectoryClaim });
export function partitionDirectoryKey(raw: PartitionDirectoryClaim | PartitionDirectoryLookup): { PK: string; SK: string } {
  const full = PartitionDirectoryClaim.safeParse(raw);
  const claim = full.success ? full.data : PartitionDirectoryLookup.parse(raw);
  return claim.type === 'EMAIL' ? { PK: `EMAIL#${claim.emailHash}`, SK: 'CLAIM' }
    : claim.type === 'INVITATION' ? { PK: `INVITATION#${claim.tokenHash}`, SK: 'TARGET' }
    : { PK: `DECISION#${claim.decisionId}`, SK: 'GROUP' };
}
export function isPartitionDirectoryKey(key: { PK: string; SK: string }): boolean {
  return (/^EMAIL#[a-f0-9]{64}$/.test(key.PK) && key.SK === 'CLAIM')
    || (/^INVITATION#[a-f0-9]{64}$/.test(key.PK) && key.SK === 'TARGET')
    || (/^DECISION#[A-Za-z0-9_-]{1,80}$/.test(key.PK) && key.SK === 'GROUP');
}
