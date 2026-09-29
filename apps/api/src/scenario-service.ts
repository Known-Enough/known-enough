import { createHash } from 'node:crypto';
import { Id, KnownEnough as KE } from '@deal-table/contracts';
import { KnownEnoughApplicationError, type KnownEnoughApplication, type DecisionArchitect,
  type TrustedPrincipal, type Clock } from '@deal-table/application';

export type ScenarioKind = 'CHRISTMAS' | 'SHARED_PURCHASE';
export interface ScenarioMember { participantId: string; displayName: string; subject: string }
const ids = ['maya', 'leo', 'nina', 'ana', 'raul'];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const money = (amountMinor: number) => ({ type: 'MONEY' as const, amountMinor, currencyCode: 'USD', minorUnit: 2 });
const option = (optionId: string): KE.DecisionValue => ({ type: 'ENUM', optionId });

/** Explicit deployment-owned directory. Client bodies can neither supply subjects nor activate invitees. */
export function readScenarioMembers(value: unknown): ScenarioMember[] {
  if (!Array.isArray(value) || value.length !== 5) throw new Error('Invalid scenario member directory');
  const members = value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join('|') !== 'displayName|participantId|subject'
      || !Id.safeParse(item.participantId).success || !Id.safeParse(item.subject).success
      || typeof item.displayName !== 'string' || !item.displayName.trim() || item.displayName.length > 80)
      throw new Error('Invalid scenario member directory');
    return { participantId: item.participantId as string, subject: item.subject as string, displayName: item.displayName as string };
  });
  if (new Set(members.map(item => item.subject)).size !== 5
    || members.map(item => item.participantId).sort().join('|') !== [...ids].sort().join('|'))
    throw new Error('Invalid scenario member directory');
  return members;
}

/** Fictional complete offers fixed independently of private owner statements; this is not a purchase optimizer. */
export function scenarioCandidates(frame: KE.PublicDecisionFrame): KE.CandidateProposal['values'][] {
  const publicIds = new Set(frame.variables.map(item => item.id));
  if (publicIds.has('funding-structure')) return [
    { structure: 'equal', amounts: [1_666_667, 1_666_667, 1_666_666], shares: [3334, 3333, 3333] },
    { structure: 'weighted', amounts: [2_500_000, 1_500_000, 1_000_000], shares: [5000, 3000, 2000] },
  ].map(offer => [
    { variableId: 'funding-structure', value: option(offer.structure) },
    ...['maya', 'leo', 'nina'].flatMap((person, index) => [
      { variableId: `${person}-ownership`, value: { type: 'PERCENTAGE' as const, basisPoints: offer.shares[index]! } },
      { variableId: `${person}-contribution`, value: money(offer.amounts[index]!) },
    ]),
  ]);
  if (!['destination', 'trip-start', 'trip-end', 'trip-duration', 'accommodation', 'estimated-total'].every(id => publicIds.has(id))) return [];
  return ['cancun', 'mazatlan', 'oaxaca'].flatMap(destination => [150_000, 160_000, 170_000].map(amount => [
    { variableId: 'destination', value: option(destination) },
    { variableId: 'trip-start', value: { type: 'DATE' as const, date: '2026-12-24' } },
    { variableId: 'trip-end', value: { type: 'DATE' as const, date: '2026-12-29' } },
    { variableId: 'trip-duration', value: { type: 'DURATION' as const, seconds: 432_000 } },
    { variableId: 'accommodation', value: option('quiet-hotel') },
    { variableId: 'estimated-total', value: money(amount) },
  ]));
}

function provisionDefinition(frame: KE.PublicDecisionFrame, kind: ScenarioKind): KE.DecisionDefinition {
  const definition = KE.DecisionDefinition.parse({ ...frame,
    variables: frame.variables.map(variable => ({ ...variable, ownerParticipantId: null })) });
  if (kind === 'CHRISTMAS') {
    const expected = ['destination', 'trip-start', 'trip-end', 'trip-duration', 'accommodation', 'estimated-total'];
    if (definition.variables.map(item => item.id).sort().join('|') !== expected.sort().join('|'))
      throw new KnownEnoughApplicationError('INVALID_COMMAND');
  } else {
    const expected = ['funding-structure', 'maya-ownership', 'leo-ownership', 'nina-ownership'];
    if (definition.variables.map(item => item.id).sort().join('|') !== expected.sort().join('|')
      || definition.variables.some(item => item.id === 'funding-structure' ? item.type !== 'ENUM'
        || item.options.map(option => option.id).sort().join('|') !== 'equal|weighted' : item.type !== 'PERCENTAGE'))
      throw new KnownEnoughApplicationError('INVALID_COMMAND');
    definition.variables.push(...['maya', 'leo', 'nina'].map(person => ({ id: `${person}-contribution`,
      type: 'MONEY' as const, visibility: 'OWNER_PRIVATE' as const, ownerParticipantId: person,
      required: true, label: 'Your hypothetical contribution', currencyCode: 'USD', minorUnit: 2 })));
    definition.rules.push({ id: 'ke14-contribution-total', visibility: 'TRUSTED_BACKEND', operator: 'SUM_EQUALS',
      variableIds: ['maya-contribution', 'leo-contribution', 'nina-contribution'], target: money(5_000_000) },
    { id: 'ke14-ownership-total', visibility: 'PUBLIC', operator: 'SUM_EQUALS',
      variableIds: ['maya-ownership', 'leo-ownership', 'nina-ownership'], target: { type: 'PERCENTAGE', basisPoints: 10_000 } });
  }
  const parsed = KE.DecisionDefinition.parse(definition);
  // Every declared offer must have valid variable/type/option references in this AI-created frame.
  // Kernel truth/consent checks still happen only against owner-confirmed conditions at reasoning time.
  for (const values of scenarioCandidates(frame)) {
    KE.CandidateForDecision.parse({ definition: parsed, candidate: { schemaVersion: 2, proposalId: 'catalog-validation',
      decisionId: parsed.decisionId, contextToken: parsed.contextToken, semanticVersion: parsed.semanticVersion,
      proposalVersion: 1, values, permissionDependencies: [], createdAt: '2026-10-01T12:00:00.000Z',
      validation: { status: 'VALID', checkedRuleIds: [], failedRuleIds: [], unknownRuleIds: [], unsupportedConditionIds: [] } } });
  }
  return parsed;
}

