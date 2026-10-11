import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { KnownEnoughRecord, TrustedPrincipal } from '@deal-table/application';
import { PartitionRowSchema, checkPartitionRow, partitionIO, partitionCall,
  type PartitionKey, type PartitionRow, type PartitionIOContext } from './partitioned-group-repository.ts';
import { ArchivedGroupRow } from './partition-archive.ts';
import { partitionMemberId } from './partition-group-session.ts';
import { encodedDecisionStateRecord, encodeGuardItem, validateDecisionStateGuard,
  type DynamoKnownEnoughRecord, type GuardRecord } from './dynamodb-codec.ts';

// Inactive server-only boundary. No environment selection, HTTP/body identity or provider deletion claim.
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sha = z.string().regex(/^[a-f0-9]{40}$/).refine(value => !/^0+$/.test(value));
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const utc = z.string().datetime();
export const RetentionPolicy = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('RETENTION_POLICY'),
  revision: positive, enabled: z.boolean(), dataClass: z.enum(['SYNTHETIC', 'REAL']), rawConversationMs: z.literal(0),
  structuredMs: positive.max(366 * 86_400_000), replayMs: positive.max(366 * 86_400_000),
  journalMs: positive.max(366 * 86_400_000), backupMs: positive.max(366 * 86_400_000).nullable(),
  providerMs: positive.max(366 * 86_400_000).nullable(), realPersonPolicy: z.enum(['UNAPPROVED', 'APPROVED']) }).refine(policy => policy.dataClass === 'REAL' ? policy.realPersonPolicy === 'APPROVED' : policy.realPersonPolicy === 'UNAPPROVED', 'Explicit matching data policy required');
export type RetentionPolicy = z.infer<typeof RetentionPolicy>;
export const RetentionStamp = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('RETENTION_STAMP'),
  revision: positive, dataClass: z.enum(['SYNTHETIC', 'REAL']), policyRevision: positive, createdAt: utc, lastActivityAt: utc });
export function retentionDeadline(policy: RetentionPolicy, stamp: z.infer<typeof RetentionStamp>, category: 'STRUCTURED' | 'REPLAY' | 'JOURNAL' = 'STRUCTURED') {
  const p = RetentionPolicy.parse(policy); const s = RetentionStamp.parse(stamp);
  if (!p.enabled || s.dataClass !== p.dataClass || s.policyRevision !== p.revision || Date.parse(s.lastActivityAt) < Date.parse(s.createdAt)) fail('LIFECYCLE_POLICY_DENIED');
  const deadline = Date.parse(s.lastActivityAt) + (category === 'STRUCTURED' ? p.structuredMs : category === 'REPLAY' ? p.replayMs : p.journalMs);
  if (!Number.isSafeInteger(deadline)) fail('LIFECYCLE_INVALID');
  return deadline;
}
export type LifecycleScope = { kind: 'ACCOUNT'; subject: string } | { kind: 'GROUP'; groupId: string }
  | { kind: 'DECISION'; decisionId: string } | { kind: 'OWNER'; decisionId: string; subject: string };
const scopeSchema = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('ACCOUNT'), subject: id }),
  z.strictObject({ kind: z.literal('GROUP'), groupId: id }), z.strictObject({ kind: z.literal('DECISION'), decisionId: id }),
  z.strictObject({ kind: z.literal('OWNER'), decisionId: id, subject: id })]);
const keySchema = z.strictObject({ PK: z.string().min(1).max(200), SK: z.string().min(1).max(200) });
export type LifecycleEntry = { key: PartitionKey; row: PartitionRow };
export type LifecycleDecision = { record: DynamoKnownEnoughRecord; guard: GuardRecord; replayKeys: { key: PartitionKey; hash: string }[] };
/** Native inventory must enumerate ALL discovery rows (including inactive), children and replay pages. No partial export/plan. */
export interface LifecycleInventory { entries: LifecycleEntry[]; decisions: LifecycleDecision[];
  erasedDecisions?: string[];
  archives?: { key: PartitionKey; row: ArchivedGroupRow; originalHeader?: Extract<PartitionRow, { kind: 'GROUP' }> }[] }
