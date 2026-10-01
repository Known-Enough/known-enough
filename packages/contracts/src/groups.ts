import { z } from 'zod';
import { PublicDecisionFrame } from './known-enough.ts';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const text = z.string().trim().min(1).max(80);
export const AccountStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'DISABLED']);
export const Account = z.object({ subject: id, emailHash: z.string().regex(/^[a-f0-9]{64}$/), displayName: text,
  status: AccountStatus, version: z.number().int().positive() }).strict();
export const GroupDraft = z.object({ id, bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().positive(), groupVersion: z.number().int().positive(),
  frame: PublicDecisionFrame, clarificationQuestions: z.array(z.string().min(1).max(500)).max(12),
  createdDecisionId: id.nullable() }).strict();
export type GroupDraft = z.infer<typeof GroupDraft>;
export const Group = z.object({ id, name: text, organizer: id, version: z.number().int().positive(),
  drafts: z.array(GroupDraft).max(64).default([]),
  members: z.array(id).min(1).max(16), decisions: z.array(z.object({ id, version: z.number().int().positive() }).strict()).max(64),
  invitations: z.array(z.object({ tokenHash: z.string().regex(/^[a-f0-9]{64}$/), recipientHash: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.number().int().positive(), acceptedBy: id.nullable() }).strict()).max(64) }).strict();
export const GroupState = z.object({ accounts: z.array(Account).max(256), groups: z.array(Group).max(32) }).strict();
export const GroupSnapshot = z.object({ id, name: text, version: z.number().int().positive(), isOrganizer: z.boolean(),
  members: z.array(z.object({ id, displayName: text, isOrganizer: z.boolean() }).strict()).max(16),
  drafts: z.array(z.object({ id, title: z.string().trim().min(1).max(160), needsClarification: z.boolean(), current: z.boolean(), created: z.boolean().default(false) }).strict()).max(64).default([]),
  pendingInvitations: z.number().int().nonnegative(), decisions: z.array(z.object({ id, current: z.boolean() }).strict()).max(64) }).strict();
export const AccountSnapshot = z.object({ status: AccountStatus, displayName: text, version: z.number().int().positive() }).strict();
export type GroupState = z.infer<typeof GroupState>;
export type Group = z.infer<typeof Group>;
export type Account = z.infer<typeof Account>;
export type GroupSnapshot = z.infer<typeof GroupSnapshot>;
