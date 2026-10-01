import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Groups, Id } from '@deal-table/contracts';
import { KnownEnoughApplicationError, type TrustedPrincipal } from '@deal-table/application';
import type { GroupRepository } from '@deal-table/adapters';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export const memberId = (subject: string) => `member-${digest(subject).slice(0, 32)}`;
const fail = (code: 'FORBIDDEN' | 'INVALID_COMMAND' | 'NOT_FOUND' | 'STALE_CONTEXT'): never => { throw new KnownEnoughApplicationError(code); };
function subject(principal: TrustedPrincipal | null): string {
  if (principal?.kind !== 'participant') return fail('FORBIDDEN');
  return Id.parse(principal.subject);
}
function fields(raw: unknown, keys: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.keys(raw).sort().join('|') !== keys.sort().join('|')) return fail('INVALID_COMMAND');
  return raw as Record<string, unknown>;
}
function label(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > 80 || [...raw].some(character => character.charCodeAt(0) < 32)) return fail('INVALID_COMMAND');
  return raw.trim();
}
export class GroupService {
  constructor(readonly repository: GroupRepository, private readonly options: {
    emailKey: string; now: () => number; token?: () => string;
  }) { if (options.emailKey.length < 32) throw new Error('Group email key must contain at least 32 characters'); }
  emailHash(email: string): string {
    const normalized = email.trim().toLowerCase();
    if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return fail('INVALID_COMMAND');
    return createHmac('sha256', this.options.emailKey).update(normalized).digest('hex');
  }
  private account(state: Groups.GroupState, who: string): Groups.Account {
    const account = state.accounts.find(item => item.subject === who);
    if (!account || account.status !== 'APPROVED') return fail('FORBIDDEN');
    return account;
  }
  private group(state: Groups.GroupState, who: string, id: string): Groups.Group {
    this.account(state, who);
    const group = state.groups.find(item => item.id === id && item.members.includes(who));
    return group ?? fail('NOT_FOUND');
  }
  currentGroup(state: Groups.GroupState, principal: TrustedPrincipal | null, groupId: string, organizerOnly = false): Groups.Group {
    const who = subject(principal); const group = this.group(state, who, groupId);
    if (organizerOnly && group.organizer !== who) return fail('FORBIDDEN');
    return group;
  }
  private snapshot(state: Groups.GroupState, group: Groups.Group, who: string): Groups.GroupSnapshot {
    return Groups.GroupSnapshot.parse({ id: group.id, name: group.name, version: group.version,
      isOrganizer: group.organizer === who,
      members: group.members.map(value => ({ id: memberId(value),
        displayName: state.accounts.find(item => item.subject === value)!.displayName, isOrganizer: value === group.organizer })),
      drafts: group.drafts.map(item => ({ id: item.id, title: item.frame.title, created: !!item.createdDecisionId, needsClarification: item.clarificationQuestions.length > 0, current: item.groupVersion === group.version })),
      pendingInvitations: group.invitations.filter(item => !item.acceptedBy && item.expiresAt > this.options.now()).length,
      decisions: group.decisions.map(item => ({ id: item.id, current: item.version === group.version })) });
  }
  async register(principal: TrustedPrincipal | null, profile: { email: string; verified: boolean }, raw: unknown) {
    const who = subject(principal);
    if (profile.verified !== true) return fail('FORBIDDEN');
    const displayName = label(fields(raw, ['displayName']).displayName);
    const emailHash = this.emailHash(profile.email);
    return this.repository.transaction(state => {
      let account = state.accounts.find(item => item.subject === who);
      if (account && account.emailHash !== emailHash) return fail('FORBIDDEN');
      if (!account) {
        if (state.accounts.length >= 256 || state.accounts.some(item => item.emailHash === emailHash)) return fail('FORBIDDEN');
        account = { subject: who, emailHash, displayName, status: 'PENDING', version: 1 }; state.accounts.push(account);
      }
      return Groups.AccountSnapshot.parse({ status: account.status, displayName: account.displayName, version: account.version });
    });
  }
  async status(principal: TrustedPrincipal | null) {
    const who = subject(principal);
    return this.repository.transaction(state => {
      const account = state.accounts.find(item => item.subject === who);
      return account ? Groups.AccountSnapshot.parse({ status: account.status, displayName: account.displayName, version: account.version }) : null;
    });
  }
  async requireApproved(principal: TrustedPrincipal | null): Promise<void> {
    if (principal?.kind === 'display') return this.authorizeDecision(principal, principal.roomId);
    const who = subject(principal); await this.repository.transaction(state => { this.account(state, who); });
  }
  async list(principal: TrustedPrincipal | null) {
    const who = subject(principal);
    return this.repository.transaction(state => { this.account(state, who);
      return state.groups.filter(group => group.members.includes(who)).map(group => this.snapshot(state, group, who)); });
  }
  async create(principal: TrustedPrincipal | null, raw: unknown) {
    const who = subject(principal); const body = fields(raw, ['name', 'idempotencyKey']);
    const name = label(body.name); const key = Id.parse(body.idempotencyKey);
    const id = `group-${digest(JSON.stringify([who, key])).slice(0, 40)}`;
    return this.repository.transaction(state => {
      this.account(state, who);
      let group = state.groups.find(item => item.id === id);
      if (group && group.name !== name) return fail('STALE_CONTEXT');
      if (!group) { if (state.groups.length >= 32) return fail('INVALID_COMMAND');
        group = { id, name, organizer: who, version: 1, members: [who], invitations: [], decisions: [], drafts: [] }; state.groups.push(group); }
      return this.snapshot(state, group, who);
    });
  }
  async invite(principal: TrustedPrincipal | null, id: string, raw: unknown) {
    const who = subject(principal); const body = fields(raw, ['email', 'replace']);
    if (typeof body.email !== 'string' || typeof body.replace !== 'boolean') return fail('INVALID_COMMAND');
    const recipientHash = this.emailHash(body.email);
    const token = this.options.token?.() ?? randomBytes(32).toString('base64url');
    if (!/^[A-Za-z0-9_-]{32,80}$/.test(token)) throw new Error('Invalid invitation source');
    return this.repository.transaction(state => {
      const group = this.group(state, who, id); if (group.organizer !== who) return fail('FORBIDDEN');
      if (group.members.some(value => state.accounts.find(item => item.subject === value)?.emailHash === recipientHash)) return fail('INVALID_COMMAND');
      const prior = group.invitations.find(item => item.recipientHash === recipientHash && !item.acceptedBy && item.expiresAt > this.options.now());
      if (prior && !body.replace) return fail('STALE_CONTEXT');
      group.invitations = group.invitations.filter(item => item.recipientHash !== recipientHash && item.expiresAt > this.options.now());
      if (group.invitations.length >= 64) return fail('INVALID_COMMAND');
      const expiresAt = this.options.now() + 24 * 60 * 60_000;
      group.invitations.push({ recipientHash, tokenHash: digest(token), expiresAt, acceptedBy: null });
      return { token, expiresAt, delivery: 'COPY_LINK' as const };
    });
  }
  async accept(principal: TrustedPrincipal | null, raw: unknown) {
    const who = subject(principal); const body = fields(raw, ['token']);
    if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{32,80}$/.test(body.token)) return fail('INVALID_COMMAND');
    const tokenHash = digest(body.token);
    return this.repository.transaction(state => {
      const account = this.account(state, who);
      const group = state.groups.find(item => item.invitations.some(invitation => invitation.tokenHash === tokenHash));
      if (!group) return fail('NOT_FOUND');
      const invitation = group.invitations.find(item => item.tokenHash === tokenHash)!;
      if (invitation.recipientHash !== account.emailHash || invitation.expiresAt <= this.options.now()) return fail('NOT_FOUND');
      if (invitation.acceptedBy) {
        if (invitation.acceptedBy !== who || !group.members.includes(who)) return fail('NOT_FOUND');
        return this.snapshot(state, group, who);
      }
      if (group.members.length >= 16) return fail('INVALID_COMMAND');
      if (!group.members.includes(who)) { group.members.push(who); group.version++; }
      invitation.acceptedBy = who;
      return this.snapshot(state, group, who);
    });
  }
  async remove(principal: TrustedPrincipal | null, id: string, raw: unknown) {
    const who = subject(principal); const body = fields(raw, ['memberId', 'version']);
    return this.repository.transaction(state => {
      const group = this.group(state, who, id);
      if (group.organizer !== who) return fail('FORBIDDEN');
      if (body.version !== group.version) return fail('STALE_CONTEXT');
      const target = group.members.find(value => memberId(value) === body.memberId);
      if (!target || target === who) return fail('INVALID_COMMAND');
      group.members = group.members.filter(value => value !== target); group.version++;
      return this.snapshot(state, group, who);
    });
  }
  /** Every bound decision read/command checks current admission AND exact group version. */
  async authorizeDecision(principal: TrustedPrincipal | null, decisionId: string) {
    if (principal?.kind === 'display') {
      if (principal.roomId !== decisionId) return fail('FORBIDDEN');
      await this.repository.transaction(state => {
        const account = state.accounts.find(item => item.subject === principal.subject);
        if (account && account.status !== 'APPROVED') return fail('FORBIDDEN');
        const group = state.groups.find(item => item.decisions.some(decision => decision.id === decisionId));
        if (group && group.decisions.find(item => item.id === decisionId)!.version !== group.version) return fail('STALE_CONTEXT');
      });
      // Admission checks the verified room scope; the application still denies owner/write authority.
      return;
    }
    const who = subject(principal);
    await this.repository.transaction(state => {
      this.account(state, who);
      const group = state.groups.find(item => item.decisions.some(decision => decision.id === decisionId));
      if (!group) return; // legacy decision membership is still enforced by its own application boundary
      this.group(state, who, group.id);
      if (group.decisions.find(item => item.id === decisionId)!.version !== group.version) return fail('STALE_CONTEXT');
    });
  }
  async roster(principal: TrustedPrincipal | null, groupId: string) {
    const who = subject(principal);
    return this.repository.transaction(state => {
      const group = this.group(state, who, groupId);
      if (group.organizer !== who) return fail('FORBIDDEN');
      const members = group.members.map(value => ({ subject: this.account(state, value).subject, participantId: memberId(value),
        displayName: state.accounts.find(item => item.subject === value)!.displayName }));
      return { version: group.version, members };
    });
  }
  async bindDecision(principal: TrustedPrincipal | null, groupId: string, decisionId: string, version: number) {
    const who = subject(principal);
    await this.repository.transaction(state => {
      const group = this.group(state, who, groupId); if (group.organizer !== who) return fail('FORBIDDEN');
      if (group.version !== version) return fail('STALE_CONTEXT');
      const prior = group.decisions.find(item => item.id === decisionId);
      if (prior) { if (prior.version !== version) return fail('STALE_CONTEXT'); return; }
      if (group.decisions.length >= 64) return fail('INVALID_COMMAND');
      group.decisions.push({ id: Id.parse(decisionId), version });
    });
  }
}
