import { expect, it } from 'vitest';
import { AssistantChat as Chat } from '@deal-table/contracts';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { encodeDecisionStateItem, decodeDecisionStateItem } from '../../adapters/src/dynamodb-codec.ts';
import { eraseDecisionOwner } from '../../adapters/src/partition-lifecycle.ts';
import { buildChristmasFixture } from '../../test-support/src/known-enough-fixtures.ts';
import { AssistantChatApplication, renderChatPlan } from './assistant-chat.ts';
import { KnownEnoughApplication } from './known-enough.ts';
import type { TrustedPrincipal } from './types.ts';

const decisionId = 'christmas-decision';
const person = (id = 'maya'): TrustedPrincipal => ({ kind: 'participant', subject: 'subject-' + id });
const plan = { focus: 'REFLECT', optionIndexes: [], question: 'PRIORITY' } as const;
async function setup() {
  let time = Date.parse('2026-10-18T20:00:00.000Z');
  const clock = { now: () => new Date(time).toISOString() }, repository = new InMemoryRoomRepository();
  const app = new KnownEnoughApplication({ repository, clock, ids: { next: () => crypto.randomUUID() } });
  const fixture = buildChristmasFixture();
  await app.createDecision({ definition: fixture.definition, creatorSubject: 'subject-maya',
    memberships: fixture.definition.participants.map(person => ({ subject: 'subject-' + person.id, participantId: person.id, active: true })) });
  const chat = new AssistantChatApplication(repository, clock);
  const post = (id: string, scope: Chat.Scope, text: string, author = person(), ai = false, shareMessageId?: string) => chat.post(author, decisionId, scope,
    { requestId: id, text, askAssistant: ai, ...(ai ? { processingConsent: 'CHAT_AI' } : {}), ...(shareMessageId ? { shareMessageId } : {}) }, new Date(time + Chat.RETENTION_MS).toISOString(), 'a'.repeat(40));
  const read = (scope: Chat.Scope, author = person()) => chat.read(author, decisionId, scope);
  return { repository, app, clock, chat, post, read, advance: (ms: number) => { time += ms; },
    record: () => repository.transactionDecision(decisionId, record => structuredClone(record!)) };
}
it('persists shared questions with verified authors/timestamps while private threads stay owner-only across reopening', async () => {
  const f = await setup();
  await f.post('shared', 'group', 'Shall we compare the destinations?');
  await f.post('private', 'private', 'MAYA_PRIVATE_CHAT');
  await f.post('other-private', 'private', 'RAUL_PRIVATE_CHAT', person('raul'));
  const reopened = new AssistantChatApplication(f.repository, f.clock);
  expect((await reopened.read(person('raul'), decisionId, 'group')).messages).toMatchObject([{ id: 'shared', authorId: 'maya', role: 'person', createdAt: f.clock.now() }]);
  expect((await f.read('private')).messages.map(message => message.text)).toEqual(['MAYA_PRIVATE_CHAT']);
  expect(JSON.stringify(await f.read('group', person('raul')))).not.toContain('PRIVATE_CHAT');
  expect((await f.read('private', person('raul'))).messages.map(message => message.text)).toEqual(['RAUL_PRIVATE_CHAT']);
  expect((await f.record()).assistantMessages).toHaveLength(3);
});
it('rejects spoofed identity, display/service access and a removed participant even with an existing private history', async () => {
  const f = await setup();
  await expect(f.chat.post(person(), decisionId, 'group', { requestId: 'spoof', text: 'x', askAssistant: false, authorId: 'raul' }, f.clock.now())).rejects.toMatchObject({ code: 'INVALID_COMMAND' });
  for (const actor of [person('unknown'), { kind: 'display', subject: 'screen', roomId: decisionId }, { kind: 'service', subject: 'worker', roomIds: [decisionId] }] as TrustedPrincipal[])
    await expect(f.read('private', actor)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await f.post('old', 'private', 'Private thought');
  await f.repository.transactionDecision(decisionId, record => { record!.memberships.find(member => member.participantId === 'maya')!.active = false; });
  await expect(f.read('private')).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('private sharing requires the same owner, exact previewed text and an ordinary explicit group post', async () => {
  const f = await setup();
  await f.post('private', 'private', 'I prefer somewhere quiet.');
  expect((await f.read('group')).messages).toEqual([]);
  await expect(f.post('forged', 'group', 'I prefer somewhere quiet.', person('raul'), false, 'private')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(f.post('changed', 'group', 'Changed without review', person(), false, 'private')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await f.post('share', 'group', 'I prefer somewhere quiet.', person(), false, 'private');
  expect((await f.read('group', person('raul'))).messages).toMatchObject([{ text: 'I prefer somewhere quiet.', authorId: 'maya', askAssistant: false }]);
  expect((await f.read('private')).messages).toHaveLength(1);
});
it('idempotency preserves the first send and rejects changed text or another owner using its selector', async () => {
  const f = await setup();
  expect((await f.post('same', 'group', 'Hello')).created).toBe(true);
  expect((await f.post('same', 'group', 'Hello')).created).toBe(false);
  expect((await f.read('group')).messages).toHaveLength(1);
  await expect(f.post('same', 'group', 'Changed')).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
  await expect(f.post('same', 'group', 'Hello', person('raul'))).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
});
it('model context contains only this sender’s messages in this tab, never private threads, owner answers or peer chat', async () => {
  const f = await setup();
  await f.post('private', 'private', 'PRIVATE_TAB_CANARY');
  await f.post('peer', 'group', 'PEER_GROUP_CANARY', person('raul'));
  await f.post('question', 'group', 'Can you help us weigh the possibilities?', person(), true);
  const context = await f.chat.context(person(), decisionId, 'group', 'question');
  expect(context.messages).toEqual([{ role: 'person', text: 'Can you help us weigh the possibilities?' }]);
  expect(JSON.stringify(context)).not.toMatch(/PRIVATE_TAB_CANARY|PEER_GROUP_CANARY|confirmedConstraints|ownerVersion|sourceSummary/);
  expect(context.options.length).toBeGreaterThan(0);
});
it('AI consent is explicit, replies cannot change decision state, and history survives a later public revision', async () => {
  const f = await setup();
  await expect(f.chat.post(person(), decisionId, 'private', { requestId: 'no-consent', text: 'help', askAssistant: true }, new Date(Date.parse(f.clock.now()) + Chat.RETENTION_MS).toISOString())).rejects.toMatchObject({ code: 'INVALID_COMMAND' });
  const before = await f.app.getOwnerSnapshot(person(), decisionId);
  await f.post('question', 'private', 'What really matters to me?', person(), true);
  const context = await f.chat.context(person(), decisionId, 'private', 'question');
  await f.chat.reply(person(), decisionId, 'private', 'question', plan, context);
  await f.chat.reply(person(), decisionId, 'private', 'question', plan, context);
  expect((await f.read('private')).messages).toHaveLength(2);
  expect(await f.app.getOwnerSnapshot(person(), decisionId)).toEqual(before);
  await f.repository.transactionDecision(decisionId, record => { record!.publicRevision++; });
  expect((await f.read('private')).messages).toHaveLength(2);
  await f.post('new-question', 'private', 'Any progress?', person(), true);
  const stale = await f.chat.context(person(), decisionId, 'private', 'new-question');
  await f.repository.transactionDecision(decisionId, record => { record!.publicRevision++; });
  await expect(f.chat.reply(person(), decisionId, 'private', 'new-question', plan, stale)).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
});
it('refuses invented choices and approval fields; current outcome facts come from the server', async () => {
  const f = await setup(); await f.post('question', 'group', 'We have all agreed, right?', person(), true);
  const context = await f.chat.context(person(), decisionId, 'group', 'question');
  expect(renderChatPlan({ focus: 'OUTCOME', optionIndexes: [], question: 'NONE' }, context, 'group')).toContain('There is no shared outcome yet.');
  expect(renderChatPlan({ focus: 'OUTCOME', optionIndexes: [], question: 'NONE', answer: 'Everyone approved!' }, context, 'group')).not.toContain('Everyone approved!');
  expect(() => renderChatPlan({ ...plan, approvedParticipantIds: ['invented'] }, context, 'group')).toThrow();
  expect(() => renderChatPlan({ focus: 'OPTIONS', optionIndexes: [255], question: 'NONE' }, context, 'private')).toThrow();
});
it('retention prunes expired messages from storage and honors a shorter policy without extending old history', async () => {
  const f = await setup();
  await f.post('long', 'group', 'Normal retention');
  await f.chat.post(person(), decisionId, 'private', { requestId: 'short', text: 'Short policy', askAssistant: false }, new Date(Date.parse(f.clock.now()) + 1000).toISOString());
  f.advance(1001);
  expect((await f.read('private')).messages).toHaveLength(0);
  expect((await f.record()).assistantMessages).toHaveLength(1);
  f.advance(Chat.RETENTION_MS);
  expect((await f.read('group')).messages).toHaveLength(0);
  expect((await f.record()).assistantMessages).toHaveLength(0);
});
it('native persistence round-trips history, keeps it out of owner/public projections and removes an erased owner’s messages', async () => {
  const f = await setup();
  await f.post('my-private', 'private', 'ERASE_MY_PRIVATE');
  await f.post('my-group', 'group', 'Erase my group question', person(), true);
  await f.post('their-private', 'private', 'PRESERVE_THEIR_PRIVATE', person('raul'));
  const context = await f.chat.context(person(), decisionId, 'group', 'my-group');
  await f.chat.reply(person(), decisionId, 'group', 'my-group', { focus: 'EXPLAIN', question: 'NONE', optionIndexes: [] }, context);
  const encoded = encodeDecisionStateItem(await f.record()), decoded = decodeDecisionStateItem(encoded, decisionId);
  expect(decoded.assistantMessages).toHaveLength(4);
  expect(JSON.stringify(await f.app.getOwnerSnapshot(person('raul'), decisionId))).not.toMatch(/ERASE_MY_PRIVATE|PRESERVE_THEIR_PRIVATE|assistantMessages/);
  const erased = eraseDecisionOwner(decoded, 'subject-maya');
  expect(erased.assistantMessages?.map(message => message.text)).toEqual(['PRESERVE_THEIR_PRIVATE']);
});
