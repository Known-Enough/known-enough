import { z } from 'zod';
import { PublicDecisionFrame } from './known-enough.ts';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const text = z.string().trim().min(1).max(80);
export const AccountStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'DISABLED']);
/** Owner-managed PNG record; group reads project only the rendered image fields and never its asset id/hash. */
export const OwnedAvatar = z.object({ id, mimeType: z.literal('image/png'), width: z.number().int().min(1).max(128), height: z.number().int().min(1).max(128),
  bytesBase64: z.string().min(1).max(21848).regex(/^[A-Za-z0-9+/]+={0,2}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
/** Stored profile record; loginUsername is owner-private, while bio/avatar are exposed only through same-group reads. */
export const PrivateProfile = z.object({ description: z.string().max(280), image: OwnedAvatar.nullable(), loginUsername: z.string().max(128).nullable() }).strict();
export const ProfilePatch = z.object({ version: z.number().int().positive(), displayName: text, description: z.string().max(280) }).strict();
export const AvatarPatch = z.object({ version: z.number().int().positive(), bytesBase64: z.string().min(1).max(21848).nullable() }).strict();
export const OwnProfile = z.object({ status: AccountStatus, displayName: text, version: z.number().int().positive(),
  description: z.string().max(280), image: OwnedAvatar.nullable(), loginUsername: z.string().max(128).nullable() }).strict();
/** Fields shared only after the caller is admitted to the same current group as the profile owner. */
export const SharedAvatar = z.object({ mimeType: z.literal('image/png'), width: z.number().int().min(1).max(128), height: z.number().int().min(1).max(128),
  bytesBase64: z.string().min(1).max(21848).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict();
/** Deliberately excludes all account, approval, authentication and asset identifiers. */
export const GroupMemberProfile = z.object({ displayName: text, description: z.string().max(280), image: SharedAvatar.nullable() }).strict();
export const Account = z.object({ subject: id, emailHash: z.string().regex(/^[a-f0-9]{64}$/), displayName: text,
  status: AccountStatus, version: z.number().int().positive(), profile: PrivateProfile.optional(),
  /** Private, immutable subject-specific ownership for a server-allowlisted test email. */
  sharedTestEmail: z.literal(true).optional() }).strict();
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