export class ScenarioService {
  private readonly members: ScenarioMember[];
  constructor(private readonly options: { application: KnownEnoughApplication; architect: DecisionArchitect; members: readonly ScenarioMember[];
    clock: Clock; isEnabled: () => boolean }) {
    this.members = readScenarioMembers(options.members);
  }
  async create(principal: TrustedPrincipal | null, raw: unknown): Promise<KE.PublicDecisionSnapshot> {
    // Directory authorization precedes input parsing, replay access and every provider call.
    if (principal?.kind !== 'participant' || !this.members.some(member => member.subject === principal.subject))
      throw new KnownEnoughApplicationError('FORBIDDEN');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new KnownEnoughApplicationError('INVALID_COMMAND');
    const body = raw as Record<string, unknown>;
    if (Object.keys(body).sort().join('|') !== 'idempotencyKey|objective|requestId|scenario'
      || !Id.safeParse(body.requestId).success || !Id.safeParse(body.idempotencyKey).success
      || !['CHRISTMAS', 'SHARED_PURCHASE'].includes(body.scenario as string)
      || typeof body.objective !== 'string' || !body.objective.trim() || body.objective.length > 2000)
      throw new KnownEnoughApplicationError('INVALID_COMMAND');
    const kind = body.scenario as ScenarioKind;
    const roster = kind === 'CHRISTMAS' ? this.members : this.members.filter(member => ['maya', 'leo', 'nina'].includes(member.participantId));
    if (!roster.some(member => member.subject === principal.subject)) throw new KnownEnoughApplicationError('FORBIDDEN');
    const decisionId = `decision-${hash(JSON.stringify([principal.subject, body.idempotencyKey]))}`;
    const bodyHash = hash(JSON.stringify([kind, body.objective.trim()]));
    const replay = await this.options.application.getCreatedDecision(principal, decisionId, bodyHash);
    if (replay) return replay;
    const expiresAt = Date.parse(this.options.clock.now()) + 30_000;
    const objective = kind === 'CHRISTMAS'
      ? `${body.objective.trim()}\nSynthetic Christmas frame: exactly destination ENUM (cancun/Cancún, oaxaca/Oaxaca, mazatlan/Mazatlán); trip-start DATE; trip-end DATE; trip-duration DURATION SECONDS; accommodation ENUM (shared-villa/Shared villa, quiet-hotel/Quiet hotel); estimated-total MONEY USD minorUnit 2. No other variables. Synthetic dates and offers only.`
      : `${body.objective.trim()}\nHypothetical USD 50,000 exploration only, no advice or purchase. Exactly funding-structure ENUM (equal/Equal contributions, weighted/Weighted contributions), maya-ownership, leo-ownership, nina-ownership PERCENTAGE. No other public variables. Each owner will privately confirm their contribution limits. No legal, tax or mortgage conclusion.`;
    const draft = await this.options.architect.draft(principal.subject, { draftId: body.idempotencyKey as string,
      revision: 1, objective, participants: roster.map(member => ({ id: member.participantId, displayName: member.displayName })),
      allowedOptions: kind === 'CHRISTMAS' ? ['Cancún', 'Oaxaca', 'Mazatlán', 'Shared villa', 'Quiet hotel'] : ['Equal contributions', 'Weighted contributions'] });
    if (draft.status !== 'DEFINING') throw new KnownEnoughApplicationError('NEEDS_CLARIFICATION');
    const definition = provisionDefinition({ ...draft.frame, decisionId, objective: body.objective.trim() }, kind);
    await this.options.application.createDecision({ definition, creatorSubject: principal.subject, creationBodyHash: bodyHash,
      creationGuard: { expiresAt, isEnabled: this.options.isEnabled },
      memberships: roster.map(member => ({ subject: member.subject, participantId: member.participantId, active: member.subject === principal.subject })) });
    return this.options.application.getPublicSnapshot(principal, decisionId);
  }
}
