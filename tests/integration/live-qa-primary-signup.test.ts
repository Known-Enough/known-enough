import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, test, vi } from 'vitest';
// @ts-expect-error Exercise the inactive JavaScript boundary without AWS/mail calls.
import { primarySignupDriver, primarySignupPlan, primarySignupReport, PRIMARY_SIGNUP_TARGET, verifyPrimarySignupSetup } from '../../scripts/live-qa/primary-signup.mjs';

const ownSubject = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const foreignSubject = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const plan = primarySignupPlan({ runId: 'a'.repeat(16), sourceSha: 'b'.repeat(40), nonce: 'c'.repeat(32), ownerToken: 'd'.repeat(32) });
type Plan = typeof plan;
type RecordState = { revision: number; binding: string; phase: string; subject: string | null;
  lease: { id: string; username: string; mailboxKey: string }; result: string; cleanup: string;
  signupAttempts: number; mailReads: number; confirmationAttempts: number; loginAttempts: number; deleteAttempts: number };
type Request = { plan: Plan; lease: RecordState['lease']; subject?: string; code?: string };
type Options = { signal: AbortSignal };
function fixture() {
  let record: RecordState | null = null;
  let liveSubject: string | null = null;
  const calls: string[] = [];
  const lease = { id: 'fixture_private_12345', username: plan.username, mailboxKey: 'mailbox_private_12345' };
  const proof = { ...PRIMARY_SIGNUP_TARGET, sourceSha: plan.sourceSha, cleanupBinding: 'IMMUTABLE_SUBJECT',
    partialCleanup: 'VERIFIED', exclusiveLease: 'VERIFIED', journalDurability: 'VERIFIED', passwordPolicy: 'MIN8_ALL_CLASSES', publicSignup: 'VERIFIED' };
  const journal = {
    async read() { return structuredClone(record); },
    async createIfAbsent(_key: string, next: RecordState) { if (record) return false; record = structuredClone(next); return true; },
    async compareAndSwap(_key: string, expected: number, next: RecordState) {
      if (record?.revision !== expected) return false;
      record = structuredClone(next); calls.push('journal:' + next.phase); return true;
    }
  };
  const bounded = (options: Options) => { expect(options.signal).toBeInstanceOf(AbortSignal); expect(options.signal.aborted).toBe(false); };
  const ports = {
    async verifyContext(_plan: Plan, options: Options) { bounded(options); calls.push('context'); return proof; },
    async verifyLease(_plan: Plan, options: Options) { bounded(options); calls.push('lease'); return { ...lease }; },
    async lookupSubject(_request: Request, options: Options): Promise<{ status: string; subject?: string; username?: string }> {
      bounded(options); calls.push('lookup'); return liveSubject ? { status: 'PRESENT', subject: liveSubject, username: plan.username } : { status: 'ABSENT' };
    },
    async signup(request: Request, options: Options) {
      bounded(options); expect(record?.phase).toBe('SIGNUP_INTENT'); expect(request.lease).toEqual(lease);
      calls.push('signup'); liveSubject = ownSubject; return { subject: ownSubject };
    },
    async readMail(_request: Request, options: Options) {
      bounded(options); calls.push('mail'); return { status: 'READY', leaseId: lease.id, mailboxKey: lease.mailboxKey, code: '123456' };
    },
    async confirm(request: Request, options: Options) {
      bounded(options); expect(record?.phase).toBe('CONFIRM_INTENT'); expect(request.code).toBe('123456'); calls.push('confirm'); return { status: 'CONFIRMED' };
    },
    async login(_request: Request, options: Options) {
      bounded(options); expect(record?.phase).toBe('LOGIN_INTENT'); calls.push('login');
      return { status: 'VERIFIED', subject: ownSubject, pool: PRIMARY_SIGNUP_TARGET.pool, client: PRIMARY_SIGNUP_TARGET.client, serverOwner: ownSubject };
    },
    async deleteSubject(request: Request, options: Options) {
      bounded(options); expect(record?.phase).toBe('CLEANUP_INTENT'); calls.push('delete');
      // Simulated SUBJECT-bound service contract, not Cognito atomicity proof.
      if (request.subject !== liveSubject) throw new Error('PRIVATE_REPLACEMENT');
      liveSubject = null;
    }
  };
  return { journal, ports, proof, lease, calls, driver: primarySignupDriver({ journal, ports }),
    get record() { return record!; }, set record(next: RecordState) { record = next; },
    get liveSubject() { return liveSubject; }, set liveSubject(next: string | null) { liveSubject = next; } };
}

