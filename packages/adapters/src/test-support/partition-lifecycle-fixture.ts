import { createHash } from 'node:crypto';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { KnownEnoughApplication, type KnownEnoughRecord, type TrustedPrincipal } from '@deal-table/application';
import { InMemoryRoomRepository } from '../index.ts';
import { partitionMemberId } from '../partition-group-session.ts';
import { preparePartitionMigration } from '../partition-migration.ts';
import { decisionPermissionHistoryCount, encodedDecisionStateRecord, type GuardRecord } from '../dynamodb-codec.ts';
import { RetentionPolicy, RetentionStamp, type LifecycleInventory } from '../partition-lifecycle.ts';
export const subject = 'iris';
export const sourceSha = 'a'.repeat(40);
export const now = Date.parse('2026-10-08T01:00:00Z');
export const principal = (value = subject): TrustedPrincipal => ({ kind: 'participant', subject: value });
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const signingKey = Buffer.alloc(32, 3);
export const policy = RetentionPolicy.parse({ schemaVersion: 1, kind: 'RETENTION_POLICY', revision: 1, enabled: true,
  dataClass: 'SYNTHETIC', rawConversationMs: 0, structuredMs: 86_400_000, replayMs: 3_600_000, journalMs: 86_400_000,
  backupMs: null, providerMs: null, realPersonPolicy: 'UNAPPROVED' });
export const stamp = RetentionStamp.parse({ schemaVersion: 1, kind: 'RETENTION_STAMP', revision: 1, dataClass: 'SYNTHETIC',
  policyRevision: 1, createdAt: '2026-10-08T00:00:00Z', lastActivityAt: '2026-10-08T00:00:00Z' });
export async function lifecycleFixture(replayCount = 2) {
  const accounts: Groups.Account[] = [subject, 'omar'].map(subject => ({ subject, emailHash: hash(subject), displayName: `${subject}-synthetic-profile`, status: 'APPROVED', version: 1 }));
  const groups: Groups.Group[] = [{ id: 'garden', name: 'Synthetic garden', organizer: subject, version: 1,
    members: [subject, 'omar'], drafts: [], invitations: [], decisions: [{ id: 'decision', version: 1 }] }];
  const migration = preparePartitionMigration(Buffer.from(JSON.stringify({ accounts, groups })), 12, sourceSha);
  const memory = new InMemoryRoomRepository();
  const participants = accounts.map(account => ({ id: partitionMemberId(account.subject), displayName: account.displayName, requiredForApproval: true }));
  const definition = KE.DecisionDefinition.parse({ schemaVersion: 2, decisionId: 'decision', frameVersion: 1, semanticVersion: 1,
    contextToken: 'c'.repeat(64), title: 'Garden gathering', objective: 'Choose together', description: '', participants,
    requiredParticipantIds: participants.map(item => item.id), variables: [], rules: [] });
  const app = new KnownEnoughApplication({ repository: memory, clock: { now: () => new Date(now).toISOString() }, ids: { next: () => 'synthetic' } });
  await app.createDecision({ definition, creatorSubject: subject, memberships: accounts.map(account => ({ subject: account.subject, participantId: partitionMemberId(account.subject), active: true })) });
  const record: KnownEnoughRecord = await memory.transactionDecision('decision', value => structuredClone(value!));
  for (const owner of record.owners) {
    owner.draftVersion = 1;
    owner.draft = KE.AIConstraintDraft.parse({ schemaVersion: 2, draftId: `draft-${owner.participantId}`, draftVersion: 1,
      decisionId: 'decision', ownerParticipantId: owner.participantId, ownerVersion: owner.ownerVersion, semanticVersion: 1,
      contextToken: record.definition.contextToken, sourceSummary: owner.participantId === partitionMemberId(subject) ? 'iris-private-condition' : 'omar-private-condition',
      proposedConstraints: [], unsupportedConditions: [], createdAt: new Date(now).toISOString() });
  }
  record.job = { id: 'pending-job', contextToken: record.definition.contextToken, semanticVersion: 1, epoch: record.solveEpoch };
  const guard: GuardRecord = { version: 1, incarnation: 'original-incarnation', ordinaryReceipts: replayCount,
    permissionHistoryReceipts: decisionPermissionHistoryCount(record), safetyReserveReceipts: 0, totalReceipts: replayCount };
  const data: LifecycleInventory = { entries: migration.batches.flat().flatMap(entry => entry.next ? [{ key: entry.key, row: entry.next }] : []),
    decisions: [{ record: encodedDecisionStateRecord(record), guard, replayKeys: Array.from({ length: replayCount }, (_, n) => ({
      key: { PK: 'ROOM#decision', SK: `REPLAY#${hash(String(n))}` }, hash: hash(`placeholder-${n}`) })) }] };
  return { data, record, guard, migration, app, memory };
}
