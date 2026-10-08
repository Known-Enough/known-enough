import { expect, it, vi } from 'vitest';
import { KnownEnough as KE } from '@deal-table/contracts';
import { createPartitionedGroupRepository, type PartitionMutation, type PartitionRow } from './partitioned-group-repository.ts';
import { partitionMemberId } from './partition-group-session.ts';
import { decisionPermissionHistoryCount } from './dynamodb-codec.ts';
import { RetentionPolicy, LifecycleConsent, LifecycleJournal, retentionDeadline, ownerLifecycleExport, eraseDecisionOwner,
  prepareLifecyclePlan, sealLifecyclePlan, loadLifecyclePlan, lifecycleHash, createLifecycleRunner,
  type LifecyclePorts, type LifecyclePlan } from './partition-lifecycle.ts';
import { lifecycleFixture, sourceSha, subject, now, principal, policy, stamp, signingKey, hash } from './test-support/partition-lifecycle-fixture.ts';

it('exports an explicit owned allowlist and excludes another owner, email/directory/job/shared/replay bytes', async () => {
  const f = await lifecycleFixture(); const output = ownerLifecycleExport(f.data, principal(), policy, stamp, now); const bytes = JSON.stringify(output);
  expect(bytes).toContain('iris-private-condition'); expect(bytes).not.toMatch(/omar-private-condition|emailHash|creatorSubject|pending-job|tokenHash|bodyHash|incarnation|REPLAY#/);
  output.decisions[0]!.own!.draft!.sourceSummary = 'client-edited'; expect(f.record.owners[0]!.draft!.sourceSummary).toBe('iris-private-condition');
  expect(ownerLifecycleExport(f.data, principal('omar'), policy, stamp, now).decisions[0]!.own!.draft!.sourceSummary).toBe('omar-private-condition');
});
it.each([null, { kind: 'display', subject, roomId: 'decision' } as const, { kind: 'service', subject, roomIds: ['decision'] } as const])(
  'denies nonparticipant export authority %j', async actor => {
  const f = await lifecycleFixture(); expect(() => ownerLifecycleExport(f.data, actor, policy, stamp, now)).toThrow('LIFECYCLE_AUTHORITY_DENIED');
});
it('denies cross-owner account export and disabled/future/expired/unapproved policy/stamp use', async () => {
  const f = await lifecycleFixture(); expect(() => ownerLifecycleExport(f.data, principal('stranger'), policy, stamp, now)).toThrow('LIFECYCLE_AUTHORITY_DENIED');
  expect(() => ownerLifecycleExport(f.data, principal(), { ...policy, enabled: false }, stamp, now)).toThrow('LIFECYCLE_POLICY_DENIED');
  expect(() => ownerLifecycleExport(f.data, principal(), policy, { ...stamp, policyRevision: 2 }, now)).toThrow('LIFECYCLE_POLICY_DENIED');
  expect(() => ownerLifecycleExport(f.data, principal(), policy, stamp, retentionDeadline(policy, stamp))).toThrow('LIFECYCLE_EXPIRED');
  expect(() => ownerLifecycleExport(f.data, principal(), policy, stamp, Date.parse(stamp.lastActivityAt) - 1)).toThrow('LIFECYCLE_INVALID');
  expect(RetentionPolicy.safeParse({ ...policy, dataClass: 'REAL_PERSON' }).success).toBe(false);
  expect(RetentionPolicy.safeParse({ ...policy, rawConversationMs: 1 }).success).toBe(false);
});
it('keeps an erasure plan recovery free of private conditions while binding source/scope/op/policy to its MAC', async () => {
  const f = await lifecycleFixture(); const plan = prepareLifecyclePlan(f.data, { kind: 'OWNER', subject, decisionId: 'decision' }, sourceSha, 'erase-owner', policy);
  const bytes = sealLifecyclePlan(plan, signingKey); const expected = { sourceSha, planHash: lifecycleHash(plan), opId: plan.opId };
  expect(bytes.toString()).not.toMatch(/private-condition|sourceSummary|displayName|emailHash|result|original-incarnation/);
  expect(loadLifecyclePlan(bytes, signingKey, expected)).toEqual(plan);
  const seal = JSON.parse(bytes.toString()); seal.payload = seal.payload.replace('"subject":"iris"', '"subject":"omar"');
  expect(() => loadLifecyclePlan(Buffer.from(JSON.stringify(seal)), signingKey, expected)).toThrow('LIFECYCLE_AUTHORITY_DENIED');
  expect(() => loadLifecyclePlan(bytes, Buffer.alloc(32, 4), expected)).toThrow('LIFECYCLE_AUTHORITY_DENIED');
  expect(() => loadLifecyclePlan(bytes, signingKey, { ...expected, sourceSha: 'b'.repeat(40) })).toThrow('LIFECYCLE_SOURCE_CHANGED');
});
it('requires every affected participant for group/decision erasure, while account/owner plans require only their owner', async () => {
  const f = await lifecycleFixture(33);
  for (const scope of [{ kind: 'GROUP', groupId: 'garden' }, { kind: 'DECISION', decisionId: 'decision' }] as const) {
    const plan = prepareLifecyclePlan(f.data, scope, sourceSha, 'erase-shared', policy); expect(plan.requiredSubjects).toEqual(['iris', 'omar']);
    expect(plan.steps.filter(step => step.kind === 'REPLAYS').map(step => step.rows.length)).toEqual([16, 16, 1]);
  }
  for (const scope of [{ kind: 'ACCOUNT', subject }, { kind: 'OWNER', decisionId: 'decision', subject }] as const) {
    expect(prepareLifecyclePlan(f.data, scope, sourceSha, 'erase-own', policy).requiredSubjects).toEqual([subject]);
  }
  expect(() => prepareLifecyclePlan(f.data, { kind: 'OWNER', decisionId: 'decision', subject: 'stranger' }, sourceSha, 'bad', policy)).toThrow('LIFECYCLE_AUTHORITY_DENIED');
});
it('erases owned structured content, retires dependent consent/jobs and preserves other private inputs', async () => {
  const f = await lifecycleFixture(); const otherId = partitionMemberId('omar'); const other = f.record.owners.find(owner => owner.participantId === otherId)!;
  other.negotiationPermissions.push(KE.NegotiationPermission.parse({ permissionId: 'permission', permissionVersion: 1, decisionId: 'decision',
    ownerParticipantId: otherId, semanticVersion: 1, contextToken: f.record.definition.contextToken, questionId: 'question', requestIdentity: hash('request'),
    constraintId: 'constraint', constraintVersion: 1, adjustment: { operator: 'IN', id: 'rule', variableId: 'choice', visibility: 'TRUSTED_BACKEND', values: [{ type: 'ENUM', optionId: 'a' }] },
    status: 'ACTIVE', expiresAt: '2026-10-09T00:00:00.000Z' }));
  const next = eraseDecisionOwner(f.record, subject); const owned = next.owners.find(owner => owner.participantId === partitionMemberId(subject))!;
  expect(owned.draft).toBeNull(); expect(owned.confirmedConstraints).toEqual([]); expect(owned.ownerVersion).toBeGreaterThan(f.record.owners[0]!.ownerVersion);
  expect(next.owners.find(owner => owner.participantId === otherId)!.draft).toEqual(other.draft);
  expect(next.owners.find(owner => owner.participantId === otherId)!.negotiationPermissions[0]!.status).toBe('SUPERSEDED');
  expect(decisionPermissionHistoryCount(next)).toBe(1); expect(next.job).toBeNull(); expect(next.solveEpoch).toBe(f.record.solveEpoch + 1);
  expect(next.controlVersion).toBe(f.record.controlVersion + 1); expect(next.replays).toEqual([]);
  expect(next.memberships.find(member => member.subject === subject)!.active).toBe(false);
  expect(next.definition.participants.find(member => member.id === partitionMemberId(subject))!.displayName).toBe('Erased participant');
  expect(f.record.owners[0]!.draft).not.toBeNull();
});
function storage(plan: LifecyclePlan) {
  let j: LifecycleJournal | null = null; let lose = false; let unavailable = false; let allowed = true;
  const grant = (who: string) => LifecycleConsent.parse({ schemaVersion: 1, kind: 'ERASURE_CONSENT', revision: 1, opId: plan.opId,
    planHash: lifecycleHash(plan), sourceSha, policyRevision: 1, subject: who, grantedAt: '2026-10-08T00:00:00Z', expiresAt: '2026-10-08T02:00:00Z', revoked: !allowed });
  const ports: LifecyclePorts = { policy: async () => policy, consent: async who => grant(who), journal: async () => { if (unavailable) throw new Error('synthetic unavailable'); return structuredClone(j); },
    recovery: async () => true, commit: vi.fn(async (_, prior, next) => {
      if (lifecycleHash(j) !== lifecycleHash(prior)) return false; j = structuredClone(next);
      if (lose) { lose = false; throw new Error('synthetic lost acknowledgement'); } return true;
    }) };
  return { ports, runner: () => createLifecycleRunner(ports, plan, { clock: () => now }), revoke: () => { allowed = false; },
    lose: () => { lose = true; }, unknown: () => { unavailable = true; }, journal: () => structuredClone(j) };
}
it('prepares durable progress before erasure, resumes restart/interruption and reconciles lost acknowledgements once', async () => {
  const f = await lifecycleFixture(); const plan = prepareLifecyclePlan(f.data, { kind: 'OWNER', subject, decisionId: 'decision' }, sourceSha, 'resume', policy);
  const store = storage(plan); expect((await store.runner().advance()).state).toBe('PREPARED');
  store.lose(); expect((await store.runner().advance()).nextStep).toBe(1);
  while (store.journal()!.state !== 'ERASED') await store.runner().advance();
  const calls = vi.mocked(store.ports.commit).mock.calls.length; expect((await store.runner().advance()).state).toBe('ERASED');
  expect(vi.mocked(store.ports.commit).mock.calls.length).toBe(calls);
});
it('rechecks revocation at resume and does not invent completion from an unavailable journal', async () => {
  const f = await lifecycleFixture(); const plan = prepareLifecyclePlan(f.data, { kind: 'OWNER', subject, decisionId: 'decision' }, sourceSha, 'revocation', policy);
  const store = storage(plan); await store.runner().advance(); store.revoke(); await expect(store.runner().advance()).rejects.toThrow('LIFECYCLE_AUTHORITY_DENIED');
  expect(store.journal()!.state).toBe('PREPARED');
});
it('advances discovery-account revisions on create/remove while retaining unrelated group concurrency', async () => {
  const rows = new Map<string, PartitionRow>(); const key = (value: { PK: string; SK: string }) => `${value.PK}/${value.SK}`;
  const repository = createPartitionedGroupRepository({ read: async k => structuredClone(rows.get(key(k)) ?? null), commit: async (writes: PartitionMutation[]) => {
    if (writes.some(write => (rows.get(key(write.key))?.revision ?? 0) !== write.expected)) return false;
    writes.forEach(write => { if (write.next) rows.set(key(write.key), structuredClone(write.next)); }); return true;
  } });
  await repository.transaction({ accountSubjects: [subject], groupId: 'one' }, state => {
    state.accounts.push({ subject, emailHash: hash(subject), displayName: 'Iris', status: 'APPROVED', version: 1 });
    state.groups.push({ id: 'one', name: 'One', organizer: subject, version: 1, members: [subject], drafts: [], decisions: [], invitations: [] });
  });
  const before = rows.get('ACCOUNT#iris/STATE')!.revision;
  await repository.transaction({ accountSubjects: [subject], groupId: 'two' }, state => state.groups.push({ id: 'two', name: 'Two', organizer: subject,
    version: 1, members: [subject], drafts: [], decisions: [], invitations: [] }));
  expect(rows.get('ACCOUNT#iris/STATE')!.revision).toBe(before + 1);
  const fenced = await repository.fence({ accountSubjects: [subject] }, () => {});
  await repository.transaction({ accountSubjects: [subject], groupId: 'three' }, state => state.groups.push({ id: 'three', name: 'Three', organizer: subject,
    version: 1, members: [subject], drafts: [], decisions: [], invitations: [] }));
  await expect(fenced.assertCurrent()).rejects.toThrow('PARTITION_STALE');
});
it('rejects a real application late candidate after erasure invalidates its pending job and epoch', async () => {
  const f = await lifecycleFixture(); const erased = eraseDecisionOwner(f.record, subject);
  await f.memory.transactionDecision('decision', value => { Object.assign(value!, erased); });
  const candidate = KE.CandidateProposal.parse({ schemaVersion: 2, proposalId: 'late-proposal', decisionId: 'decision', semanticVersion: 1,
    contextToken: f.record.definition.contextToken, proposalVersion: 1, values: [], permissionDependencies: [], createdAt: new Date(now).toISOString(),
    validation: { status: 'VALID', checkedRuleIds: [], failedRuleIds: [], unknownRuleIds: [], unsupportedConditionIds: [] } });
  expect(await f.app.completeReasoning({ kind: 'service', subject: 'model-runtime', roomIds: ['decision'] }, 'decision', 'pending-job', candidate)).toBe('STALE');
  const current = await f.memory.transactionDecision('decision', value => value!);
  expect(current.job).toBeNull(); expect(current.pendingCandidate).toBeNull(); expect(current.owners[0]!.draft).toBeNull();
});
it('applies distinct bounded logical retention deadlines and never assumes backup/provider deletion windows', () => {
  expect(retentionDeadline(policy, stamp, 'REPLAY')).toBe(Date.parse(stamp.lastActivityAt) + policy.replayMs);
  expect(retentionDeadline(policy, stamp, 'JOURNAL')).toBe(Date.parse(stamp.lastActivityAt) + policy.journalMs);
  expect(policy.backupMs).toBeNull(); expect(policy.providerMs).toBeNull();
});
