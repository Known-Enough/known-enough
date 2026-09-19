import { z } from 'zod';

export const Id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const Version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const Timestamp = z.iso.datetime();
export const Timezone = z.literal('America/Mexico_City');
const unique = (values: string[]) => new Set(values).size === values.length;
export const MemberIds = z.array(Id).min(1).max(20).refine(unique, 'Duplicate member');
export const Policy = z.enum(['LOWEST_INCONVENIENCE', 'BALANCE_RECENT_LOAD']);
export const Interval = z.strictObject({
  date: z.iso.date(), timezone: Timezone,
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
}).refine(x => x.endMinute > x.startMinute, 'Full positive interval required');
export const MeetingSlot = z.strictObject({ id: Id, interval: Interval })
  .refine(x => [30, 60].includes(x.interval.endMinute - x.interval.startMinute), 'Supported meeting duration is 30 or 60 minutes');
export const Participant = z.strictObject({ id: Id, displayName: z.string().min(1).max(60), submitted: z.boolean(), sharedPriorLoad: Version });
export const Duty = z.strictObject({ id: Id, label: z.string().min(1).max(100), interval: Interval, loadPoints: z.number().int().min(1).max(10), qualifiedMemberIds: MemberIds });
export const Schedule = z.strictObject({ slots: z.array(MeetingSlot).length(3), duties: z.array(Duty).length(2) })
  .refine(x => unique(x.slots.map(s => s.id)) && unique(x.duties.map(d => d.id)), 'Schedule IDs must be unique');
export const PublicPlanFacts = z.strictObject({
  meeting: MeetingSlot,
  assignments: z.array(z.strictObject({ duty: Duty, participantId: Id })).length(2),
}).superRefine((x, ctx) => {
  if (!unique(x.assignments.map(a => a.duty.id)) || !unique(x.assignments.map(a => a.participantId)))
    ctx.addIssue({ code: 'custom', message: 'Two distinct duties and assignees required' });
  if (x.assignments.some(a => !a.duty.qualifiedMemberIds.includes(a.participantId)))
    ctx.addIssue({ code: 'custom', message: 'Assignees must be qualified' });
});
export const PublicHashPayload = z.strictObject({
  schemaVersion: z.literal(1), roomId: Id, contextToken: Id, proposalVersion: Version,
  rosterMemberIds: MemberIds, policy: Policy, plan: PublicPlanFacts,
}).refine(x => x.plan.assignments.every(a => x.rosterMemberIds.includes(a.participantId)
  && a.duty.qualifiedMemberIds.every(id => x.rosterMemberIds.includes(id))), 'Plan members must belong to roster');
export const ProposalView = z.strictObject({
  id: Id, facts: PublicHashPayload, planHash: Hash, validUntil: Timestamp,
  policyLabel: z.enum(['Lowest declared inconvenience', 'Balance recent duty load']),
}).refine(x => x.policyLabel === (x.facts.policy === 'BALANCE_RECENT_LOAD' ? 'Balance recent duty load' : 'Lowest declared inconvenience'), 'Policy label mismatch');
export const PublishedDisclosure = z.strictObject({
  text: z.string().min(1).max(500), audienceMemberIds: MemberIds,
  publishedAt: Timestamp, contextToken: Id, decisionRevision: Version,
});
// No refusal, private offer, grant reference, or owner diagnostic is a public field.
export const PublicStatus = z.enum(['COLLECTING', 'READY', 'SOLVING', 'PRIVATE_REVIEW', 'PROPOSED', 'APPROVING', 'AGREED', 'NO_AGREEMENT', 'SUPERSEDED', 'CLOSED']);
export const PublicRoomSnapshot = z.strictObject({
  schemaVersion: z.literal(1), roomId: Id, contextToken: Id, decisionRevision: Version,
  controlVersion: Version, timezone: Timezone, schedule: Schedule,
  roster: z.array(Participant).length(3), policy: Policy, status: PublicStatus,
  proposal: ProposalView.nullable(),
  approvedMemberIds: z.array(Id).max(3).refine(unique),
  publishedDisclosures: z.array(PublishedDisclosure),
}).superRefine((x, ctx) => {
  const members = x.roster.map(p => p.id);
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (!unique(members)) issue('Duplicate roster member');
  if (x.approvedMemberIds.some(id => !members.includes(id))) issue('Unknown approval member');
  if (x.schedule.duties.some(d => d.qualifiedMemberIds.some(id => !members.includes(id)))) issue('Unknown qualified member');
  const active = ['PROPOSED', 'APPROVING', 'AGREED'].includes(x.status);
  if (active !== (x.proposal !== null)) issue('Only active proposal states expose a proposal');
  if (!active && x.approvedMemberIds.length) issue('Inactive context cannot expose active approvals');
  if (x.status === 'AGREED' && x.approvedMemberIds.length !== members.length) issue('Agreement needs complete roster approvals');
  if (x.proposal) {
    const f = x.proposal.facts;
    if (f.roomId !== x.roomId || f.contextToken !== x.contextToken || f.policy !== x.policy
      || [...f.rosterMemberIds].sort().join() !== [...members].sort().join()) issue('Proposal context mismatch');
    if (!x.schedule.slots.some(s => canonicalJson(s) === canonicalJson(f.plan.meeting))) issue('Meeting absent from schedule');
    if (f.plan.assignments.some(a => !x.schedule.duties.some(d => canonicalJson(d) === canonicalJson(a.duty)))) issue('Duty absent from schedule');
  }
});

