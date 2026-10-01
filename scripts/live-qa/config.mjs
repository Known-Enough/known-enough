import { createHash } from 'node:crypto';
export const ACCOUNT = '092954139775';
export const REGION = 'us-east-1';
export const ACTORS = ['iris', 'omar', 'tess', 'vin', 'pending', 'rejected', 'disabled', 'outsider', 'display', 'signup'];
export function validateConfig(value) {
  if (!value || value.schemaVersion !== 1 || value.account !== ACCOUNT || value.region !== REGION
    || value.stack !== 'known-enough-live-qa' || value.repository !== 'Known-Enough/known-enough'
    || value.oidcSubject !== 'repo:Known-Enough@331386621/known-enough@1377587215:ref:refs/heads/main'
    || !/^[0-9a-f]{40}$/.test(value.sourceCommit) || typeof value.primaryRollout !== 'boolean'
    || !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(value.mailDomain) || value.mailDomain.includes('..')
    || !/^Z[A-Z0-9]{5,32}$/.test(value.hostedZoneId)) throw new Error('INVALID_SETUP_CONFIGURATION');
  if (value.primaryRollout && !/^[0-9a-f-]{36}$/.test(value.primaryExpectedRevision ?? '')) throw new Error('PRIMARY_REVISION_REQUIRED');
  validateAuthorization(value.authorization);
  return structuredClone(value);
}
export function validateAuthorization(a) {
  const keys = ['approved', 'expiresAt', 'maxRunsPerDay', 'maxAttemptsPerRun', 'maxTokensPerRun', 'maxCostMicrosPerRun', 'attemptCostMicros', 'maxSignupMessagesPerRun', 'maxSignupMessagesPerDay', 'retentionReviewed', 'invocationLoggingDisabled'];
  if (!a || Object.keys(a).sort().join() !== keys.sort().join() || !Number.isFinite(Date.parse(a.expiresAt))
    || ['approved','retentionReviewed','invocationLoggingDisabled'].some(key => typeof a[key] !== 'boolean')
    || keys.filter(key => key.startsWith('max') || key === 'attemptCostMicros').some(key => !Number.isSafeInteger(a[key]) || a[key] < 0)) throw new Error('INVALID_AUTHORIZATION');
  if (a.approved && (!a.maxRunsPerDay || !a.maxSignupMessagesPerRun || !a.maxSignupMessagesPerDay || !a.maxAttemptsPerRun || !a.maxTokensPerRun
    || !a.attemptCostMicros || a.maxCostMicrosPerRun < a.attemptCostMicros || !a.retentionReviewed || !a.invocationLoggingDisabled)) throw new Error('INCOMPLETE_APPROVED_ENVELOPE');
  return structuredClone(a);
}
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export function requireRunId(id) { if (!/^[a-z0-9-]{8,64}$/.test(id ?? '')) throw new Error('INVALID_RUN_ID'); return id; }
export function targetNames(config) { return { prefix: config.stack, artifacts: `known-enough-qa-artifacts-${config.account}`, decisions: 'KnownEnoughQaDecisions', groups: 'KnownEnoughQaGroups', control: 'KnownEnoughQaControl', functionName: 'known-enough-qa-api', brokerName: 'known-enough-qa-fixtures', appName: 'known-enough-live-qa', domain: `known-enough-qa-${config.account}` }; }
export function publicTarget(outputs) {
  const allowed = ['Account','Region','ApiUrl','FrontendUrl','PoolId','ParticipantClientId','DisplayClientId','CognitoDomain','ApiFunction','BrokerFunction','DecisionTable','GroupTable','ControlTable','MailboxBucket','LoginSecret','TestRoleArn','ReleaseRoleArn','SourceCommit','AmplifyAppId'];
  if (allowed.some(key => typeof outputs[key] !== 'string' || !outputs[key])) throw new Error('INCOMPLETE_INSTALLED_TARGET');
  return Object.fromEntries(allowed.map(key => [key, outputs[key]]));
}