const rowRef = z.strictObject({ key: keySchema, hash });
const stepSchema = z.strictObject({ kind: z.enum(['ACCOUNT_FENCE', 'ACCOUNT_FINAL', 'ACCOUNT_DRAFTS', 'GROUP_FENCE', 'OWNER_STATE', 'DECISION_STATE', 'PARTITION_ROWS', 'REPLAYS']),
  target: id, subject: id.nullable(), sourceHash: hash, guardHash: hash.nullable().default(null), rows: z.array(rowRef).max(80) });
const planSchema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('ERASURE_PLAN'), opId: id, sourceSha: sha,
  policyRevision: positive, scope: scopeSchema, requiredSubjects: z.array(id).min(1).max(32),
  steps: z.array(stepSchema).min(1).max(512) });
export type LifecyclePlan = z.infer<typeof planSchema>;
export const LifecycleConsent = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('ERASURE_CONSENT'),
  revision: positive, opId: id, planHash: hash, subject: id, sourceSha: sha, policyRevision: positive,
  grantedAt: utc, expiresAt: utc, revoked: z.boolean() });
export type LifecycleConsent = z.infer<typeof LifecycleConsent>;
export const LifecycleJournal = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('ERASURE_JOURNAL'),
  revision: positive, opId: id, planHash: hash, sourceSha: sha, policyRevision: positive,
  nextStep: z.number().int().min(0).max(512), state: z.enum(['PREPARED', 'ERASING', 'ERASED']), updatedAt: utc });