// Explicit full-interval coverage; no start-time-only or executable predicates.
export const Condition = z.discriminatedUnion('kind', [
  z.strictObject({ id: Id, kind: z.literal('HARD_AVAILABILITY'), availableIntervals: z.array(Interval).min(1).max(20) }),
  z.strictObject({ id: Id, kind: z.literal('NEGOTIABLE_UNAVAILABLE'), interval: Interval, inviteException: z.boolean() }),
]);
export const InputValues = z.strictObject({
  conditions: z.array(Condition).max(20).refine(x => unique(x.map(c => c.id)), 'Duplicate condition'),
  dutyCosts: z.array(z.strictObject({ dutyId: Id, cost: z.number().int().min(0).max(3) })).max(2)
    .refine(x => unique(x.map(c => c.dutyId)), 'Duplicate duty cost'),
});
export const ConfirmedInputs = z.strictObject({ values: InputValues, confirmed: z.literal(true), confirmedAt: Timestamp, inputRevision: Version, contextToken: Id });
export const InputDraft = z.strictObject({ draftId: Id, draftRevision: Version, values: InputValues });
export const ExceptionScope = z.strictObject({
  conditionId: Id, roomId: Id, contextToken: Id, decisionRevision: Version,
  inputRevision: Version, rosterMemberIds: MemberIds, policy: Policy,
  meeting: MeetingSlot, predicate: z.literal('OWNER_HAS_NO_WEEKEND_DUTIES'), expiresAt: Timestamp,
});
export function normalizeDisclosureText(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n').trim();
}
export const DisclosurePreview = z.strictObject({
  id: Id, text: z.string().min(1).max(500).refine(x => normalizeDisclosureText(x) === x, 'Text must be normalized before preview'),
  textHash: Hash, audienceMemberIds: MemberIds, roomId: Id, contextToken: Id,
  decisionRevision: Version, expiresAt: Timestamp,
  inferenceWarning: z.literal('People may infer who changed availability from the plan. Published words cannot be made secret again.'),
});
export const PermissionStatus = z.enum(['ACTIVE', 'DECLINED', 'REVOKED', 'EXPIRED', 'SUPERSEDED']);
export const ExceptionOffer = z.strictObject({ id: Id, version: Version, scope: ExceptionScope });
export const ExceptionGrant = z.strictObject({ id: Id, version: Version, scope: ExceptionScope, status: PermissionStatus });
export const DisclosureGrant = z.strictObject({ id: Id, version: Version, preview: DisclosurePreview, status: PermissionStatus, publishedAt: Timestamp.nullable() });
export const FinalApproval = z.strictObject({ proposalId: Id, proposalVersion: Version, contextToken: Id, planHash: Hash, acceptedAt: Timestamp });
export const OwnerSnapshot = z.strictObject({
  schemaVersion: z.literal(1), roomId: Id, contextToken: Id, ownerMemberId: Id,
  ownerRevision: Version, controlVersion: Version,
  confirmedInputs: ConfirmedInputs.nullable(), draft: InputDraft.nullable(),
  pendingOffers: z.array(ExceptionOffer), disclosurePreviews: z.array(DisclosurePreview),
  exceptionGrants: z.array(ExceptionGrant), disclosureGrants: z.array(DisclosureGrant),
  ownApproval: FinalApproval.nullable(),
});

