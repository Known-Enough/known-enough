import {
  DynamoDBClient, TransactGetItemsCommand, TransactWriteItemsCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { describe, expect, it } from 'vitest';
import { DealTableApplication, type TrustedPrincipal } from '@deal-table/application';
import { DynamoDBRoomRepository } from '@deal-table/adapters';
import { CommandResult, type CommandEnvelope, type DisclosurePreview, type ExceptionOffer } from '@deal-table/contracts';
import { buildTeamTableFixture } from '@deal-table/test-support';
import { RepositoryCapacityError } from '@deal-table/application';
import {
  decodeStateItem, encodeStateItem, pendingResponseByteReservations, permissionHistoryCount, stateItemSizeBytes,
} from '../../packages/adapters/src/dynamodb-codec.ts';

type Item = Record<string, AttributeValue>;
type FakeGet = { TableName: string; Key: Item };
type FakePut = {
  TableName: string; Item: Item; ConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
};
type FakeUpdate = {
  TableName: string; Key: Item; UpdateExpression: string; ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>; ExpressionAttributeValues: Record<string, AttributeValue>;
};
type FakeAction = { Get?: FakeGet; Put?: FakePut; Update?: FakeUpdate };
type FakeInput = { TransactItems: FakeAction[] };
type FakeResponse = { Responses?: { Item?: Item }[] };

const roomId = 'room-durable';
const service: TrustedPrincipal = { kind: 'service', subject: 'worker', roomIds: [roomId] };
const actor = (subject: string): TrustedPrincipal => ({ kind: 'participant', subject });
const display: TrustedPrincipal = { kind: 'display', subject: 'display-device', roomId };

function stringValue(value: AttributeValue | undefined): string | undefined {
  return value && 'S' in value ? value.S : undefined;
}
function storageKey(value: Item): string {
  return (stringValue(value.PK) ?? '') + '#' + (stringValue(value.SK) ?? '');
}
function canceledWith(reasons: unknown[]): Error {
  const error = new Error('synthetic transaction cancellation') as Error & {
    CancellationReasons: unknown[];
  };
  error.name = 'TransactionCanceledException';
  error.CancellationReasons = reasons;
  return error;
}
function canceled(): Error {
  return canceledWith([{ Code: 'ConditionalCheckFailed', Message: 'The conditional request failed.' }]);
}

function inflateForCapacity(base: ReturnType<typeof decodeStateItem>, fixture: ReturnType<typeof buildTeamTableFixture>, historyCount: number, publicCount: number) {
  const room = structuredClone({ ...base, replays: [] });
  const rosterIds = room.roster.map(member => member.id);
  for (let index = 0; index < historyCount; index += 1) {
    const suffix = String(index).padStart(3, '0');
    const owner = room.owners[index % room.owners.length]!;
    const preview = {
      id: 'p'.repeat(76) + suffix,
      text: '\u0000'.repeat(500),
      textHash: 'f'.repeat(64),
      audienceMemberIds: rosterIds,
      roomId: room.roomId,
      contextToken: 'prior-context',
      decisionRevision: room.decisionRevision,
      expiresAt: fixture.now,
      inferenceWarning: 'People may infer who changed availability from the plan. Published words cannot be made secret again.' as const,
    };
    owner.disclosures.push({ id: 'g'.repeat(76) + suffix, version: 1, preview, status: 'DECLINED', publishedAt: null });
  }
  room.publishedDisclosures = Array.from({ length: publicCount }, () => ({
    text: '\u0000'.repeat(500), audienceMemberIds: rosterIds, publishedAt: fixture.now,
    contextToken: room.contextToken, decisionRevision: room.decisionRevision,
  }));
  return room;
}
function makeCapacityOffer(room: ReturnType<typeof decodeStateItem>, fixture: ReturnType<typeof buildTeamTableFixture>): ExceptionOffer {
  return {
    id: 'pending-capacity-offer', version: 1,
    scope: {
      conditionId: 'nina-capacity-condition', roomId: room.roomId, contextToken: room.contextToken,
      decisionRevision: room.decisionRevision, inputRevision: 1,
      rosterMemberIds: room.roster.map(member => member.id), policy: room.policy,
      meeting: structuredClone(room.schedule.slots[0]!), predicate: 'OWNER_HAS_NO_WEEKEND_DUTIES',
      expiresAt: new Date(Date.parse(fixture.now) + 15 * 60_000).toISOString(),
    },
  };
}
function setOffer(room: ReturnType<typeof decodeStateItem>, offer: ExceptionOffer): void {
  room.status = 'PRIVATE_REVIEW';
  room.roundUsed = true;
  room.owners.find(owner => owner.memberId === 'nina')!.offers.push(offer);
}

function makeCapacityPreview(room: ReturnType<typeof decodeStateItem>, fixture: ReturnType<typeof buildTeamTableFixture>): DisclosurePreview {
  return {
    id: 'pending-capacity-preview', text: '\u0000'.repeat(500), textHash: 'f'.repeat(64),
    audienceMemberIds: room.roster.map(member => member.id), roomId: room.roomId,
    contextToken: room.contextToken, decisionRevision: room.decisionRevision,
    expiresAt: new Date(Date.parse(fixture.now) + 15 * 60_000).toISOString(),
    inferenceWarning: 'People may infer who changed availability from the plan. Published words cannot be made secret again.',
  };
}
function setPreview(room: ReturnType<typeof decodeStateItem>, preview: DisclosurePreview): void {
  room.status = 'PRIVATE_REVIEW';
  room.owners.find(owner => owner.memberId === 'nina')!.previews.push(preview);
}

class FakeDynamoDBClient {
  private rows = new Map<string, Item>();
  private writeTail: Promise<void> = Promise.resolve();
  readonly commands: string[] = [];
  writeAttempts = 0;
  private loseNextWriteResponse = false;
  private nextWriteError: Error | null = null;

  failNextWriteAfterCommit(): void { this.loseNextWriteResponse = true; }
  failNextWrite(error: Error): void { this.nextWriteError = error; }
  item(room: string, sortKey: string): Item | undefined {
    const found = this.rows.get('ROOM#' + room + '#' + sortKey);
    return found ? structuredClone(found) : undefined;
  }
  items(room: string): Item[] {
    return [...this.rows.values()].filter(value => stringValue(value.PK) === 'ROOM#' + room).map(value => structuredClone(value));
  }
  delete(room: string, sortKey: string): void { this.rows.delete('ROOM#' + room + '#' + sortKey); }
  replace(room: string, sortKey: string, item: Item): void { this.rows.set('ROOM#' + room + '#' + sortKey, structuredClone(item)); }
  setCounters(room: string, values: {
    ordinary: number; permission: number; safety: number; total: number;
  }): void {
    const item = this.rows.get('ROOM#' + room + '#GUARD');
    if (!item) throw new Error('Missing fake GUARD');
    item.ordinaryReceipts = { N: String(values.ordinary) };
    item.permissionHistoryReceipts = { N: String(values.permission) };
    item.safetyReserveReceipts = { N: String(values.safety) };
    item.totalReceipts = { N: String(values.total) };
  }

  async send(command: TransactGetItemsCommand | TransactWriteItemsCommand): Promise<unknown> {
    this.commands.push(command.constructor.name);
    if (command instanceof TransactGetItemsCommand) return this.read(command.input as unknown as FakeInput);
    if (command instanceof TransactWriteItemsCommand) return this.write(command.input as unknown as FakeInput);
    throw new Error('Unexpected DynamoDB command');
  }

  private read(input: FakeInput): FakeResponse {
    return {
      Responses: input.TransactItems.map(action => {
        if (!action.Get) throw new Error('Expected TransactGetItems Get action');
        const found = this.rows.get(storageKey(action.Get.Key));
        return found ? { Item: structuredClone(found) } : {};
      }),
    };
  }

  private async write(input: FakeInput): Promise<object> {
    this.writeAttempts += 1;
    const previous = this.writeTail;
    let release!: () => void;
    this.writeTail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      if (this.nextWriteError) {
        const error = this.nextWriteError;
        this.nextWriteError = null;
        throw error;
      }
      const next = new Map([...this.rows.entries()].map(([key, value]) => [key, structuredClone(value)]));
      for (const action of input.TransactItems) {
        if (action.Put) {
          const key = storageKey(action.Put.Item);
          const prior = next.get(key);
          const condition = action.Put.ConditionExpression ?? '';
          const existsAlias = /attribute_exists\((#[A-Za-z0-9_]+)\)/.exec(condition)?.[1];
          const absentAlias = /attribute_not_exists\((#[A-Za-z0-9_]+)\)/.exec(condition)?.[1];
          const attribute = existsAlias || absentAlias
            ? action.Put.ExpressionAttributeNames?.[existsAlias ?? absentAlias!] : undefined;
          const exists = attribute ? next.get(key)?.[attribute] !== undefined : prior !== undefined;
          if ((existsAlias && !exists) || (absentAlias && exists)) throw canceled();
          next.set(key, structuredClone(action.Put.Item));
        } else if (action.Update) {
          const update = action.Update;
          const key = storageKey(update.Key);
          const current = next.get(key);
          if (!current) throw canceled();
          for (const match of update.ConditionExpression.matchAll(/(#[A-Za-z0-9_]+)\s*=\s*(:[A-Za-z0-9_]+)/g)) {
            const attribute = update.ExpressionAttributeNames[match[1]!];
            const expected = update.ExpressionAttributeValues[match[2]!];
            if (!attribute || !expected || JSON.stringify(current[attribute]) !== JSON.stringify(expected)) throw canceled();
          }
          const changed = structuredClone(current);
          for (const match of update.UpdateExpression.replace(/^SET\s+/, '').split(/,\s*/)) {
            const assignment = /(#[A-Za-z0-9_]+)\s*=\s*(:[A-Za-z0-9_]+)/.exec(match);
            if (!assignment) throw new Error('Invalid fake update expression');
            const attribute = update.ExpressionAttributeNames[assignment[1]!];
            const value = update.ExpressionAttributeValues[assignment[2]!];
            if (!attribute || !value) throw new Error('Missing fake update value');
            changed[attribute] = structuredClone(value);
          }
          next.set(key, changed);
        } else {
          throw new Error('Unexpected fake transaction action');
        }
      }
      this.rows = next;
      if (this.loseNextWriteResponse) {
        this.loseNextWriteResponse = false;
        const error = new Error('simulated lost transaction response');
        error.name = 'TimeoutError';
        throw error;
      }
      return {};
    } finally {
      release();
    }
  }
}

async function harness() {
  const fixture = buildTeamTableFixture();
  let now = fixture.now;
  let sequence = 0;
  const client = new FakeDynamoDBClient();
  const repository = new DynamoDBRoomRepository({
    client: client as unknown as DynamoDBClient,
    tableName: 'DealTableRooms',
    maxAttempts: 8,
    random: () => 0.5,
    pause: async () => undefined,
  });
  const app = new DealTableApplication({
    repository,
    clock: { now: () => now },
    ids: { next: () => 'dynamo-id-' + (++sequence) },
  });
  await app.createRoom({
    roomId,
    schedule: fixture.schedule,
    roster: fixture.roster.map(member => ({ ...member, submitted: false })),
    policy: fixture.policy,
    organizerSubject: 'organizer',
    memberships: fixture.roster.map(member => ({ subject: member.id, memberId: member.id })),
  });
  const publicView = () => app.getPublicSnapshot(display, roomId);
  const owner = (member: string) => app.getOwnerSnapshot(actor(member), roomId);
  async function envelope(type: CommandEnvelope['type'], payload: unknown, idempotencyKey?: string) {
    const snapshot = await publicView();
    const current = ++sequence;
    return {
      schemaVersion: 1 as const,
      requestId: 'request-' + current,
      idempotencyKey: idempotencyKey ?? 'key-' + current,
      roomId,
      expected: {
        contextToken: snapshot.contextToken,
        decisionRevision: snapshot.decisionRevision,
        controlVersion: snapshot.controlVersion,
      },
      type,
      payload,
    };
  }
  async function send(member: string | TrustedPrincipal, type: CommandEnvelope['type'], payload: unknown) {
    const command = await envelope(type, payload);
    return app.execute(typeof member === 'string' ? actor(member) : member, command);
  }
  async function applied(member: string | TrustedPrincipal, type: CommandEnvelope['type'], payload: unknown) {
    const result = await send(member, type, payload);
    expect(CommandResult.safeParse(result).success).toBe(true);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    return result;
  }
  async function createOffer() {
    for (const input of fixture.owners) {
      await applied(input.ownerMemberId, 'SUBMIT_INPUT_DRAFT', {
        expectedOwnerRevision: (await owner(input.ownerMemberId)).ownerRevision,
        values: input.confirmedInputs.values,
      });
      const snapshot = await owner(input.ownerMemberId);
      await applied(input.ownerMemberId, 'CONFIRM_INPUTS', {
        draftId: snapshot.draft!.draftId,
        draftRevision: snapshot.draft!.draftRevision,
        expectedOwnerRevision: snapshot.ownerRevision,
        reviewedIntervals: input.availabilityReview.intervals,
      });
    }
    for (const member of fixture.roster) await applied(member.id, 'ACCEPT_CONTEXT', { policy: fixture.policy });
    await applied('maya', 'REQUEST_SOLVE', {});
    const job = await app.pendingSolveJob(service, roomId);
    expect(job).not.toBeNull();
    await app.runSolveJob(service, roomId, job!.id);
    return (await owner('nina')).pendingOffers[0]!;
  }
  return { app, client, repository, fixture, publicView, owner, envelope, applied, createOffer, setNow: (value: string) => { now = value; } };
}

describe('DynamoDB strict storage codec', () => {
  it('round-trips an allowlisted versioned state and rejects extra or mismatched fields', async () => {
    const h = await harness();
    const item = h.client.item(roomId, 'STATE')!;
    const record = decodeStateItem(item, roomId);
    expect(record.roomId).toBe(roomId);
    expect('replays' in record).toBe(false);
    expect(() => decodeStateItem({ ...item, unexpected: { S: 'private' } }, roomId)).toThrow();
    expect(() => decodeStateItem(item, 'different-room')).toThrow();
    expect(h.client.items(roomId).map(value => stringValue(value.SK))).toEqual(['STATE', 'GUARD']);
    expect(h.client.commands.every(name => [
      'TransactGetItemsCommand', 'TransactWriteItemsCommand',
    ].includes(name))).toBe(true);
  });

  it('creates only missing STATE and GUARD items and fails closed on partial or malformed storage', async () => {
    const h = await harness();
    h.client.delete(roomId, 'GUARD');
    await expect(h.app.getPublicSnapshot(display, roomId)).rejects.toThrow('RETRYABLE_SERVER_ERROR');
    const absent = await harness();
    const command = await absent.envelope('SUBMIT_INPUT_DRAFT', {
      expectedOwnerRevision: 0, values: absent.fixture.owners[0]!.confirmedInputs.values,
    });
    expect(await absent.app.execute(actor('maya'), command)).toMatchObject({ ok: true });
    absent.client.delete(roomId, 'STATE');
    absent.client.delete(roomId, 'GUARD');
    expect(await absent.app.execute(actor('maya'), command)).toMatchObject({
      ok: false, error: { code: 'NOT_FOUND', httpStatus: 404 },
    });
    const orphanRows = absent.client.items(roomId);
    expect(orphanRows).toHaveLength(1);
    expect(stringValue(orphanRows[0]!.SK)).toMatch(/^REPLAY#[a-f0-9]{64}$/);

    const malformed = await harness();
    const state = malformed.client.item(roomId, 'STATE')!;
    state.payload = { S: '{malformed' };
    malformed.client.replace(roomId, 'STATE', state);
    await expect(malformed.app.getPublicSnapshot(display, roomId)).rejects.toThrow('RETRYABLE_SERVER_ERROR');
  });
});

describe('reserved STATE capacity', () => {
  it('refuses a new prompt whose reserved full response path would cross the hard ceiling', async () => {
    const h = await harness();
    const decoded = decodeStateItem(h.client.item(roomId, 'STATE')!, roomId);
    let selected: ReturnType<typeof inflateForCapacity> | undefined;
    let selectedHistoryCount = 0;
    for (let history = 60; history <= 92 && !selected; history += 1) {
      for (let publicCount = 0; publicCount <= 32; publicCount += 1) {
        const base = inflateForCapacity(decoded, h.fixture, history, publicCount);
        const offer = makeCapacityOffer(base, h.fixture);
        const prompted = structuredClone(base);
        setOffer(prompted, offer);
        const baseBytes = stateItemSizeBytes({ ...base, replays: [] });
        const promptedBytes = stateItemSizeBytes(prompted);
        if (baseBytes <= 352 * 1024 && promptedBytes <= 360 * 1024
          && promptedBytes + pendingResponseByteReservations(prompted) > 360 * 1024) {
          selected = prompted;
          selectedHistoryCount = history;
          break;
        }
      }
    }
    expect(selected, 'construct a valid near-limit admission candidate').toBeDefined();
    const selectedRoom = selected!;
    h.client.replace(roomId, 'STATE', encodeStateItem(selectedRoom));
    h.client.setCounters(roomId, {
      ordinary: selectedHistoryCount, permission: selectedHistoryCount, safety: 0, total: selectedHistoryCount,
    });
    const beforeState = JSON.stringify(h.client.item(roomId, 'STATE'));
    const beforeGuard = JSON.stringify(h.client.item(roomId, 'GUARD'));
    await expect(h.repository.transaction(roomId, room => {
      const base = { ...room!, replays: [] };
      const offer = makeCapacityOffer(base, h.fixture);
      setOffer(room!, offer);
    })).rejects.toBeInstanceOf(RepositoryCapacityError);
    expect(JSON.stringify(h.client.item(roomId, 'STATE'))).toBe(beforeState);
    expect(JSON.stringify(h.client.item(roomId, 'GUARD'))).toBe(beforeGuard);
  });

  it('keeps a pending decline executable near the ceiling and consumes its reservation', async () => {
    const h = await harness();
    const decoded = decodeStateItem(h.client.item(roomId, 'STATE')!, roomId);
    let selected: ReturnType<typeof inflateForCapacity> | undefined;
    let selectedHistoryCount = 0;
    for (let history = 60; history <= 92 && !selected; history += 1) {
      for (let publicCount = 0; publicCount <= 32; publicCount += 1) {
        const candidate = inflateForCapacity(decoded, h.fixture, history, publicCount);
        const preview = makeCapacityPreview(candidate, h.fixture);
        setPreview(candidate, preview);
        const bytes = stateItemSizeBytes(candidate);
        if (bytes > 352 * 1024 && bytes + pendingResponseByteReservations(candidate) <= 360 * 1024) {
          selected = candidate;
          selectedHistoryCount = history;
          break;
        }
      }
    }
    expect(selected, 'construct a pending disclosure response above the ordinary STATE ceiling').toBeDefined();
    const selectedRoom = selected!;
    const preview = selectedRoom.owners.find(owner => owner.memberId === 'nina')!.previews[0]!;
    h.client.replace(roomId, 'STATE', encodeStateItem(selectedRoom));
    h.client.setCounters(roomId, {
      ordinary: selectedHistoryCount, permission: selectedHistoryCount, safety: 0, total: selectedHistoryCount,
    });
    const command = await h.envelope('DECIDE_DISCLOSURE', { preview, decision: 'DECLINE' });
    expect(await h.app.execute(actor('nina'), command)).toMatchObject({ ok: true });
    const after = decodeStateItem(h.client.item(roomId, 'STATE')!, roomId);
    expect(permissionHistoryCount(after)).toBe(selectedHistoryCount + 1);
    expect(pendingResponseByteReservations(after)).toBe(0);
    expect(stateItemSizeBytes({ ...after, replays: [] })).toBeGreaterThan(352 * 1024);
    expect(stateItemSizeBytes({ ...after, replays: [] })).toBeLessThanOrEqual(360 * 1024);
  });
});

describe('DynamoDB conditional repository transactions', () => {
  it('persists every supported overlapping grant through solver completion', async () => {
    const h = await harness();
    const nina = h.fixture.owners.find(owner => owner.ownerMemberId === 'nina')!;
    const overlapping = nina.confirmedInputs.values.conditions.find(condition => condition.id === 'nina-thursday-1100')!;
    for (let index = 1; index <= 3; index += 1)
      nina.confirmedInputs.values.conditions.push({ ...structuredClone(overlapping), id: 'overlap-' + index });

    await h.createOffer();
    const offers = (await h.owner('nina')).pendingOffers;
    expect(offers).toHaveLength(4);
    for (const offer of offers) await h.applied('nina', 'DECIDE_EXCEPTION', {
      offerId: offer.id, offerVersion: offer.version, scope: offer.scope, decision: 'ALLOW',
    });
    const job = await h.app.pendingSolveJob(service, roomId);
    expect(job).not.toBeNull();
    await h.app.runSolveJob(service, roomId, job!.id);
    const state = decodeStateItem(h.client.item(roomId, 'STATE')!, roomId);
    expect(state.requiredGrants).toHaveLength(4);
    expect((await h.publicView()).status).not.toBe('SOLVING');
  });

  it('atomically creates one replay under duplicate concurrent commands and replays exact results', async () => {
    const h = await harness();
    const command = await h.envelope('SUBMIT_INPUT_DRAFT', {
      expectedOwnerRevision: 0, values: h.fixture.owners[0]!.confirmedInputs.values,
    });
    const [first, second] = await Promise.all([
      h.app.execute(actor('maya'), command), h.app.execute(actor('maya'), command),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true });
    const receipts = h.client.items(roomId).filter(item => stringValue(item.SK)?.startsWith('REPLAY#'));
    expect(receipts).toHaveLength(1);
    expect(stringValue(receipts[0]!.keyHash)).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(receipts[0])).not.toContain('maya');
    const guard = h.client.item(roomId, 'GUARD')!;
    expect(guard.ordinaryReceipts).toEqual({ N: '1' });
    expect(guard.totalReceipts).toEqual({ N: '1' });
  });

  it('isolates partition keys and requires current room membership', async () => {
    const h = await harness();
    const otherRoomId = 'room-other';
    await h.app.createRoom({
      roomId: otherRoomId,
      schedule: h.fixture.schedule,
      roster: h.fixture.roster.map(member => ({ ...member, submitted: false })),
      policy: h.fixture.policy,
      organizerSubject: 'other-organizer',
      memberships: h.fixture.roster.map(member => ({ subject: 'other-' + member.id, memberId: member.id })),
    });
    const otherView = await h.app.getPublicSnapshot(actor('other-maya'), otherRoomId);
    const command = {
      schemaVersion: 1, requestId: 'cross-room-request', idempotencyKey: 'cross-room-key', roomId: otherRoomId,
      expected: {
        contextToken: otherView.contextToken, decisionRevision: otherView.decisionRevision,
        controlVersion: otherView.controlVersion,
      },
      type: 'SUBMIT_INPUT_DRAFT',
      payload: { expectedOwnerRevision: 0, values: h.fixture.owners[0]!.confirmedInputs.values },
    };
    expect(await h.app.execute(actor('maya'), command)).toMatchObject({
      ok: false, error: { code: 'NOT_FOUND', httpStatus: 404 },
    });
    expect(h.client.items(otherRoomId).map(item => stringValue(item.SK))).toEqual(['STATE', 'GUARD']);
    expect((await h.app.getOwnerSnapshot(actor('nina'), roomId)).ownerMemberId).toBe('nina');
  });

  it('re-authorizes current membership before returning a matching candidate replay', async () => {
    const h = await harness();
    const command = await h.envelope('SUBMIT_INPUT_DRAFT', {
      expectedOwnerRevision: 0, values: h.fixture.owners[0]!.confirmedInputs.values,
    });
    const saved = await h.app.execute(actor('maya'), command);
    expect(saved.ok).toBe(true);
    await h.repository.transaction(roomId, room => {
      room!.memberships.find(binding => binding.subject === 'maya')!.subject = 'revoked-maya';
    });
    const replay = await h.app.execute(actor('maya'), command);
    expect(replay).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', httpStatus: 404 } });
  });

  it('persists application-clock expiry while keeping display and owner scopes separate', async () => {
    const h = await harness();
    const offer = await h.createOffer();
    expect(await h.app.getPublicSnapshot(display, roomId)).toMatchObject({ status: 'PRIVATE_REVIEW' });
    await expect(h.app.getOwnerSnapshot(display, roomId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.app.getPublicSnapshot(actor('outsider'), roomId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await h.applied('nina', 'DECIDE_EXCEPTION', {
      offerId: offer.id, offerVersion: offer.version, scope: offer.scope, decision: 'ALLOW',
    })).toMatchObject({ ok: true });
    const grant = (await h.owner('nina')).exceptionGrants.find(value => value.status === 'ACTIVE')!;
    h.setNow(grant.scope.expiresAt);
    await h.app.getPublicSnapshot(display, roomId);
    expect((await h.owner('nina')).exceptionGrants.find(value => value.id === grant.id)?.status).toBe('EXPIRED');
    expect(h.client.item(roomId, 'GUARD')!.permissionHistoryReceipts).toEqual({ N: '1' });
  });

  it('retries guarded writes after genuine adapter races across repository transactions', async () => {
    const h = await harness();
    let waiting = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const competing = Array.from({ length: 3 }, () => h.repository.transaction(roomId, async room => {
      if (waiting < 3) {
        waiting += 1;
        if (waiting === 3) release();
        await gate;
      }
      room!.controlVersion += 1;
      return room!.controlVersion;
    }));
    expect((await Promise.all(competing)).sort()).toEqual([1, 2, 3]);
    expect((await h.publicView()).controlVersion).toBe(3);
  });

  it('does not return an unreceipted semantic rejection after ordinary receipts are exhausted', async () => {
    const h = await harness();
    const offer = await h.createOffer();
    h.client.setCounters(roomId, { ordinary: 4096, permission: 0, safety: 0, total: 4096 });
    const stateBefore = JSON.stringify(h.client.item(roomId, 'STATE'));
    const guardBefore = JSON.stringify(h.client.item(roomId, 'GUARD'));
    const replayCountBefore = h.client.items(roomId).filter(item => stringValue(item.SK)?.startsWith('REPLAY#')).length;
    const command = await h.envelope('DECIDE_EXCEPTION', {
      offerId: offer.id, offerVersion: offer.version + 1, scope: offer.scope, decision: 'ALLOW',
    }, 'same-key-at-capacity');

    expect(await h.app.execute(actor('nina'), command)).toMatchObject({
      ok: false, error: { code: 'ROOM_CAPACITY_REACHED', httpStatus: 409 },
    });
    expect(JSON.stringify(h.client.item(roomId, 'STATE'))).toBe(stateBefore);
    expect(JSON.stringify(h.client.item(roomId, 'GUARD'))).toBe(guardBefore);
    expect(h.client.items(roomId).filter(item => stringValue(item.SK)?.startsWith('REPLAY#'))).toHaveLength(replayCountBefore);

    const corrected = await h.envelope('DECIDE_EXCEPTION', {
      offerId: offer.id, offerVersion: offer.version, scope: offer.scope, decision: 'ALLOW',
    }, command.idempotencyKey);
    expect(await h.app.execute(actor('nina'), corrected)).toMatchObject({ ok: true });
  });

  it('reserves permission-response capacity against lifetime history archived from prior owners', async () => {
    const h = await harness();
    const room = decodeStateItem(h.client.item(roomId, 'STATE')!, roomId);
    const scope = makeCapacityOffer(room, h.fixture).scope;
    room.retiredPermissionHistory = [{
      ownerMemberId: 'departed-owner',
      exceptions: Array.from({ length: 191 }, (_, index) => ({
        id: 'retired-grant-' + index, version: 1,
        scope: { ...scope, conditionId: 'retired-condition-' + index }, status: 'SUPERSEDED' as const,
      })),
      disclosures: [],
    }];
    h.client.replace(roomId, 'STATE', encodeStateItem({ ...room, replays: [] }));
    h.client.setCounters(roomId, { ordinary: 0, permission: 191, safety: 0, total: 191 });

    for (const input of h.fixture.owners) {
      await h.applied(input.ownerMemberId, 'SUBMIT_INPUT_DRAFT', {
        expectedOwnerRevision: (await h.owner(input.ownerMemberId)).ownerRevision,
        values: input.confirmedInputs.values,
      });
      const owner = await h.owner(input.ownerMemberId);
      await h.applied(input.ownerMemberId, 'CONFIRM_INPUTS', {
        draftId: owner.draft!.draftId, draftRevision: owner.draft!.draftRevision,
        expectedOwnerRevision: owner.ownerRevision,
        reviewedIntervals: input.availabilityReview.intervals,
      });
    }
    for (const member of h.fixture.roster)
      await h.applied(member.id, 'ACCEPT_CONTEXT', { policy: h.fixture.policy });
    await h.applied('maya', 'REQUEST_SOLVE', {});
    const job = await h.app.pendingSolveJob(service, roomId);
    expect(job).not.toBeNull();
    await h.app.runSolveJob(service, roomId, job!.id);

    const after = decodeStateItem(h.client.item(roomId, 'STATE')!, roomId);
    expect(after.owners.flatMap(owner => owner.offers)).toHaveLength(0);
    expect(permissionHistoryCount(after)).toBe(191);
    expect(h.client.item(roomId, 'GUARD')!.permissionHistoryReceipts).toEqual({ N: '191' });
  });

  it('retains departed-owner permission evidence and lifetime counters through roster revision', async () => {
    const h = await harness();
    const offer = await h.createOffer();
    expect(await h.applied('nina', 'DECIDE_EXCEPTION', {
      offerId: offer.id, offerVersion: offer.version, scope: offer.scope, decision: 'ALLOW',
    })).toMatchObject({ ok: true });
    const preview = (await h.owner('nina')).disclosurePreviews[0]!;
    expect(await h.applied('nina', 'DECIDE_DISCLOSURE', { preview, decision: 'DECLINE' })).toMatchObject({ ok: true });
    const before = decodeStateItem(h.client.item(roomId, 'STATE')!, roomId);
    expect(permissionHistoryCount(before)).toBe(2);

    const roster = h.fixture.roster.map(member => ({
      ...member, submitted: false, id: member.id === 'nina' ? 'new-nina' : member.id,
    }));
    const schedule = structuredClone(h.fixture.schedule);
    for (const duty of schedule.duties)
      duty.qualifiedMemberIds = duty.qualifiedMemberIds.map(memberId => memberId === 'nina' ? 'new-nina' : memberId);
    const revision = await h.envelope('REVISE_DECISION', { roster, schedule, policy: h.fixture.policy });
    expect(await h.app.execute(actor('organizer'), revision)).toMatchObject({ ok: true });

    const after = decodeStateItem(h.client.item(roomId, 'STATE')!, roomId);
    expect(after.owners.some(owner => owner.memberId === 'nina')).toBe(false);
    expect(after.retiredPermissionHistory).toHaveLength(1);
    expect(after.retiredPermissionHistory[0]).toMatchObject({
      ownerMemberId: 'nina', exceptions: [{ status: 'SUPERSEDED' }],
      disclosures: [{ status: 'DECLINED', preview: { textHash: expect.any(String) } }],
    });
    expect(after.retiredPermissionHistory[0]!.disclosures[0]!.preview).not.toHaveProperty('text');
    expect(permissionHistoryCount(after)).toBe(2);
    expect(h.client.item(roomId, 'GUARD')!.permissionHistoryReceipts).toEqual({ N: '2' });
  });

  it('returns known no-commit capacity at ordinary exhaustion but still admits consent and safety reserves', async () => {
    const h = await harness();
    const command = await h.envelope('SUBMIT_INPUT_DRAFT', {
      expectedOwnerRevision: 0, values: h.fixture.owners[0]!.confirmedInputs.values,
    });
    const first = await h.app.execute(actor('maya'), command);
    expect(first.ok).toBe(true);
    h.client.setCounters(roomId, { ordinary: 4096, permission: 0, safety: 0, total: 4096 });
    const replay = await h.app.execute(actor('maya'), command);
    expect(replay).toEqual(first);
    const before = JSON.stringify(h.client.item(roomId, 'STATE'));
    const nextCommand = await h.envelope('SUBMIT_INPUT_DRAFT', {
      expectedOwnerRevision: 1, values: h.fixture.owners[0]!.confirmedInputs.values,
    });
    expect(await h.app.execute(actor('maya'), nextCommand)).toMatchObject({
      ok: false, error: { code: 'ROOM_CAPACITY_REACHED', httpStatus: 409 },
    });
    expect(JSON.stringify(h.client.item(roomId, 'STATE'))).toBe(before);
    expect(h.client.item(roomId, 'GUARD')!.ordinaryReceipts).toEqual({ N: '4096' });
    expect(h.client.items(roomId).filter(item => stringValue(item.SK)?.startsWith('REPLAY#'))).toHaveLength(1);

    const consent = await harness();
    const offer = await consent.createOffer();
    consent.client.setCounters(roomId, { ordinary: 4096, permission: 0, safety: 0, total: 4096 });
    const allow = await consent.envelope('DECIDE_EXCEPTION', {
      offerId: offer.id, offerVersion: offer.version, scope: offer.scope, decision: 'ALLOW',
    });
    expect(await consent.app.execute(actor('nina'), allow)).toMatchObject({ ok: true });
    expect(consent.client.item(roomId, 'GUARD')).toMatchObject({
      ordinaryReceipts: { N: '4096' }, permissionHistoryReceipts: { N: '1' }, totalReceipts: { N: '4097' },
    });
    const grant = (await consent.owner('nina')).exceptionGrants.find(value => value.status === 'ACTIVE')!;
    consent.client.setCounters(roomId, { ordinary: 4096, permission: 1, safety: 0, total: 4096 });
    const revoke = await consent.envelope('REVOKE_EXCEPTION', { grantId: grant.id, grantVersion: grant.version });
    expect(await consent.app.execute(actor('nina'), revoke)).toMatchObject({ ok: true });
    expect(consent.client.item(roomId, 'GUARD')).toMatchObject({
      ordinaryReceipts: { N: '4096' }, safetyReserveReceipts: { N: '1' }, totalReceipts: { N: '4097' },
    });
  });

  it('maps deterministic item-size cancellation to known-no-commit capacity without retrying', async () => {
    const h = await harness();
    const command = await h.envelope('SUBMIT_INPUT_DRAFT', {
      expectedOwnerRevision: 0, values: h.fixture.owners[0]!.confirmedInputs.values,
    });
    const beforeState = JSON.stringify(h.client.item(roomId, 'STATE'));
    const beforeGuard = JSON.stringify(h.client.item(roomId, 'GUARD'));
    const attemptsBefore = h.client.writeAttempts;
    const error = new Error('DynamoDB rejected item size') as Error & {
      CancellationReasons: { Code: string; Message?: string }[];
    };
    error.name = 'TransactionCanceledException';
    error.CancellationReasons = [
      { Code: 'ValidationError', Message: 'Item size to update has exceeded the maximum allowed size.' },
      { Code: 'None' },
      { Code: 'None' },
    ];
    h.client.failNextWrite(error);

    expect(await h.app.execute(actor('maya'), command)).toMatchObject({
      ok: false, error: { code: 'ROOM_CAPACITY_REACHED', httpStatus: 409 },
    });
    expect(h.client.writeAttempts - attemptsBefore).toBe(1);
    expect(JSON.stringify(h.client.item(roomId, 'STATE'))).toBe(beforeState);
    expect(JSON.stringify(h.client.item(roomId, 'GUARD'))).toBe(beforeGuard);
    expect(h.client.items(roomId).filter(item => stringValue(item.SK)?.startsWith('REPLAY#'))).toHaveLength(0);
  });

  it('does not retry unclassified validation cancellations or expose their details', async () => {
    const h = await harness();
    const command = await h.envelope('SUBMIT_INPUT_DRAFT', {
      expectedOwnerRevision: 0, values: h.fixture.owners[0]!.confirmedInputs.values,
    });
    const attemptsBefore = h.client.writeAttempts;
    const error = new Error('synthetic invalid expression') as Error & {
      CancellationReasons: { Code: string; Message?: string }[];
    };
    error.name = 'TransactionCanceledException';
    error.CancellationReasons = [
      { Code: 'ValidationError', Message: 'The update expression is invalid.' },
      { Code: 'None' },
      { Code: 'None' },
    ];
    h.client.failNextWrite(error);

    await expect(h.app.execute(actor('maya'), command)).rejects.toThrow('RETRYABLE_SERVER_ERROR');
    expect(h.client.writeAttempts - attemptsBefore).toBe(1);
  });

  it('prioritizes known item-size capacity over a mixed retryable cancellation reason', async () => {
    const h = await harness();
    const command = await h.envelope('SUBMIT_INPUT_DRAFT', {
      expectedOwnerRevision: 0, values: h.fixture.owners[0]!.confirmedInputs.values,
    });
    const beforeState = JSON.stringify(h.client.item(roomId, 'STATE'));
    const beforeGuard = JSON.stringify(h.client.item(roomId, 'GUARD'));
    const attemptsBefore = h.client.writeAttempts;
    h.client.failNextWrite(canceledWith([
      { Code: 'ValidationError', Message: 'Item size to update has exceeded the maximum allowed size.' },
      { Code: 'ConditionalCheckFailed', Message: 'The condition did not match.' },
      { Code: 'None' },
    ]));

    expect(await h.app.execute(actor('maya'), command)).toMatchObject({
      ok: false, error: { code: 'ROOM_CAPACITY_REACHED', httpStatus: 409 },
    });
    expect(h.client.writeAttempts - attemptsBefore).toBe(1);
    expect(JSON.stringify(h.client.item(roomId, 'STATE'))).toBe(beforeState);
    expect(JSON.stringify(h.client.item(roomId, 'GUARD'))).toBe(beforeGuard);
    expect(h.client.items(roomId).filter(item => stringValue(item.SK)?.startsWith('REPLAY#'))).toHaveLength(0);
  });

  it.each([
    ['arbitrary validation', { Code: 'ValidationError', Message: 'The update expression is invalid.' }],
    ['unknown reason', { Code: 'FutureDynamoReason', Message: 'synthetic provider detail' }],
    ['malformed reason', null],
  ])('does not retry a mixed %s and throttling cancellation', async (_description, firstReason) => {
    const h = await harness();
    const command = await h.envelope('SUBMIT_INPUT_DRAFT', {
      expectedOwnerRevision: 0, values: h.fixture.owners[0]!.confirmedInputs.values,
    });
    const attemptsBefore = h.client.writeAttempts;
    h.client.failNextWrite(canceledWith([
      firstReason,
      { Code: 'ThrottlingError', Message: 'synthetic throttle detail' },
      { Code: 'None' },
    ]));

    const failure = await h.app.execute(actor('maya'), command).catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('RETRYABLE_SERVER_ERROR');
    expect((failure as Error).message).not.toContain('synthetic');
    expect(h.client.writeAttempts - attemptsBefore).toBe(1);
  });

  it('returns 503 for an unknown write outcome and recovers by exact replay on retry', async () => {
    const h = await harness();
    const command = await h.envelope('SUBMIT_INPUT_DRAFT', {
      expectedOwnerRevision: 0, values: h.fixture.owners[0]!.confirmedInputs.values,
    });
    h.client.failNextWriteAfterCommit();
    await expect(h.app.execute(actor('maya'), command)).rejects.toThrow('RETRYABLE_SERVER_ERROR');
    const retry = await h.app.execute(actor('maya'), command);
    expect(retry).toMatchObject({ ok: true });
    expect(h.client.items(roomId).filter(item => stringValue(item.SK)?.startsWith('REPLAY#'))).toHaveLength(1);
  });
});
