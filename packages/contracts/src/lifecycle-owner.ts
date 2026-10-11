import { z } from 'zod';
/** Owner-only HTTP projections; private plan bytes, participant subjects and operator powers are absent. */
export const ConsentRequest = z.strictObject({ planHash: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.string().datetime(), revoked: z.boolean() });
export const ConsentReceipt = z.strictObject({ opId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), granted: z.boolean(), expiresAt: z.string().datetime() });
export const Progress = z.strictObject({ state: z.enum(['NOT_PREPARED', 'PREPARED', 'ERASING', 'ERASED']),
  nextStep: z.number().int().min(0).max(512), totalSteps: z.number().int().min(1).max(512) });