describe('inactive primary signup driver: simulated ports are not live proof', () => {
  test('one signup, mail confirmation, verified server identity and cleanup; each mutation follows private intent', async () => {
    const f = fixture(); await f.driver.prepare(plan); const report = await f.driver.execute(plan);
    expect(report).toEqual({ status: 'PASS', execution: 'PASS', cleanup: 'CLEAN', phase: 'CLEAN', signupAttempts: 1,
      mailReads: 1, confirmationAttempts: 1, loginAttempts: 1, deleteAttempts: 1 });
    expect(f.liveSubject).toBeNull();
    for (const [intent, operation] of [['SIGNUP_INTENT', 'signup'], ['CONFIRM_INTENT', 'confirm'], ['LOGIN_INTENT', 'login'], ['CLEANUP_INTENT', 'delete']]) {
      expect(f.calls.indexOf('journal:' + intent)).toBeLessThan(f.calls.indexOf(operation!));
    }
    const before = f.calls.slice(); expect(await f.driver.execute(plan)).toEqual(report); expect(await f.driver.recover(plan)).toEqual(report);
    expect(f.calls).toEqual(before);
  });

  test.each(['account', 'region', 'pool', 'client', 'actor', 'sourceSha', 'cleanupBinding', 'partialCleanup', 'exclusiveLease', 'journalDurability', 'passwordPolicy', 'publicSignup'])('invalid %s fails before journal/signup', async key => {
    const f = fixture(); Object.assign(f.proof, { [key]: 'PRIVATE_WRONG' });
    await expect(f.driver.prepare(plan)).rejects.toThrow('PRIMARY_CONTEXT_REJECTED'); expect(f.calls).not.toContain('signup'); expect(f.record).toBeNull();
  });

  test('installation drift after preparation blocks submission', async () => {
    const f = fixture(); await f.driver.prepare(plan); f.proof.partialCleanup = 'UNKNOWN';
    await expect(f.driver.execute(plan)).rejects.toThrow('PRIMARY_CONTEXT_REJECTED'); expect(f.record.phase).toBe('PREPARED'); expect(f.calls).not.toContain('signup');
  });

  test('foreign existing username and changed private lease cannot be signed up or deleted', async () => {
    const f = fixture(); await f.driver.prepare(plan); f.liveSubject = foreignSubject;
    expect(await f.driver.execute(plan)).toMatchObject({ execution: 'BLOCKED', cleanup: 'NOT_NEEDED', signupAttempts: 0 });
    expect(f.calls).not.toContain('delete'); expect(f.liveSubject).toBe(foreignSubject);
    const g = fixture(); await g.driver.prepare(plan); g.lease.id = 'other_private_12345';
    await expect(g.driver.execute(plan)).rejects.toThrow('PRIMARY_LEASE_REJECTED'); expect(g.calls).not.toContain('signup');
  });

  test('another source/nonce/owner cannot take a prepared run or replace its journal', async () => {
    for (const change of [{ sourceSha: 'e'.repeat(40) }, { nonce: 'e'.repeat(32) }, { ownerToken: 'e'.repeat(32) }]) {
      const f = fixture(); await f.driver.prepare(plan); const before = structuredClone(f.record);
      const other = primarySignupPlan({ runId: plan.runId, sourceSha: plan.sourceSha, nonce: plan.nonce, ownerToken: plan.ownerToken, ...change });
      await expect(f.driver.execute(other)).rejects.toThrow('PRIMARY_JOURNAL_REJECTED'); expect(f.record).toEqual(before); expect(f.calls).not.toContain('signup');
    }
  });

  test('concurrent runners sharing a journal produce one signup and one deletion', async () => {
    const f = fixture(); await f.driver.prepare(plan); const second = primarySignupDriver({ journal: f.journal, ports: f.ports });
    const results = await Promise.allSettled([f.driver.execute(plan), second.execute(plan)]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(value => value.status === 'rejected')).toMatchObject({ reason: { message: 'PRIMARY_JOURNAL_CONFLICT' } });
    expect(f.calls.filter(value => value === 'signup')).toHaveLength(1); expect(f.calls.filter(value => value === 'delete')).toHaveLength(1);
  });

  test('crash after signup intent, before known subject, never repeats signup or guesses cleanup', async () => {
    const f = fixture(); await f.driver.prepare(plan);
    f.record = { ...f.record, revision: 1, phase: 'SIGNUP_INTENT', signupAttempts: 1, cleanup: 'UNKNOWN' }; f.liveSubject = ownSubject;
    expect(await f.driver.execute(plan)).toMatchObject({ execution: 'UNKNOWN', cleanup: 'UNKNOWN' });
    expect(await f.driver.recover(plan)).toMatchObject({ cleanup: 'UNKNOWN' }); expect(f.calls).not.toContain('signup'); expect(f.calls).not.toContain('delete');
  });

  test('lost signup response retains unknown resource and private recovery, even after restart', async () => {
    const f = fixture(); f.ports.signup = async () => { f.calls.push('signup'); f.liveSubject = ownSubject; throw new Error('PRIVATE_EMAIL_PASSWORD_PROVIDER_DETAIL'); };
    await f.driver.prepare(plan); const report = await f.driver.execute(plan);
    expect(report).toMatchObject({ execution: 'UNKNOWN', cleanup: 'UNKNOWN', phase: 'SIGNUP_UNKNOWN', signupAttempts: 1 });
    expect(f.record.subject).toBeNull(); expect(f.liveSubject).toBe(ownSubject); await f.driver.execute(plan); await f.driver.recover(plan);
    expect(f.calls.filter(value => value === 'signup')).toHaveLength(1); expect(f.calls).not.toContain('delete'); expect(JSON.stringify(report)).not.toMatch(/PRIVATE|fixture|mailbox|ke-primary/);
  });

  test('three empty reads end the mail phase; partial unconfirmed account is cleaned', async () => {
    const f = fixture(); f.ports.readMail = async () => ({ status: 'EMPTY', leaseId: '', mailboxKey: '', code: '' });
    await f.driver.prepare(plan); expect(await f.driver.execute(plan)).toMatchObject({ execution: 'FAIL', cleanup: 'CLEAN', mailReads: 3, confirmationAttempts: 0, loginAttempts: 0 });
    expect(f.calls).not.toContain('confirm'); expect(f.calls).not.toContain('login'); expect(f.liveSubject).toBeNull();
  });

  test.each(['leaseId', 'mailboxKey', 'code'])('mail %s mismatch cannot confirm and still cleans own account', async key => {
    const f = fixture(); const original = f.ports.readMail; f.ports.readMail = async (request, options) => ({ ...await original(request, options), [key]: 'PRIVATE' });
    await f.driver.prepare(plan); expect(await f.driver.execute(plan)).toMatchObject({ execution: 'FAIL', cleanup: 'CLEAN', confirmationAttempts: 0 }); expect(f.calls).not.toContain('confirm');
  });

  test.each(['confirm', 'login'] as const)('%s ambiguous exception retains private intent and never starts cleanup', async operation => {
    const f = fixture(); f.ports[operation] = async () => { throw new Error('PRIVATE_TOKEN'); };
    await f.driver.prepare(plan);
    const phase = operation === 'confirm' ? 'CONFIRM_INTENT' : 'LOGIN_INTENT';
    expect(await f.driver.execute(plan)).toMatchObject({ execution: 'FAIL', cleanup: 'UNKNOWN', phase, deleteAttempts: 0 });
    expect(f.liveSubject).toBe(ownSubject); expect(f.calls).not.toContain('delete');
  });

  test.each(['subject', 'pool', 'client', 'serverOwner', 'status'])('unverified login %s never passes', async key => {
    const f = fixture(); const original = f.ports.login; f.ports.login = async (request, options) => ({ ...await original(request, options), [key]: foreignSubject });
    await f.driver.prepare(plan); expect(await f.driver.execute(plan)).toMatchObject({ execution: 'FAIL', cleanup: 'CLEAN' });
  });

  test('replacement seen before cleanup blocks deletion of a foreign subject', async () => {
    const f = fixture(); const original = f.ports.login;
    f.ports.login = async (request, options) => { const result = await original(request, options); f.liveSubject = foreignSubject; return result; };
    await f.driver.prepare(plan); expect(await f.driver.execute(plan)).toMatchObject({ execution: 'PASS', cleanup: 'BLOCKED' }); expect(f.calls).not.toContain('delete'); expect(f.liveSubject).toBe(foreignSubject);
  });

  test('replacement between read and destructive call is protected by required subject-bound service port', async () => {
    const f = fixture(); const original = f.ports.deleteSubject;
    f.ports.deleteSubject = async (request, options) => { f.liveSubject = foreignSubject; return original(request, options); };
    await f.driver.prepare(plan); expect(await f.driver.execute(plan)).toMatchObject({ cleanup: 'UNKNOWN', deleteAttempts: 1 }); expect(f.liveSubject).toBe(foreignSubject);
    await f.driver.recover(plan); expect(f.calls.filter(value => value === 'delete')).toHaveLength(1);
  });

  test('lost deletion response plus verified absence can establish CLEAN without retry', async () => {
    const f = fixture(); const original = f.ports.deleteSubject;
    f.ports.deleteSubject = async (request, options) => { await original(request, options); throw new Error('PRIVATE_RESPONSE_LOST'); };
    await f.driver.prepare(plan); expect(await f.driver.execute(plan)).toMatchObject({ execution: 'PASS', cleanup: 'CLEAN' }); expect(f.calls.filter(value => value === 'delete')).toHaveLength(1);
  });

  test('denied deletion is unknown and never replayed; later verified absence allows read-only recovery', async () => {
    const f = fixture(); f.ports.deleteSubject = async () => { f.calls.push('delete'); throw new Error('AccessDenied PRIVATE'); };
    await f.driver.prepare(plan); expect(await f.driver.execute(plan)).toMatchObject({ cleanup: 'UNKNOWN' }); await f.driver.recover(plan);
    expect(f.calls.filter(value => value === 'delete')).toHaveLength(1); f.liveSubject = null;
    expect(await f.driver.recover(plan)).toMatchObject({ cleanup: 'CLEAN', phase: 'CLEAN' }); expect(f.calls.filter(value => value === 'delete')).toHaveLength(1);
  });

  test('failed readback after deletion is not CLEAN', async () => {
    const f = fixture(); const original = f.ports.lookupSubject;
    f.ports.lookupSubject = async (request, options) => { if (f.record?.deleteAttempts) throw new Error('PRIVATE_READBACK'); return original(request, options); };
    await f.driver.prepare(plan); expect(await f.driver.execute(plan)).toMatchObject({ cleanup: 'UNKNOWN' });
  });

  test('no mutation follows failed signup intent persistence or failed subject persistence', async () => {
    for (const phase of ['SIGNUP_INTENT', 'CREATED']) {
      const f = fixture(); const original = f.journal.compareAndSwap;
      f.journal.compareAndSwap = async (key, revision, next) => next.phase === phase ? false : original(key, revision, next);
      await f.driver.prepare(plan); await expect(f.driver.execute(plan)).rejects.toThrow('PRIMARY_JOURNAL_CONFLICT');
      expect(f.calls.filter(value => value === 'signup')).toHaveLength(phase === 'CREATED' ? 1 : 0); expect(f.calls).not.toContain('confirm'); expect(f.calls).not.toContain('delete');
    }
  });

  test('read-only recovery never takes over an active or crashed writer by elapsed time', async () => {
    for (const phase of ['CREATED', 'CONFIRM_INTENT', 'CONFIRMED', 'LOGIN_INTENT', 'VERIFIED', 'CLEANUP_INTENT']) {
      const f = fixture(); await f.driver.prepare(plan); f.record = { ...f.record, revision: 1, phase, subject: ownSubject,
        signupAttempts: 1, deleteAttempts: phase === 'CLEANUP_INTENT' ? 1 : 0, result: 'FAIL', cleanup: 'UNKNOWN' }; f.liveSubject = ownSubject;
      expect(await f.driver.recover(plan)).toMatchObject({ cleanup: 'UNKNOWN' }); expect(f.calls).not.toContain('signup'); expect(f.calls).not.toContain('delete');
    }
  });

  test('tampered journal counters, binding, fields and subject fail closed before service access', async () => {
    for (const patch of [{ signupAttempts: 2 }, { mailReads: 4 }, { revision: -1 }, { binding: 'PRIVATE' }, { subject: 'PRIVATE' }, { privateField: 'PRIVATE' }]) {
      const f = fixture(); await f.driver.prepare(plan); f.record = { ...f.record, ...patch }; const before = f.calls.slice();
      await expect(f.driver.execute(plan)).rejects.toThrow('PRIMARY_JOURNAL_REJECTED'); expect(f.calls).toEqual(before);
    }
  });

  test('public report accepts only fixed enum/count fields and excludes all private/untrusted data', () => {
    expect(primarySignupReport({ phase: 'PRIVATE', result: 'PRIVATE', cleanup: 'PRIVATE', mailReads: 900, password: 'PRIVATE', subject: ownSubject, token: 'PRIVATE', provider: 'PRIVATE' }))
      .toEqual({ status: 'BLOCKED_OR_FAILED', execution: 'UNKNOWN', cleanup: 'UNKNOWN', phase: 'BLOCKED', signupAttempts: 0, mailReads: 0, confirmationAttempts: 0, loginAttempts: 0, deleteAttempts: 0 });
  });

  test('offline CLI and workflow provide disabled configuration proof only', () => {
    const setup = JSON.parse(readFileSync('infra/live-qa/primary-signup-setup.json', 'utf8'));
    expect(verifyPrimarySignupSetup(setup)).toEqual({ configuration: 'PASS', execution: 'NOT_STARTED', installation: 'UNKNOWN' });
    expect(verifyPrimarySignupSetup(Object.fromEntries(Object.entries(setup).reverse()))).toEqual(verifyPrimarySignupSetup(setup));
    for (const changed of [{ ...setup, enabled: true }, { ...setup, target: { ...setup.target, pool: 'qa' } }, { ...setup, adapter: 'INSTALLED' }, { ...setup, limits: { ...setup.limits, signupAttempts: 2 } }]) {
      expect(() => verifyPrimarySignupSetup(changed)).toThrow('PRIMARY_SETUP_REJECTED');
    }
    const result = spawnSync(process.execPath, ['scripts/live-qa/primary-signup.mjs', 'check-setup', 'infra/live-qa/primary-signup-setup.json'], { encoding: 'utf8' });
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout).execution).toBe('NOT_STARTED');
    const workflow = readFileSync('.github/workflows/primary-signup-verify.yml', 'utf8');
    expect(workflow).toContain("github.actor_id == '143764700'"); expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).not.toMatch(/id-token: write|configure-aws-credentials|role-to-assume|aws cognito|publish primary|signup live/);
  });

  test('deadline during signup retains intent and ignores the late result instead of issuing cleanup or retry', async () => {
    const f = fixture(); await f.driver.prepare(plan); let controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { controller = new AbortController(); return controller.signal; });
    let resolveLate!: (value: { subject: string }) => void;
    f.ports.signup = async () => { f.calls.push('signup'); const pendingController = controller; queueMicrotask(() => pendingController.abort()); return new Promise(resolve => { resolveLate = resolve; }); };
    try {
      const report = await f.driver.execute(plan); expect(report).toMatchObject({ phase: 'SIGNUP_UNKNOWN', cleanup: 'UNKNOWN', signupAttempts: 1 });
      f.liveSubject = ownSubject; resolveLate({ subject: ownSubject }); await Promise.resolve();
      expect(f.record.subject).toBeNull(); await f.driver.execute(plan); await f.driver.recover(plan);
      expect(f.calls).not.toContain('delete'); expect(f.calls.filter(value => value === 'signup')).toHaveLength(1);
    } finally { timeout.mockRestore(); }
  });

  test('provider error text cannot impersonate an internal CAS conflict or leak out of preflight', async () => {
    const f = fixture(); f.ports.confirm = async () => { throw new Error('PRIMARY_JOURNAL_CONFLICT'); };
    await f.driver.prepare(plan);
    expect(await f.driver.execute(plan)).toMatchObject({ execution: 'FAIL', cleanup: 'UNKNOWN', phase: 'CONFIRM_INTENT', deleteAttempts: 0 });
    expect(f.liveSubject).toBe(ownSubject); expect(f.calls).not.toContain('delete');
    const g = fixture(); g.ports.verifyContext = async () => { throw new Error('PRIVATE_TOKEN_PASSWORD'); };
    await expect(g.driver.prepare(plan)).rejects.toThrow('PRIMARY_PORT_UNKNOWN');
  });

  test('corrupted terminal PASS and impossible prepared resource states cannot bypass execution', async () => {
    for (const patch of [{ phase: 'CLEAN', result: 'PASS', cleanup: 'CLEAN' }, { subject: ownSubject }, { signupAttempts: 1 }, { loginAttempts: 1 }]) {
      const f = fixture(); await f.driver.prepare(plan); f.record = { ...f.record, ...patch };
      await expect(f.driver.execute(plan)).rejects.toThrow('PRIMARY_JOURNAL_REJECTED'); expect(f.calls).not.toContain('signup');
    }
    expect(primarySignupReport({ phase: 'CLEAN', result: 'PASS', cleanup: 'CLEAN' }).status).toBe('BLOCKED_OR_FAILED');
  });

  test('nonboolean storage acknowledgement is unknown and cannot authorize mutation', async () => {
    const f = fixture(); await f.driver.prepare(plan);
    // Deliberately invalid trusted storage response, not an actual managed adapter.
    Object.assign(f.journal, { compareAndSwap: async () => ({ ok: true }) });
    await expect(f.driver.execute(plan)).rejects.toThrow('PRIMARY_JOURNAL_UNAVAILABLE'); expect(f.calls).not.toContain('signup');
    const g = fixture(); Object.assign(g.journal, { createIfAbsent: async () => ({ ok: true }) });
    await expect(g.driver.prepare(plan)).rejects.toThrow('PRIMARY_JOURNAL_UNAVAILABLE'); expect(g.calls).not.toContain('signup');
  });

  const contradictoryAbsences = [
    { status: 'ABSENT', subject: ownSubject },
    { status: 'ABSENT', username: plan.username },
    { status: 'ABSENT', error: 'PRIVATE_PROVIDER_ERROR' }
  ];

  test.each(contradictoryAbsences)('contradictory preflight absence %j cannot authorize signup', async response => {
    const f = fixture(); await f.driver.prepare(plan); f.ports.lookupSubject = async () => response;
    await expect(f.driver.execute(plan)).rejects.toThrow('PRIMARY_LOOKUP_UNKNOWN');
    expect(f.calls).not.toContain('signup'); expect(f.record.phase).toBe('PREPARED');
  });

  test.each(contradictoryAbsences)('contradictory cleanup absence %j cannot mark a present account CLEAN', async response => {
    const f = fixture(); const original = f.ports.lookupSubject;
    f.ports.lookupSubject = async (request, options) => f.record?.phase === 'VERIFIED' ? response : original(request, options);
    await f.driver.prepare(plan); const report = await f.driver.execute(plan);
    expect(report).toMatchObject({ status: 'BLOCKED_OR_FAILED', execution: 'PASS', cleanup: 'UNKNOWN', deleteAttempts: 0 });
    expect(f.liveSubject).toBe(ownSubject); expect(f.calls).not.toContain('delete');
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE|subject|username|ke-primary/);
  });

  test.each(contradictoryAbsences)('contradictory post-delete absence %j cannot certify a deletion that did not happen', async response => {
    const f = fixture(); const original = f.ports.lookupSubject;
    f.ports.deleteSubject = async () => { f.calls.push('delete'); };
    f.ports.lookupSubject = async (request, options) => f.record?.deleteAttempts ? response : original(request, options);
    await f.driver.prepare(plan); expect(await f.driver.execute(plan)).toMatchObject({ status: 'BLOCKED_OR_FAILED', cleanup: 'UNKNOWN', deleteAttempts: 1 });
    expect(f.liveSubject).toBe(ownSubject); expect(f.calls.filter(value => value === 'delete')).toHaveLength(1);
  });

  test.each(contradictoryAbsences)('contradictory recovery absence %j cannot erase an unresolved private journal', async response => {
    const f = fixture(); f.ports.deleteSubject = async () => { f.calls.push('delete'); throw new Error('PRIVATE_DENIAL'); };
    await f.driver.prepare(plan); expect(await f.driver.execute(plan)).toMatchObject({ cleanup: 'UNKNOWN' });
    const before = structuredClone(f.record); f.ports.lookupSubject = async () => response;
    await expect(f.driver.recover(plan)).rejects.toThrow('PRIMARY_LOOKUP_UNKNOWN');
    expect(f.record).toEqual(before); expect(f.liveSubject).toBe(ownSubject); expect(f.calls.filter(value => value === 'delete')).toHaveLength(1);
  });

  test('a PRESENT read with error metadata is unknown and cannot authorize destructive cleanup', async () => {
    const f = fixture(); const original = f.ports.lookupSubject;
    f.ports.lookupSubject = async (request, options) => f.record?.phase === 'VERIFIED'
      ? { status: 'PRESENT', subject: ownSubject, username: plan.username, error: 'PRIVATE_INCOMPLETE_READ' } : original(request, options);
    await f.driver.prepare(plan); expect(await f.driver.execute(plan)).toMatchObject({ status: 'BLOCKED_OR_FAILED', cleanup: 'UNKNOWN', deleteAttempts: 0 });
    expect(f.liveSubject).toBe(ownSubject); expect(f.calls).not.toContain('delete');
  });

  const pendingMutations = [
    ['confirm', 'fulfill'], ['confirm', 'reject'], ['login', 'fulfill'], ['login', 'reject']
  ] as const;

  test.each(pendingMutations)('%s deadline keeps intent through restart and late %s without deletion', async (operation, lateOutcome) => {
    const controllers = new Map<AbortSignal, AbortController>();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController(); controllers.set(controller.signal, controller); return controller.signal;
    });
    let settleLate: (() => void) | undefined;
    let settlement: Promise<void> | undefined;
    let settled = false;
    const pending = <T>(options: Options, value: T): Promise<T> => {
      const response = new Promise<T>((resolve, reject) => {
        settleLate = () => lateOutcome === 'fulfill' ? resolve(value) : reject(new Error('PRIVATE_RESPONSE_LOST'));
      });
      settlement = response.then(() => { settled = true; }, () => { settled = true; });
      queueMicrotask(() => controllers.get(options.signal)!.abort());
      return response;
    };
    try {
      const f = fixture();
      if (operation === 'confirm') f.ports.confirm = async (_request, options) => {
        f.calls.push('confirm'); return pending(options, { status: 'CONFIRMED' });
      };
      else f.ports.login = async (_request, options) => {
        f.calls.push('login');
        return pending(options, { status: 'VERIFIED', subject: ownSubject, pool: PRIMARY_SIGNUP_TARGET.pool,
          client: PRIMARY_SIGNUP_TARGET.client, serverOwner: ownSubject });
      };
      await f.driver.prepare(plan);
      const phase = operation === 'confirm' ? 'CONFIRM_INTENT' : 'LOGIN_INTENT';
      const report = await f.driver.execute(plan);
      expect(settled).toBe(false);
      expect(report).toMatchObject({ status: 'BLOCKED_OR_FAILED', execution: 'FAIL', cleanup: 'UNKNOWN', phase,
        signupAttempts: 1, confirmationAttempts: 1, loginAttempts: operation === 'login' ? 1 : 0, deleteAttempts: 0 });
      expect(f.liveSubject).toBe(ownSubject); expect(f.record.subject).toBe(ownSubject);
      expect(f.calls).not.toContain('delete');
      const retained = structuredClone(f.record);
      const restarted = primarySignupDriver({ journal: f.journal, ports: f.ports });
      expect(await restarted.execute(plan)).toEqual(report);
      expect(await restarted.recover(plan)).toEqual(report);
      expect(f.record).toEqual(retained); expect(settled).toBe(false);
      settleLate!(); await settlement;
      expect(settled).toBe(true);
      expect(await restarted.recover(plan)).toEqual(report);
      expect(f.record).toEqual(retained); expect(f.calls.filter(call => call === operation)).toHaveLength(1);
      expect(f.calls.filter(call => call === 'signup')).toHaveLength(1); expect(f.calls).not.toContain('delete');
      expect(JSON.stringify(report)).not.toMatch(/PRIVATE|subject|username|mailbox|fixture|ke-primary/);
    } finally { settleLate?.(); await settlement; timeout.mockRestore(); }
  });

  test('a read-only mail deadline still permits cleanup without a confirmation or login writer', async () => {
    const controllers = new Map<AbortSignal, AbortController>();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController(); controllers.set(controller.signal, controller); return controller.signal;
    });
    let settleLate: (() => void) | undefined;
    let settlement: Promise<void> | undefined;
    try {
      const f = fixture();
      f.ports.readMail = async (_request, options) => {
        const response = new Promise<{ status: string; leaseId: string; mailboxKey: string; code: string }>(resolve => {
          settleLate = () => resolve({ status: 'READY', leaseId: f.lease.id, mailboxKey: f.lease.mailboxKey, code: '123456' });
        });
        settlement = response.then(() => undefined);
        queueMicrotask(() => controllers.get(options.signal)!.abort()); return response;
      };
      await f.driver.prepare(plan);
      expect(await f.driver.execute(plan)).toMatchObject({ execution: 'FAIL', cleanup: 'CLEAN', phase: 'CLEAN',
        mailReads: 1, confirmationAttempts: 0, loginAttempts: 0, deleteAttempts: 1 });
      expect(f.liveSubject).toBeNull(); settleLate!(); await settlement;
      expect(f.calls).not.toContain('confirm'); expect(f.calls).not.toContain('login');
      expect(f.calls.filter(call => call === 'delete')).toHaveLength(1);
    } finally { settleLate?.(); await settlement; timeout.mockRestore(); }
  });
});