const expected = z.strictObject({ contextToken: Id, decisionRevision: Version, controlVersion: Version });
const envelope = { schemaVersion: z.literal(1), requestId: Id, roomId: Id, idempotencyKey: Id, expected };
const approvalTarget = { proposalId: Id, proposalVersion: Version, planHash: Hash };
export const CommandEnvelope = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('SUBMIT_INPUT_DRAFT'), payload: z.strictObject({ expectedOwnerRevision: Version, values: InputValues }) }),
  z.strictObject({ ...envelope, type: z.literal('CONFIRM_INPUTS'), payload: z.strictObject({ draftId: Id, draftRevision: Version, expectedOwnerRevision: Version }) }),
  z.strictObject({ ...envelope, type: z.literal('ACCEPT_CONTEXT'), payload: z.strictObject({ policy: Policy }) }),
  z.strictObject({ ...envelope, type: z.literal('REQUEST_SOLVE'), payload: z.strictObject({}) }),
  z.strictObject({ ...envelope, type: z.literal('DECIDE_EXCEPTION'), payload: z.strictObject({ offerId: Id, offerVersion: Version, decision: z.enum(['ALLOW', 'DECLINE']), scope: ExceptionScope }) }),
  z.strictObject({ ...envelope, type: z.literal('DECIDE_DISCLOSURE'), payload: z.strictObject({ preview: DisclosurePreview, decision: z.enum(['ALLOW', 'DECLINE']) }) }),
  z.strictObject({ ...envelope, type: z.literal('REVOKE_EXCEPTION'), payload: z.strictObject({ grantId: Id, grantVersion: Version }) }),
  z.strictObject({ ...envelope, type: z.literal('REVOKE_DISCLOSURE'), payload: z.strictObject({ grantId: Id, grantVersion: Version }) }),
  z.strictObject({ ...envelope, type: z.literal('PUBLISH_DISCLOSURE'), payload: z.strictObject({ grantId: Id, grantVersion: Version }) }),
  z.strictObject({ ...envelope, type: z.literal('ACCEPT_PROPOSAL'), payload: z.strictObject(approvalTarget) }),
  z.strictObject({ ...envelope, type: z.literal('WITHDRAW_APPROVAL'), payload: z.strictObject(approvalTarget) }),
  z.strictObject({ ...envelope, type: z.literal('REVISE_DECISION'), payload: z.strictObject({ schedule: Schedule, roster: z.array(Participant).length(3).refine(x => unique(x.map(p => p.id))), policy: Policy }) }),
]);
export const ErrorCode = z.enum(['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'STALE_CONTEXT', 'STALE_PROPOSAL', 'IDEMPOTENCY_CONFLICT', 'INVALID_COMMAND', 'NEEDS_CLARIFICATION']);
export const ERROR_HTTP_STATUS = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, STALE_CONTEXT: 409,
  STALE_PROPOSAL: 409, IDEMPOTENCY_CONFLICT: 409, INVALID_COMMAND: 422, NEEDS_CLARIFICATION: 422,
} as const;
export const CommandResult = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), requestId: Id, status: z.enum(['APPLIED', 'QUEUED']), version: expected }),
  z.strictObject({ ok: z.literal(false), requestId: Id, error: z.strictObject({ code: ErrorCode, httpStatus: z.union([z.literal(401), z.literal(403), z.literal(404), z.literal(409), z.literal(422)]) }) }),
]).refine(x => x.ok || x.error.httpStatus === ERROR_HTTP_STATUS[x.error.code], 'Error/status mismatch');

// Internal helper only: callers hash validated, allowlisted public facts.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, val]) => `${JSON.stringify(key)}:${canonicalJson(val)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function serializePublicProposal(input: unknown): string {
  const data = PublicHashPayload.parse(input);
  data.rosterMemberIds.sort();
  data.plan.assignments.sort((a, b) => a.duty.id < b.duty.id ? -1 : a.duty.id > b.duty.id ? 1 : 0);
  for (const a of data.plan.assignments) a.duty.qualifiedMemberIds.sort();
  return canonicalJson(data);
}
export async function hashPublicProposal(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(serializePublicProposal(input));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export type PublicRoomSnapshot = z.infer<typeof PublicRoomSnapshot>;
export type OwnerSnapshot = z.infer<typeof OwnerSnapshot>;
export type ProposalView = z.infer<typeof ProposalView>;
export type ExceptionScope = z.infer<typeof ExceptionScope>;
export type DisclosurePreview = z.infer<typeof DisclosurePreview>;
export type CommandEnvelope = z.infer<typeof CommandEnvelope>;
export type CommandResult = z.infer<typeof CommandResult>;
export type Interval = z.infer<typeof Interval>;
export type MeetingSlot = z.infer<typeof MeetingSlot>;
export type Policy = z.infer<typeof Policy>;
export type Participant = z.infer<typeof Participant>;
export type Duty = z.infer<typeof Duty>;
export type Schedule = z.infer<typeof Schedule>;
export type PublicPlanFacts = z.infer<typeof PublicPlanFacts>;
export type PublicHashPayload = z.infer<typeof PublicHashPayload>;
export type Condition = z.infer<typeof Condition>;
export type InputValues = z.infer<typeof InputValues>;
export type ConfirmedInputs = z.infer<typeof ConfirmedInputs>;
export type InputDraft = z.infer<typeof InputDraft>;
export type ExceptionOffer = z.infer<typeof ExceptionOffer>;
export type ExceptionGrant = z.infer<typeof ExceptionGrant>;
export type DisclosureGrant = z.infer<typeof DisclosureGrant>;
export type FinalApproval = z.infer<typeof FinalApproval>;
