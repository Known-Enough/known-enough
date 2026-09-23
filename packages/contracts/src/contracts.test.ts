import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PublicRoomSnapshot, OwnerSnapshot, CommandEnvelope, CommandResult, Interval, MeetingSlot,
  ConfirmedInputs, ExceptionScope, DisclosurePreview, hashPublicProposal, serializePublicProposal, normalizeDisclosureText,
} from './index';
import proposed from '../../../apps/web/src/mocks/public/proposed.json';
import owner from '../../test-support/fixtures/owner-private-review.json';
import commands from '../../test-support/fixtures/commands.json';
import results from '../../../docs/examples/command-results.json';

const clone = <T>(x: T): T => structuredClone(x);
const facts = proposed.proposal.facts;
describe('public wire boundary', () => {
  for (const name of readdirSync('apps/web/src/mocks/public')) {
    it(`validates public ${name}`, async () => {
      const raw: unknown = JSON.parse(readFileSync(`apps/web/src/mocks/public/${name}`, 'utf8'));
      const parsed = PublicRoomSnapshot.parse(raw);
      expect(parsed).toEqual(raw);
      if (parsed.proposal) expect(await hashPublicProposal(parsed.proposal.facts)).toBe(parsed.proposal.planHash);
      expect(JSON.stringify(raw)).not.toMatch(/condition-synthetic|offer-synthetic|grant-synthetic|dutyCosts|confirmedInputs|conflictCount/);
    });
  }
  for (const key of ['privateConditions', 'dutyCosts', 'grantIds', 'conflictCounts', 'rejectionReasons']) {
    it(`rejects added private field ${key}`, () => expect(PublicRoomSnapshot.safeParse({ ...proposed, [key]: [] }).success).toBe(false));
  }
  it('rejects nested leaks', () => {
    const value = clone(proposed);
    Object.assign(value.roster[0]!, { hiddenReason: 'private' });
    expect(PublicRoomSnapshot.safeParse(value).success).toBe(false);
  });
  it('rejects duplicate members and outsider approvals', () => {
    expect(PublicRoomSnapshot.safeParse({ ...proposed, roster: [proposed.roster[0], proposed.roster[0], proposed.roster[2]] }).success).toBe(false);
    expect(PublicRoomSnapshot.safeParse({ ...proposed, approvedMemberIds: ['outsider'] }).success).toBe(false);
  });
  it('rejects incomplete agreement and stale proposal context', () => {
    expect(PublicRoomSnapshot.safeParse({ ...proposed, status: 'AGREED' }).success).toBe(false);
    expect(PublicRoomSnapshot.safeParse({ ...proposed, contextToken: 'changed' }).success).toBe(false);
  });
  it('rejects active proposal in superseded snapshot', () => expect(PublicRoomSnapshot.safeParse({ ...proposed, status: 'SUPERSEDED' }).success).toBe(false));
  it('rejects double duty, unqualified assignees and invented slots', () => {
    const value = clone(proposed);
    value.proposal.facts.plan.assignments[0]!.participantId = 'leo';
    expect(PublicRoomSnapshot.safeParse(value).success).toBe(false);
    value.proposal.facts.plan.assignments[0]!.participantId = 'nina';
    expect(PublicRoomSnapshot.safeParse(value).success).toBe(false);
    value.proposal.facts.plan.assignments[0]!.participantId = 'maya';
    value.proposal.facts.plan.meeting.id = 'invented';
    expect(PublicRoomSnapshot.safeParse(value).success).toBe(false);
  });
});
describe('owner-only values and finite predicates', () => {
  it('binds the explicit review receipt to inputs while allowing stale owner confirmations', () => {
    expect(OwnerSnapshot.safeParse({ ...owner, contextToken: 'new-context' }).success).toBe(true);
    expect(OwnerSnapshot.safeParse({ ...owner, availabilityReview: { ...owner.availabilityReview, inputRevision: 99 } }).success).toBe(false);
    expect(OwnerSnapshot.safeParse({ ...owner, confirmedInputs: null }).success).toBe(false);
  });
  it('validates synthetic owner view without accepting it as public', () => {
    expect(OwnerSnapshot.parse(owner)).toEqual(owner);
    expect(PublicRoomSnapshot.safeParse(owner).success).toBe(false);
  });
  it('requires confirmed inputs', () => expect(ConfirmedInputs.safeParse({ ...owner.confirmedInputs, confirmed: false }).success).toBe(false));
  it('rejects unknown executable predicates', () => expect(ExceptionScope.safeParse({ ...owner.pendingOffers[0]!.scope, predicate: 'eval(code)' }).success).toBe(false));
  it('validates entire interval, date, timezone and duration', () => {
    const interval = facts.plan.meeting.interval;
    for (const patch of [{ endMinute: interval.startMinute }, { date: '2026-02-30' }, { timezone: 'UTC' }, { startMinute: 660.5 }])
      expect(Interval.safeParse({ ...interval, ...patch }).success).toBe(false);
    expect(MeetingSlot.safeParse({ id: 'slot', interval: { ...interval, endMinute: 705 } }).success).toBe(false);
    expect(MeetingSlot.safeParse({ id: 'slot', interval: { ...interval, endMinute: 720 } }).success).toBe(true);
  });
  it('requires normalized disclosure preview and unique audience', () => {
    const preview = owner.disclosurePreviews[0]!;
    expect(DisclosurePreview.safeParse({ ...preview, audienceMemberIds: ['maya', 'maya'] }).success).toBe(false);
    expect(DisclosurePreview.safeParse({ ...preview, text: ` ${preview.text}` }).success).toBe(false);
    expect(normalizeDisclosureText(' e\u0301\r\nline ')).toBe('é\nline');
    expect(createHash('sha256').update(preview.text).digest('hex')).toBe(preview.textHash);
  });
});
describe('command/error shapes (no authorization execution)', () => {
  it('requires explicit bounded full-interval review when confirming inputs', () => {
    const command = commands.find(x => x.type === 'CONFIRM_INPUTS')!;
    for (const reviewedIntervals of [undefined, [], Array(21).fill(facts.plan.meeting.interval), [{ ...facts.plan.meeting.interval, endMinute: 660 }]]) {
      expect(CommandEnvelope.safeParse({ ...command, payload: { ...command.payload, reviewedIntervals } }).success).toBe(false);
    }
  });
  for (const command of commands) it(`validates ${command.type} and rejects supplied owner identity`, () => {
    expect(CommandEnvelope.parse(command)).toEqual(command);
    expect(CommandEnvelope.safeParse({ ...command, ownerMemberId: 'other' }).success).toBe(false);
    expect(CommandEnvelope.safeParse({ ...command, payload: { ...command.payload, ownerId: 'other' } }).success).toBe(false);
  });
  it('requires explicit version and idempotency key', () => {
    const command = commands[0]!;
    expect(CommandEnvelope.safeParse({ ...command, expected: undefined }).success).toBe(false);
    expect(CommandEnvelope.safeParse({ ...command, idempotencyKey: '' }).success).toBe(false);
    expect(CommandEnvelope.safeParse({ ...command, expected: { ...command.expected, controlVersion: -1 } }).success).toBe(false);
  });
  it('accepts a revision fixture with reset submission indicators', () => {
    const command = commands.find(value => value.type === 'REVISE_DECISION');
    expect(command).toBeDefined();
    expect(CommandEnvelope.parse(command)).toEqual(command);
  });
  it('rejects a revision that claims a member has already submitted', () => {
    const command = CommandEnvelope.parse(commands.find(value => value.type === 'REVISE_DECISION'));
    if (command.type !== 'REVISE_DECISION') throw new Error('Missing REVISE_DECISION fixture');
    const roster = command.payload.roster.map((member, index) => index === 0 ? { ...member, submitted: true } : member);
    expect(CommandEnvelope.safeParse({ ...command, payload: { ...command.payload, roster } }).success).toBe(false);
  });
  it('rejects revised duty qualifications outside the revised roster', () => {
    const command = CommandEnvelope.parse(commands.find(value => value.type === 'REVISE_DECISION'));
    if (command.type !== 'REVISE_DECISION') throw new Error('Missing REVISE_DECISION fixture');
    const value = clone(command);
    value.payload.schedule.duties[0]!.qualifiedMemberIds = ['outsider'];
    expect(CommandEnvelope.safeParse(value).success).toBe(false);
  });
  for (const result of results) it(`validates result ${result.ok ? 'APPLIED' : result.error!.code}`, () => expect(CommandResult.parse(result)).toEqual(result));
  it('accepts retryable server failures and bounded-history capacity results with exact status codes', () => {
    expect(CommandResult.parse({ ok: false, requestId: 'r', error: { code: 'RETRYABLE_SERVER_ERROR', httpStatus: 503 } }))
      .toEqual({ ok: false, requestId: 'r', error: { code: 'RETRYABLE_SERVER_ERROR', httpStatus: 503 } });
    expect(CommandResult.parse({ ok: false, requestId: 'r', error: { code: 'ROOM_CAPACITY_REACHED', httpStatus: 409 } }))
      .toEqual({ ok: false, requestId: 'r', error: { code: 'ROOM_CAPACITY_REACHED', httpStatus: 409 } });
  });
  it('rejects status mismatches and error detail leaks', () => {
    expect(CommandResult.safeParse({ ok: false, requestId: 'r', error: { code: 'STALE_CONTEXT', httpStatus: 422 } }).success).toBe(false);
    expect(CommandResult.safeParse({ ok: false, requestId: 'r', error: { code: 'NOT_FOUND', httpStatus: 404, ownerExists: true } }).success).toBe(false);
  });
});
describe('public hash v1', () => {
  it('matches independently generated SHA-256 vector', async () => {
    expect(await hashPublicProposal(facts)).toBe(proposed.proposal.planHash);
    expect(await hashPublicProposal(facts)).toBe(createHash('sha256').update(serializePublicProposal(facts)).digest('hex'));
  });
  it('ignores object key and set ordering without mutating input', async () => {
    const value = clone(facts); value.rosterMemberIds.reverse(); value.plan.assignments.reverse();
    value.plan.assignments.forEach(a => a.duty.qualifiedMemberIds.reverse());
    const before = clone(value);
    expect(await hashPublicProposal(value)).toBe(await hashPublicProposal(facts));
    expect(value).toEqual(before);
    expect(await hashPublicProposal(Object.fromEntries(Object.entries(facts).reverse()))).toBe(await hashPublicProposal(facts));
  });
  it('changes with context, proposal version, policy, duration or assignments', async () => {
    const variants = [
      { ...facts, contextToken: 'other' }, { ...facts, proposalVersion: 2 }, { ...facts, policy: 'LOWEST_INCONVENIENCE' },
      { ...facts, plan: { ...facts.plan, meeting: { ...facts.plan.meeting, interval: { ...facts.plan.meeting.interval, endMinute: 720 } } } },
      { ...facts, plan: { ...facts.plan, assignments: facts.plan.assignments.map(a => ({ ...a, participantId: a.participantId === 'maya' ? 'leo' : 'maya' })) } },
    ];
    for (const variant of variants) expect(await hashPublicProposal(variant)).not.toBe(await hashPublicProposal(facts));
  });
  it('rejects private hash dependencies', async () => expect(hashPublicProposal({ ...facts, privateInputHash: 'secret' })).rejects.toThrow());
});
