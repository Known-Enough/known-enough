import { createHash } from 'node:crypto';
import { Groups, Id, KnownEnough as KE } from '@deal-table/contracts';
import { KnownEnoughApplicationError, type KnownEnoughApplication, type TrustedPrincipal, type DecisionArchitect } from '@deal-table/application';
import { genericCandidates } from '@deal-table/adapters';
import { GroupService } from './group-service.ts';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code: 'INVALID_COMMAND' | 'STALE_CONTEXT' | 'NOT_FOUND' | 'NEEDS_CLARIFICATION'): never => { throw new KnownEnoughApplicationError(code); };
function fields(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== keys.sort().join('|')) return fail('INVALID_COMMAND');
  return value as Record<string, unknown>;
}
/** General creation uses current approved group users, never fixture identities or caller-supplied subjects. */
export class GroupDecisionService {
  constructor(private readonly options: { groups: GroupService; application: KnownEnoughApplication;
    architect: DecisionArchitect; now: () => number; isEnabled: () => boolean }) {}
  async draft(principal: TrustedPrincipal | null, groupId: string, raw: unknown): Promise<Groups.GroupDraft> {
    const roster = await this.options.groups.roster(principal, groupId);
    const body = fields(raw, ['objective', 'idempotencyKey']);
    if (typeof body.objective !== 'string' || !body.objective.trim() || body.objective.length > 2000 || !Id.safeParse(body.idempotencyKey).success) return fail('INVALID_COMMAND');
    const objective = body.objective.trim();
    const id = `draft-${hash([groupId, principal!.subject, body.idempotencyKey]).slice(0, 40)}`;
    const bodyHash = hash([objective, roster.version]);
    const prior = await this.options.groups.repository.transaction(state => {
      const group = this.options.groups.currentGroup(state, principal, groupId, true);
      const existing = group.drafts.find(item => item.id === id);
      if (existing && existing.bodyHash !== bodyHash) return fail('STALE_CONTEXT');
      if (group.version !== roster.version) return fail('STALE_CONTEXT');
      if (!existing && group.drafts.length >= 64) return fail('INVALID_COMMAND');
      return existing ? structuredClone(existing) : null;
    });
    if (prior) return prior;
    const output = await this.options.architect.draft(principal!.subject, { draftId: id, revision: 1, objective,
      participants: roster.members.map(member => ({ id: member.participantId, displayName: member.displayName })),
      allowedOptions: [], generateOptions: true });
    const questions = [...output.clarificationQuestions];
    if (!genericCandidates(output.frame).length) questions.push('Please clarify a bounded set of public choices or public value limits; this draft cannot generate supported candidates yet.');
    const draft = Groups.GroupDraft.parse({ id, bodyHash, revision: 1, groupVersion: roster.version,
      frame: output.frame, clarificationQuestions: questions.slice(0, 12), createdDecisionId: null });
    if (!this.options.isEnabled()) return fail('STALE_CONTEXT');
    return this.options.groups.repository.transaction(state => {
      const group = this.options.groups.currentGroup(state, principal, groupId, true);
      if (group.version !== roster.version || !this.options.isEnabled()) return fail('STALE_CONTEXT');
      const existing = group.drafts.find(item => item.id === id);
      if (existing) { if (existing.bodyHash !== bodyHash) return fail('STALE_CONTEXT'); return structuredClone(existing); }
      if (group.drafts.length >= 64) return fail('INVALID_COMMAND');
      group.drafts.push(draft); return structuredClone(draft);
    });
  }
  async read(principal: TrustedPrincipal | null, groupId: string, draftId: string) {
    return this.options.groups.repository.transaction(state => {
      const group = this.options.groups.currentGroup(state, principal, groupId, true);
      const draft = group.drafts.find(item => item.id === draftId) ?? fail('NOT_FOUND');
      if (draft.groupVersion !== group.version) return fail('STALE_CONTEXT');
      return structuredClone(draft);
    });
  }
  async edit(principal: TrustedPrincipal | null, groupId: string, draftId: string, raw: unknown) {
    const body = fields(raw, ['revision', 'title', 'objective', 'variables', 'rules']);
    return this.options.groups.repository.transaction(state => {
      const group = this.options.groups.currentGroup(state, principal, groupId, true);
      const draft = group.drafts.find(item => item.id === draftId) ?? fail('NOT_FOUND');
      if (draft.createdDecisionId || body.revision !== draft.revision || draft.groupVersion !== group.version) return fail('STALE_CONTEXT');
      const result = KE.PublicDecisionFrame.safeParse({ ...draft.frame, title: body.title, objective: body.objective, variables: body.variables, rules: body.rules });
      if (!result.success || result.data.variables.some(item => item.visibility !== 'PUBLIC') || result.data.rules.some(item => item.visibility !== 'PUBLIC')) return fail('INVALID_COMMAND');
      draft.frame = result.data; draft.revision++;
      draft.clarificationQuestions = genericCandidates(draft.frame).length ? [] : ['Clarify supported public choices or value limits before creating this decision.'];
      return structuredClone(draft);
    });
  }
  async create(principal: TrustedPrincipal | null, groupId: string, draftId: string, raw: unknown) {
    const body = fields(raw, ['revision']);
    const expiresAt = this.options.now() + 30000;
    // Reserve/lock the exact draft and version binding BEFORE application creation. Races fail closed.
    const reserved = await this.options.groups.repository.transaction(state => {
      const group = this.options.groups.currentGroup(state, principal, groupId, true);
      const draft = group.drafts.find(item => item.id === draftId) ?? fail('NOT_FOUND');
      if (body.revision !== draft.revision || draft.groupVersion !== group.version) return fail('STALE_CONTEXT');
      if (draft.clarificationQuestions.length || !genericCandidates(draft.frame).length) return fail('NEEDS_CLARIFICATION');
      if (!this.options.isEnabled()) return fail('STALE_CONTEXT');
      const members = group.members.map(subject => {
        const account = state.accounts.find(item => item.subject === subject);
        if (account?.status !== 'APPROVED') return fail('STALE_CONTEXT');
        return { subject, participantId: draft.frame.participants.find(person => person.id === `member-${hashSubject(subject)}`)?.id ?? fail('STALE_CONTEXT'), active: true };
      });
      const decisionId = `groupdecision-${hash([groupId, draftId]).slice(0, 40)}`;
      if (!draft.createdDecisionId) {
        if (group.decisions.length >= 64) return fail('INVALID_COMMAND');
        group.decisions.push({ id: decisionId, version: group.version }); draft.createdDecisionId = decisionId;
      }
      return { draft: structuredClone(draft), members, decisionId };
    });
    const bodyHash = hash([groupId, reserved.draft.id, reserved.draft.revision, reserved.draft.groupVersion, reserved.draft.frame]);
    const replay = await this.options.application.getCreatedDecision(principal, reserved.decisionId, bodyHash);
    if (replay) { await this.options.groups.authorizeDecision(principal, reserved.decisionId); return replay; }
    const definition = KE.DecisionDefinition.parse({ ...reserved.draft.frame, decisionId: reserved.decisionId,
      variables: reserved.draft.frame.variables.map(variable => ({ ...variable, ownerParticipantId: null })) });
    await this.options.application.createDecision({ definition, creatorSubject: principal!.subject, creationBodyHash: bodyHash,
      memberships: reserved.members, creationGuard: { expiresAt, isEnabled: this.options.isEnabled } });
    await this.options.groups.authorizeDecision(principal, reserved.decisionId);
    return this.options.application.getPublicSnapshot(principal, reserved.decisionId);
  }
  async reviewRoster(principal: TrustedPrincipal | null, groupId: string, decisionId: string) {
    const roster = await this.options.groups.roster(principal, groupId);
    await this.options.groups.repository.transaction(state => {
      const group = this.options.groups.currentGroup(state, principal, groupId, true);
      if (!group.decisions.some(item => item.id === decisionId)) return fail('NOT_FOUND');
    });
    const owner = await this.options.application.getOwnerSnapshot(principal, decisionId);
    return { frame: owner.publicSnapshot.frame, controlVersion: owner.controlVersion, groupVersion: roster.version,
      participants: roster.members.map(member => ({ id: member.participantId, displayName: member.displayName })) };
  }
  async reviseRoster(principal: TrustedPrincipal | null, groupId: string, decisionId: string, raw: unknown) {
    const body = fields(raw, ['controlVersion', 'groupVersion']);
    const preview = await this.reviewRoster(principal, groupId, decisionId);
    if (body.controlVersion !== preview.controlVersion || body.groupVersion !== preview.groupVersion) return fail('STALE_CONTEXT');
    const roster = await this.options.groups.roster(principal, groupId);
    const definition = KE.DecisionDefinition.parse({ ...preview.frame, frameVersion: preview.frame.frameVersion + 1,
      semanticVersion: preview.frame.semanticVersion + 1, participants: preview.participants.map(person => ({ ...person, requiredForApproval: true })),
      requiredParticipantIds: preview.participants.map(person => person.id), variables: preview.frame.variables.map(variable => ({ ...variable, ownerParticipantId: null })) });
    await this.options.application.reviseDecision(principal, { decisionId, expectedControlVersion: preview.controlVersion, definition,
      memberships: roster.members.map(member => ({ subject: member.subject, participantId: member.participantId, active: true })) });
    await this.options.groups.repository.transaction(state => {
      const group = this.options.groups.currentGroup(state, principal, groupId, true);
      if (group.version !== preview.groupVersion || roster.version !== preview.groupVersion) return fail('STALE_CONTEXT');
      const binding = group.decisions.find(item => item.id === decisionId) ?? fail('NOT_FOUND'); binding.version = group.version;
    });
    await this.options.groups.authorizeDecision(principal, decisionId);
    return this.options.application.getPublicSnapshot(principal, decisionId);
  }
}
function hashSubject(subject: string) { return createHash('sha256').update(subject).digest('hex').slice(0, 32); }