export type LifecycleJournal = z.infer<typeof LifecycleJournal>;
export class PartitionLifecycleError extends Error {
  constructor(readonly code: 'LIFECYCLE_INVALID' | 'LIFECYCLE_CAPACITY' | 'LIFECYCLE_POLICY_DENIED' | 'LIFECYCLE_AUTHORITY_DENIED'
    | 'LIFECYCLE_EXPIRED' | 'LIFECYCLE_SOURCE_CHANGED' | 'LIFECYCLE_CONFLICT' | 'LIFECYCLE_COMMIT_UNKNOWN'
    | 'LIFECYCLE_STORAGE_UNAVAILABLE' | 'LIFECYCLE_TIMEOUT' | 'LIFECYCLE_REQUEST_LIMIT', options?: ErrorOptions) {
    super(code, options); this.name = 'PartitionLifecycleError';
  }
}
export function lifecycleFail(code: PartitionLifecycleError['code']): never { throw new PartitionLifecycleError(code); }
function fail(code: PartitionLifecycleError['code']): never { return lifecycleFail(code); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export const lifecycleHash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const code = (key: PartitionKey) => `${key.PK}/${key.SK}`;
function next(n: number) { if (!Number.isSafeInteger(n) || n < 0 || n >= Number.MAX_SAFE_INTEGER) fail('LIFECYCLE_CAPACITY'); return n + 1; }
export function lifecycleSubject(principal: TrustedPrincipal | null): string {
  if (!principal || principal.kind !== 'participant' || !id.safeParse(principal.subject).success) fail('LIFECYCLE_AUTHORITY_DENIED');
  return principal.subject;
}
function inventory(raw: LifecycleInventory) {
  if (!raw || !Array.isArray(raw.entries) || !Array.isArray(raw.decisions) || raw.entries.length > 2048 || raw.decisions.length > 128) fail('LIFECYCLE_CAPACITY');
  const entries = raw.entries.map(entry => ({ key: keySchema.parse(entry.key), row: checkPartitionRow(entry.row, entry.key) }));
  if (new Set(entries.map(entry => code(entry.key))).size !== entries.length) fail('LIFECYCLE_INVALID');
  const decisions = raw.decisions.map(value => {
    const record = encodedDecisionStateRecord({ ...value.record, replays: [] });
    validateDecisionStateGuard(record, value.guard);
    if (!Array.isArray(value.replayKeys) || value.replayKeys.length > 4608) fail('LIFECYCLE_CAPACITY');
    const replayKeys = value.replayKeys.map(ref => rowRef.parse(ref));
    if (replayKeys.some(ref => ref.key.PK !== `ROOM#${record.decisionId}` || !/^REPLAY#[a-f0-9]{64}$/.test(ref.key.SK))
      || new Set(replayKeys.map(ref => code(ref.key))).size !== replayKeys.length) fail('LIFECYCLE_INVALID');
    return { record, guard: structuredClone(value.guard), replayKeys };
  });
  if (new Set(decisions.map(value => value.record.decisionId)).size !== decisions.length) fail('LIFECYCLE_INVALID');
  const archives = (raw.archives ?? []).map(entry => {
    const row = ArchivedGroupRow.parse(entry.row); const key = keySchema.parse(entry.key);
    if (key.PK !== `GROUP#${row.groupId}` || key.SK !== 'STATE') fail('LIFECYCLE_INVALID');
    if (entry.originalHeader) { const original = PartitionRowSchema.parse(entry.originalHeader);
      if (original.kind !== 'GROUP' || original.value.id !== row.groupId || original.value.organizer !== row.organizer) fail('LIFECYCLE_INVALID');
      return { key, row, originalHeader: original }; }
    return { key, row };
  });
  if (archives.length > 32 || new Set(archives.map(entry => code(entry.key))).size !== archives.length
    || archives.some(entry => entries.some(other => code(other.key) === code(entry.key)))) fail('LIFECYCLE_INVALID');
  const erasedDecisions = z.array(id).max(128).parse(raw.erasedDecisions ?? []);
  if (new Set(erasedDecisions).size !== erasedDecisions.length || erasedDecisions.some(value => decisions.some(other => other.record.decisionId === value))) fail('LIFECYCLE_INVALID');
  return { entries, decisions, archives, erasedDecisions };
}
export function prepareLifecyclePlan(raw: LifecycleInventory, rawScope: LifecycleScope, sourceSha: string, opId: string, rawPolicy: RetentionPolicy) {
  const scope = scopeSchema.parse(rawScope); const policy = RetentionPolicy.parse(rawPolicy);
  if (!policy.enabled || !sha.safeParse(sourceSha).success || !id.safeParse(opId).success) fail('LIFECYCLE_POLICY_DENIED');
  const data = inventory(raw); const steps: z.input<typeof stepSchema>[] = []; const subjects = new Set<string>();
  const groups = data.entries.filter(entry => entry.row.kind === 'GROUP');
  const accounts = data.entries.filter(entry => entry.row.kind === 'ACCOUNT');
  const headers = new Map(groups.map(entry => [entry.row.kind === 'GROUP' ? entry.row.value.id : '', entry]));
  const bindings = data.entries.filter(entry => entry.row.kind === 'BINDING');
  const selectedGroups = scope.kind === 'GROUP' ? [scope.groupId] : scope.kind === 'ACCOUNT'
    ? data.entries.filter(entry => entry.row.kind === 'MEMBERSHIP' && entry.row.value.subject === scope.subject)
      .map(entry => entry.row.kind === 'MEMBERSHIP' ? entry.row.value.groupId : '') : [];
  if (scope.kind === 'ACCOUNT') {
    const account = accounts.find(entry => entry.row.kind === 'ACCOUNT' && entry.row.value.subject === scope.subject);
    if (!account) fail('LIFECYCLE_AUTHORITY_DENIED');
    subjects.add(scope.subject); steps.push({ kind: 'ACCOUNT_FENCE', target: scope.subject, subject: scope.subject,
      sourceHash: lifecycleHash(account.row), rows: [] });
  }
  for (const groupId of selectedGroups) {
    const entry = headers.get(groupId); const archived = data.archives.find(value => value.row.groupId === groupId);
    const header = entry?.row.kind === 'GROUP' ? entry.row : archived?.originalHeader;
    if (!header && !archived) fail('LIFECYCLE_INVALID');
    if (!header && scope.kind === 'GROUP') fail('LIFECYCLE_AUTHORITY_DENIED');
    const childIds = bindings.filter(value => value.key.PK === `GROUP#${groupId}`).map(value => value.row.kind === 'BINDING' ? value.row.value.id : '');
    if (header && header.value.decisionIds.some(value => !childIds.includes(value))) fail('LIFECYCLE_INVALID');
    if (scope.kind === 'GROUP') {
      header!.value.members.forEach(value => subjects.add(value));
      steps.push({ kind: 'GROUP_FENCE', target: groupId, subject: null, sourceHash: lifecycleHash(archived?.row ?? header), rows: [] });
    }
  }
  const selected = scope.kind === 'OWNER' || scope.kind === 'DECISION' ? [scope.decisionId]
    : bindings.filter(entry => selectedGroups.includes(entry.key.PK.slice(6))).map(entry => entry.row.kind === 'BINDING' ? entry.row.value.id : '');
  for (const decisionId of [...new Set(selected)]) {
    const value = data.decisions.find(value => value.record.decisionId === decisionId);
    if (!value && data.erasedDecisions.includes(decisionId) && scope.kind !== 'OWNER' && scope.kind !== 'DECISION') continue;
    if (!value) fail('LIFECYCLE_INVALID');
    const subject = scope.kind === 'OWNER' || scope.kind === 'ACCOUNT' ? scope.subject : null;
    if (subject !== null) {
      const member = value.record.memberships.find(item => item.subject === subject);
      const historical = value.record.retiredPermissions.some(item => item.participantId === partitionMemberId(subject));
      if (!member && !historical) { if (scope.kind === 'OWNER') fail('LIFECYCLE_AUTHORITY_DENIED'); else continue; }
      subjects.add(subject);
    } else {
      value.record.memberships.filter(item => item.active || value.record.owners.some(owner => owner.participantId === item.participantId
        && (owner.draft || owner.confirmedConstraints.length || owner.negotiationPermissions.length || owner.refusedRequests.length || owner.disclosurePermissions.length)))
        .forEach(item => subjects.add(item.subject));
      // Unattributable retired private history needs provenance repair, never organizer-only authority.
      if (value.record.retiredPermissions.some(owner => !value.record.memberships.some(item => item.participantId === owner.participantId)
        && !accounts.some(entry => entry.row.kind === 'ACCOUNT' && partitionMemberId(entry.row.value.subject) === owner.participantId))) fail('LIFECYCLE_AUTHORITY_DENIED');
      value.record.retiredPermissions.forEach(owner => accounts.forEach(entry => {
        if (entry.row.kind === 'ACCOUNT' && partitionMemberId(entry.row.value.subject) === owner.participantId) subjects.add(entry.row.value.subject);
      }));
    }
    steps.push({ kind: subject === null ? 'DECISION_STATE' : 'OWNER_STATE', target: decisionId, subject,
      sourceHash: lifecycleHash({ record: value.record, guard: value.guard }), guardHash: lifecycleHash(encodeGuardItem(decisionId, value.guard)), rows: [] });
    for (let index = 0; index < value.replayKeys.length; index += 16) steps.push({ kind: 'REPLAYS', target: decisionId, subject,
      sourceHash: lifecycleHash(value.guard), rows: value.replayKeys.slice(index, index + 16) });
  }
  if (scope.kind === 'GROUP') {
    const rows = data.entries.filter(entry => entry.key.PK === `GROUP#${scope.groupId}` && entry.key.SK !== 'STATE')
      .map(entry => ({ key: entry.key, hash: lifecycleHash(entry.row) }));
    for (let index = 0; index < rows.length; index += 16) steps.push({ kind: 'PARTITION_ROWS', target: scope.groupId, subject: null,
      sourceHash: lifecycleHash(rows), rows: rows.slice(index, index + 16) });
  }
  if (scope.kind === 'ACCOUNT') for (const groupId of selectedGroups) {
    const drafts = data.entries.filter(entry => entry.row.kind === 'DRAFT' && entry.key.PK === `GROUP#${groupId}`)
      .map(entry => ({ key: entry.key, hash: lifecycleHash(entry.row) }));
    for (let index = 0; index < drafts.length; index += 16) steps.push({ kind: 'ACCOUNT_DRAFTS', target: groupId, subject: scope.subject,
      sourceHash: lifecycleHash(drafts), rows: drafts.slice(index, index + 16) });
  }
  if (scope.kind === 'ACCOUNT') steps.push({ kind: 'ACCOUNT_FINAL', target: scope.subject, subject: scope.subject,
    sourceHash: lifecycleHash(steps[0]), rows: [] });
  const plan = planSchema.parse({ schemaVersion: 1, kind: 'ERASURE_PLAN', opId, sourceSha, policyRevision: policy.revision,
    scope, requiredSubjects: [...subjects].sort(), steps });
  if (Buffer.byteLength(JSON.stringify(plan)) > 1024 * 1024) fail('LIFECYCLE_CAPACITY');
  return structuredClone(plan);
}
/** Authenticated sealed recovery contains only opaque selectors/hashes, never erased content or source row bytes. */
export function sealLifecyclePlan(plan: LifecyclePlan, signingKey: Buffer): Buffer {
  if (!Buffer.isBuffer(signingKey) || signingKey.length !== 32) fail('LIFECYCLE_INVALID');
  const value = planSchema.parse(plan); const payload = JSON.stringify(value);
  return Buffer.from(JSON.stringify({ payload, mac: createHmac('sha256', signingKey).update(payload).digest('hex') }));
}
export function loadLifecyclePlan(bytes: Buffer, signingKey: Buffer, expected: { sourceSha: string; planHash: string; opId: string }) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 1_200_000 || signingKey.length !== 32) fail('LIFECYCLE_INVALID');
  let seal: { payload: string; mac: string };
  try { seal = z.strictObject({ payload: z.string(), mac: hash }).parse(JSON.parse(bytes.toString('utf8'))); } catch { return fail('LIFECYCLE_INVALID'); }
  const mac = createHmac('sha256', signingKey).update(seal.payload).digest();
  if (!timingSafeEqual(mac, Buffer.from(seal.mac, 'hex'))) fail('LIFECYCLE_AUTHORITY_DENIED');
  const plan = planSchema.parse(JSON.parse(seal.payload));
  if (JSON.stringify(plan) !== seal.payload || expected.planHash !== lifecycleHash(plan)
    || expected.sourceSha !== plan.sourceSha || expected.opId !== plan.opId) fail('LIFECYCLE_SOURCE_CHANGED');
  return structuredClone(plan);
}
/** Revoke derived authority and advance job/control/replay fences; retain unrelated owners' private conditions. */
export function eraseDecisionOwner(record: DynamoKnownEnoughRecord, subject: string): KnownEnoughRecord {
  const value: KnownEnoughRecord = { ...structuredClone(record), replays: [] };
  const member = value.memberships.find(item => item.subject === subject);
  const ownerId = member?.participantId ?? partitionMemberId(id.parse(subject));
  if (!value.owners.some(owner => owner.participantId === ownerId) && !value.retiredPermissions.some(owner => owner.participantId === ownerId)) fail('LIFECYCLE_AUTHORITY_DENIED');
  value.owners = value.owners.map(owner => owner.participantId === ownerId ? {
    participantId: owner.participantId, ownerVersion: next(owner.ownerVersion), readiness: 'NOT_STARTED', draftVersion: null, draft: null,
    confirmedConstraints: [], pendingQuestions: [], refusedRequests: [], negotiationPermissions: [], disclosurePermissions: [], approval: null,
  } : { ...owner, approval: null,
    pendingQuestions: owner.pendingQuestions.map(question => question.status === 'PENDING' ? { ...question, status: 'SUPERSEDED' } : question),
    negotiationPermissions: owner.negotiationPermissions.map(permission => permission.status === 'ACTIVE'
      ? { ...permission, status: 'SUPERSEDED', permissionVersion: next(permission.permissionVersion) } : permission),
    disclosurePermissions: owner.disclosurePermissions.map(permission => ['ACTIVE', 'PENDING'].includes(permission.status)
      ? { ...permission, status: 'SUPERSEDED', permissionVersion: next(permission.permissionVersion) } : permission),
  });
  value.retiredPermissions = value.retiredPermissions.filter(owner => owner.participantId !== ownerId);
  value.memberships.forEach(item => { if (item.participantId === ownerId) item.active = false; });
  value.invitations = value.invitations.filter(item => item.participantId !== ownerId);
  value.definition.participants.forEach(item => { if (item.id === ownerId) item.displayName = 'Erased participant'; });
  value.frameConfirmations = []; value.pendingCandidate = null; value.candidate = null; value.publicProposal = null;
  value.supersededCandidates = []; value.agreementHistory = []; value.publishedDisclosures = [];
  value.job = null; value.solveEpoch = next(value.solveEpoch); value.controlVersion = next(value.controlVersion);
  value.publicRevision = next(value.publicRevision); value.status = 'COLLECTING_PRIVATE_INPUT';
  encodedDecisionStateRecord(value); return value;
}
export function ownerLifecycleExport(raw: LifecycleInventory, principal: TrustedPrincipal | null, policy: RetentionPolicy,
  stamp: z.infer<typeof RetentionStamp>, now: number) {
  const subject = lifecycleSubject(principal); const deadline = retentionDeadline(policy, stamp);
  if (!Number.isSafeInteger(now) || now < Date.parse(stamp.lastActivityAt)) fail('LIFECYCLE_INVALID');
  if (now >= deadline) fail('LIFECYCLE_EXPIRED');
  const data = inventory(raw); const account = data.entries.find(entry => entry.row.kind === 'ACCOUNT' && entry.row.value.subject === subject)?.row;
  if (!account || account.kind !== 'ACCOUNT' || account.value.status !== 'APPROVED') fail('LIFECYCLE_AUTHORITY_DENIED');
  const decisions = data.decisions.flatMap(({ record }) => {
    const member = record.memberships.find(item => item.subject === subject); const ownerId = member?.participantId ?? partitionMemberId(subject);
    const owner = record.owners.find(item => item.participantId === ownerId); const retired = record.retiredPermissions.find(item => item.participantId === ownerId);
    if (!owner && !retired) return [];
    // Explicit allowlist, even when current stored record gains fields. No shared candidates, jobs or another owner's receipts.
    const own = owner ? { participantId: owner.participantId, ownerVersion: owner.ownerVersion, readiness: owner.readiness,
      draftVersion: owner.draftVersion, draft: owner.draft, confirmedConstraints: owner.confirmedConstraints,
      pendingQuestions: owner.pendingQuestions, refusedRequests: owner.refusedRequests, negotiationPermissions: owner.negotiationPermissions,
      disclosurePermissions: owner.disclosurePermissions, approval: owner.approval } : null;
    return [{ decisionId: record.decisionId, own, retired: retired ? { participantId: retired.participantId, refusedRequests: retired.refusedRequests,
      negotiationPermissions: retired.negotiationPermissions, disclosurePermissions: retired.disclosurePermissions } : null }];
  });
  return structuredClone({ schemaVersion: 1, account: { displayName: account.value.displayName, status: account.value.status, version: account.value.version },
    decisions, limits: { rawConversations: 'NOT_STORED', sharedDerivedHistory: 'NOT_OWNER_EXPORT', identifierClaims: 'RETAINED',
      backups: 'SEPARATE_MANAGED_POLICY', providers: 'SEPARATE_PROVIDER_POLICY', logs: 'SEPARATE_LOG_POLICY' } });
}
export interface LifecyclePorts {
  policy(context: PartitionIOContext): Promise<RetentionPolicy>;
  consent(subject: string, context: PartitionIOContext): Promise<LifecycleConsent | null>;
  journal(context: PartitionIOContext): Promise<LifecycleJournal | null>;
  /** Persist/read back sealed ID/hash plan before preparing the durable journal. */
  recovery(context: PartitionIOContext): Promise<boolean>;
  /** Recheck policy, all exact participant grants, activation and source, joining journal CAS to every write. */
  commit(plan: LifecyclePlan, prior: LifecycleJournal | null, next: LifecycleJournal, consents: LifecycleConsent[], context: PartitionIOContext): Promise<boolean>;
}
export function createLifecycleRunner(ports: LifecyclePorts, rawPlan: LifecyclePlan,
  options: { clock?: () => number; timeoutMs?: number; maxRequests?: number } = {}) {
  const plan = structuredClone(planSchema.parse(rawPlan)); const planHash = lifecycleHash(plan); const clock = options.clock ?? Date.now;
  function checkedJournal(raw: unknown) {
    const value = LifecycleJournal.parse(raw);
    if (value.planHash !== planHash || value.opId !== plan.opId || value.sourceSha !== plan.sourceSha || value.policyRevision !== plan.policyRevision
      || value.nextStep > plan.steps.length || value.revision !== value.nextStep + 1
      || value.state !== (value.nextStep === 0 ? 'PREPARED' : value.nextStep === plan.steps.length ? 'ERASED' : 'ERASING')) fail('LIFECYCLE_INVALID');
    return value;
  }
  return { async advance(): Promise<LifecycleJournal> {
    const io = partitionIO(options);
    const policy = RetentionPolicy.parse(await partitionCall(io, () => ports.policy(io)));
    if (!policy.enabled || policy.revision !== plan.policyRevision) fail('LIFECYCLE_POLICY_DENIED');
    const now = clock(); if (!Number.isSafeInteger(now) || now < 0) fail('LIFECYCLE_INVALID');
    const consents: LifecycleConsent[] = [];
    for (const subject of plan.requiredSubjects) {
      const grant = LifecycleConsent.safeParse(await partitionCall(io, () => ports.consent(subject, io)));
      if (!grant.success || grant.data.revoked || grant.data.subject !== subject || grant.data.opId !== plan.opId || grant.data.planHash !== planHash
        || grant.data.sourceSha !== plan.sourceSha || grant.data.policyRevision !== policy.revision
        || Date.parse(grant.data.grantedAt) > now || Date.parse(grant.data.expiresAt) <= now
        || Date.parse(grant.data.expiresAt) - Date.parse(grant.data.grantedAt) > 86_400_000) fail('LIFECYCLE_AUTHORITY_DENIED');
      consents.push(grant.data);
    }
    const raw = await partitionCall(io, () => ports.journal(io)); const prior = raw === null ? null : checkedJournal(raw);
    if (prior?.state === 'ERASED') return prior;
    if (!await partitionCall(io, () => ports.recovery(io))) fail('LIFECYCLE_INVALID');
    const nextStep = prior ? prior.nextStep + 1 : 0;
    const update = checkedJournal({ schemaVersion: 1, kind: 'ERASURE_JOURNAL', revision: nextStep + 1, opId: plan.opId, planHash,
      sourceSha: plan.sourceSha, policyRevision: plan.policyRevision, nextStep,
      state: nextStep === 0 ? 'PREPARED' : nextStep === plan.steps.length ? 'ERASED' : 'ERASING', updatedAt: new Date(now).toISOString() });
    try {
      if (!await partitionCall(io, () => ports.commit(plan, prior, update, consents, io))) fail('LIFECYCLE_CONFLICT');
      return update;
    } catch (error) {
      if (error instanceof PartitionLifecycleError && !['LIFECYCLE_STORAGE_UNAVAILABLE', 'LIFECYCLE_COMMIT_UNKNOWN'].includes(error.code)) throw error;
      // Unknown acknowledgement is reconciled by exact durable progress; never blindly repeat a deletion.
      try { const observed = await partitionCall(io, () => ports.journal(io)); if (observed !== null) {
        const current = checkedJournal(observed); if (current.nextStep === update.nextStep && lifecycleHash(current) === lifecycleHash(update)) return current;
      } } catch { /* The uncertain write remains unknown. */ }
      throw new PartitionLifecycleError('LIFECYCLE_COMMIT_UNKNOWN', { cause: error });
    }
  } };
}
