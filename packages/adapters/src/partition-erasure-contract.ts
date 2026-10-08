import { z } from 'zod';
// Private fail-closed marker. Ordinary repositories cannot read/use a half-erased account.
export const ErasingAccount = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('ERASING_ACCOUNT'),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), subject: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  accountVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), opId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  planHash: z.string().regex(/^[a-f0-9]{64}$/) });
