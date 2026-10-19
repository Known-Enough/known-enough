import { z } from 'zod';
import { Identifier } from './alexa.ts';

export const RETENTION_MS = 30 * 86_400_000;
export const MAX_HISTORY_BYTES = 96_000;
export const Scope = z.enum(['group', 'private']);
export type Scope = z.infer<typeof Scope>;
export const Message = z.strictObject({
  id: Identifier, scope: Scope, ownerId: Identifier.nullable(), authorId: Identifier.nullable(),
  authorName: z.string().min(1).max(160), role: z.enum(['person', 'assistant']), text: z.string().min(1).max(4000),
  createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(), replyTo: Identifier.nullable(), askAssistant: z.boolean(),
  modelSource: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  contextToken: z.string().regex(/^[a-f0-9]{64}$/), publicRevision: z.number().int().nonnegative(),
}).refine(message => (message.scope === 'private') === (message.ownerId !== null)
  && (message.role === 'assistant') === (message.authorId === null)
  && (message.role === 'assistant') === (message.replyTo !== null)
  && (message.scope !== 'private' || message.authorId === null || message.authorId === message.ownerId)
  && (!message.askAssistant || message.role === 'person' && message.modelSource !== null)
  && Date.parse(message.expiresAt) > Date.parse(message.createdAt)
  && Date.parse(message.expiresAt) - Date.parse(message.createdAt) <= RETENTION_MS);
export type Message = z.infer<typeof Message>;
export const History = z.array(Message).max(256).refine(messages =>
  new Set(messages.map(message => message.id)).size === messages.length
  && new TextEncoder().encode(JSON.stringify(messages)).length <= MAX_HISTORY_BYTES);
export const Snapshot = z.strictObject({ decisionId: Identifier, scope: Scope, viewerId: Identifier,
  messages: History, retentionDays: z.literal(30) });
export type Snapshot = z.infer<typeof Snapshot>;
export const Post = z.strictObject({ requestId: Identifier, text: z.string().trim().min(1).max(4000),
  askAssistant: z.boolean(), processingConsent: z.literal('CHAT_AI').optional(), shareMessageId: Identifier.optional(),
}).refine(post => !post.askAssistant || post.processingConsent === 'CHAT_AI')
  .refine(post => !post.shareMessageId || !post.askAssistant);
export type Post = z.infer<typeof Post>;
export const State = z.enum(['POSTED', 'ANSWERED', 'NOT_SUBMITTED', 'PENDING', 'UNKNOWN', 'UNAVAILABLE']);
export const Receipt = z.strictObject({ requestId: Identifier, state: State, conversation: Snapshot });
export type Receipt = z.infer<typeof Receipt>;
// General conversation may use model prose; live status/approval/result facts stay server-rendered.
export const Plan = z.strictObject({
  focus: z.enum(['PROGRESS', 'OUTCOME', 'APPROVALS', 'OPTIONS', 'EXPLAIN', 'REFLECT', 'PRIVACY', 'ACTION', 'ACKNOWLEDGE', 'CONVERSATION']),
  optionIndexes: z.array(z.number().int().nonnegative().max(255)).max(3),
  question: z.enum(['NONE', 'PRIORITY', 'TRADEOFF', 'MUST_HAVE', 'FLEXIBILITY', 'COMPARE', 'NEXT_STEP']),
  answer: z.string().trim().max(2000).default(''),
}).refine(plan => plan.focus !== 'CONVERSATION' || plan.answer.length > 0);
export type Plan = z.infer<typeof Plan>;
