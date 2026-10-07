import { createHash } from 'node:crypto';
const operations = ['PARTITION', 'ARCHIVE', 'ERASE', 'JOB_RECOVERY'];
function reject() { throw new Error('OPS_PLAN_REJECTED'); }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) reject();
}
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
// Envelope comes from a separately verified resource contract, never the submitted plan.
export function validatePlan(plan, envelope) {
  exact(envelope, ['sourceSha', 'operation', 'resourceArn', 'contractHash', 'maxItems']);
  exact(plan, ['schemaVersion', 'sourceSha', 'account', 'region', 'operation', 'resourceArn', 'contractHash', 'expectedRevision', 'maxItems', 'recoveryManifestHash']);
  if (!/^[a-f0-9]{40}$/.test(envelope.sourceSha) || !operations.includes(envelope.operation)
    || !hash(envelope.contractHash) || !Number.isSafeInteger(envelope.maxItems) || envelope.maxItems < 1 || envelope.maxItems > 1000
    || typeof envelope.resourceArn !== 'string'
    || !/^arn:aws:dynamodb:us-east-1:092954139775:table\/KnownEnough[A-Za-z0-9_-]+$/.test(envelope.resourceArn)) reject();
  if (plan.schemaVersion !== 1 || plan.account !== '092954139775' || plan.region !== 'us-east-1'
    || plan.sourceSha !== envelope.sourceSha || plan.operation !== envelope.operation
    || plan.resourceArn !== envelope.resourceArn || plan.contractHash !== envelope.contractHash
    || !Number.isSafeInteger(plan.expectedRevision) || plan.expectedRevision < 0
    || !Number.isSafeInteger(plan.maxItems) || plan.maxItems < 1 || plan.maxItems > envelope.maxItems
    || !hash(plan.recoveryManifestHash)) reject();
  const canonical = Object.fromEntries(Object.keys(plan).sort().map(key => [key, plan[key]]));
  return Object.freeze({ ...canonical, planHash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex') });
}
export function validateRecovery(journal, plan, envelope) {
  const checkedPlan = validatePlan(plan, envelope);
  exact(journal, ['schemaVersion', 'planHash', 'resourceArn', 'expectedRevision', 'completedItems', 'state']);
  if (!hash(checkedPlan?.planHash) || journal.schemaVersion !== 1 || journal.planHash !== checkedPlan.planHash
    || journal.resourceArn !== checkedPlan.resourceArn || journal.expectedRevision !== checkedPlan.expectedRevision
    || !Number.isSafeInteger(journal.completedItems) || journal.completedItems < 0 || journal.completedItems > checkedPlan.maxItems
    || !['PREPARED', 'APPLYING', 'COMPLETE'].includes(journal.state)
    || (journal.state === 'PREPARED' && journal.completedItems !== 0)) reject();
  return Object.freeze({ ...journal });
}
