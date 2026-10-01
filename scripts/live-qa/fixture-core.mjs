import { ACTORS, requireRunId, validateAuthorization } from './config.mjs';
export function beginLease(prior, runId, authorization, now) {
  requireRunId(runId); validateAuthorization(authorization);
  if (!authorization.approved || Date.parse(authorization.expiresAt) <= now) throw new Error('AUTHORIZATION_ABSENT_OR_EXPIRED');
  if (prior && prior.status !== 'CLEAN') { if (prior.id === runId && prior.expiresAt > now && prior.status === 'ACTIVE') return prior; throw new Error('LEASE_OR_CLEANUP_BLOCKED'); }
  return { id: runId, status: 'ACTIVE', expiresAt: Math.min(now + 45 * 60000, Date.parse(authorization.expiresAt)), users: [], decisionIds: [], attempts: 0, reservedTokens: 0, reservedCostMicros: 0, mailboxObjects: [] };
}
export function actorUsername(runId, actor) { requireRunId(runId); if (!ACTORS.includes(actor)) throw new Error('UNKNOWN_ACTOR'); return `qa-${runId}-${actor}`; }
export function cleanupPlan(state, lease) {
  if (!lease || !['ACTIVE','CLEANING','CLEANUP_FAILED'].includes(lease.status)) throw new Error('NO_CLEANUP_LEASE');
  const subjects = new Set(lease.users.map(user => user.subject).filter(Boolean));
  const groups = state.groups.filter(group => subjects.has(group.organizer));
  if (state.groups.some(group => !subjects.has(group.organizer)) || groups.some(group => group.members.some(subject => !subjects.has(subject))) || state.accounts.some(account => !subjects.has(account.subject))) throw new Error('UNOWNED_QA_STATE');
  const decisions = [...new Set(groups.flatMap(group => group.decisions.map(item => item.id)))];
  if (lease.decisionIds.some(id => !decisions.includes(id))) throw new Error('UNBOUND_DECISION');
  return { decisions, groups: groups.map(group => group.id), subjects: [...subjects] };
}
export function reserveAttempt(lease, authorization, now, inputBytes, outputTokens) {
  if (!lease || lease.status !== 'ACTIVE' || lease.expiresAt <= now || !authorization.approved || Date.parse(authorization.expiresAt) <= now) throw new Error('MODEL_BUDGET_BLOCKED');
  const tokens = inputBytes + outputTokens;
  const cost=Math.max(authorization.attemptCostMicros,tokens); // Conservative $1/million total tokens; verify price ceiling during LIVE04.
  if (!Number.isSafeInteger(tokens) || inputBytes < 0 || outputTokens < 1 || lease.attempts + 1 > authorization.maxAttemptsPerRun
    || lease.reservedTokens + tokens > authorization.maxTokensPerRun || lease.reservedCostMicros + cost > authorization.maxCostMicrosPerRun) throw new Error('MODEL_BUDGET_EXHAUSTED');
  return { ...lease, attempts: lease.attempts + 1, reservedTokens: lease.reservedTokens + tokens, reservedCostMicros: lease.reservedCostMicros + cost };
}
