import { describe, expect, it } from 'vitest';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { KnownEnoughApplication } from '@deal-table/application';
import { parseStageSubjects, provisionStageDecision, stageDecisionDefinition } from './ke13b-provision.ts';
import { ke13bRuntimePolicy } from './ke13b-policy.ts';

const subjects = { maya: 'subject-maya', leo: 'subject-leo', nina: 'subject-nina', ana: 'subject-ana', raul: 'subject-raul' };
describe('KE13B trusted staging provisioning and policy', () => {
  it('creates only a public synthetic frame with exact pending subject bindings', async () => {
    const repository = new InMemoryRoomRepository();
    const app = new KnownEnoughApplication({ repository,
      clock: { now: () => '2026-10-01T12:00:00.000Z' }, ids: { next: () => crypto.randomUUID() } });
    await provisionStageDecision(app, subjects);
    const record = await repository.transactionDecision('christmas-decision', value => structuredClone(value));
    expect(record?.memberships).toEqual([
      { participantId: 'maya', subject: subjects.maya, active: true },
      ...(['leo', 'nina', 'ana', 'raul'] as const).map(participantId =>
        ({ participantId, subject: subjects[participantId], active: false })),
    ]);
    expect(record?.owners.every(owner => owner.confirmedConstraints.length === 0)).toBe(true);
    expect(stageDecisionDefinition().variables.every(variable => variable.visibility === 'PUBLIC')).toBe(true);
    await expect(provisionStageDecision(app, subjects)).rejects.toThrow();
  });

  it('rejects missing, duplicate and extra subject mappings', () => {
    expect(() => parseStageSubjects({ ...subjects, leo: subjects.maya })).toThrow();
    expect(() => parseStageSubjects({ ...subjects, raul: undefined })).toThrow();
    expect(() => parseStageSubjects({ ...subjects, extra: 'subject-extra' })).toThrow();
  });

  it('grants only transaction-scoped room item actions and exact log streams', () => {
    const table = 'arn:aws:dynamodb:us-east-1:123456789012:table/KnownEnoughStage';
    const logs = 'arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/known-enough-api';
    const policy = ke13bRuntimePolicy(table, logs);
    expect(policy.Statement[0].Action).toEqual(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem']);
    expect(policy.Statement[0].Resource).toBe(table);
    expect(policy.Statement[0].Condition?.['ForAllValues:StringLike']).toEqual({ 'dynamodb:LeadingKeys': ['ROOM#*'] });
    expect(policy.Statement[0].Condition?.['ForAnyValue:StringEquals']).toEqual({
      'dynamodb:EnclosingOperation': ['TransactGetItems', 'TransactWriteItems'] });
    expect(policy.Statement[1].Resource).toBe(`${logs}:*`);
    expect(JSON.stringify(policy)).not.toMatch(/DeleteItem|Query|Scan|CreateTable|iam:|cognito-idp:/);
    expect(() => ke13bRuntimePolicy('arn:aws:dynamodb:us-east-1:123456789012:table/*', logs)).toThrow();
    expect(() => ke13bRuntimePolicy(table, logs.replace('123456789012', '999999999999'))).toThrow();
  });
});
