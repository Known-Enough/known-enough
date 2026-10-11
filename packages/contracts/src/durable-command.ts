import { z } from 'zod';
import { Id, Version } from './index.ts';
import { KE_SCHEMA_VERSION, PublicDecisionFrame } from './known-enough.ts';
/** Compatible response-media profile; it describes transport and grants no authority. */
export const BACKGROUND_NEGOTIATION_PROFILE = 'urn:known-enough:background-negotiation';
/** Isolated participant DTO; no provider options, subject or private queue reference. */
export const RequestNegotiation = z.strictObject({ schemaVersion: z.literal(KE_SCHEMA_VERSION),
  type: z.literal('REQUEST_NEGOTIATION'), requestId: Id, decisionId: Id,
  expected: z.strictObject({ contextToken: PublicDecisionFrame.shape.contextToken, semanticVersion: Version, controlVersion: Version }) });
export const NegotiationReceipt = z.strictObject({ jobId: z.string().uuid(), state: z.literal('QUEUED'), expiresAt: z.string().datetime() });
