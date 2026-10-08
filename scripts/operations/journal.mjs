import { validatePlan, validateRecovery, advanceRecovery } from './plan.mjs';
// Port requires atomic createIfAbsent and compareAndSwap. Implementations must
// persist privately across runners; this module never substitutes local memory.
export function journalService(storage) {
  for (const method of ['read', 'createIfAbsent', 'compareAndSwap']) {
    if (typeof storage?.[method] !== 'function') throw new Error('OPS_STORAGE_REQUIRED');
  }
  async function load(plan, envelope) {
    const checked = validatePlan(plan, envelope);
    const record = await storage.read(checked.planHash);
    if (!record || !Number.isSafeInteger(record.revision) || record.revision < 0) throw new Error('OPS_JOURNAL_UNAVAILABLE');
    return { revision: record.revision, journal: validateRecovery(record.journal, plan, envelope) };
  }
  return {
    load,
    async prepare(plan, envelope) {
      const checked = validatePlan(plan, envelope);
      const journal = { schemaVersion: 1, planHash: checked.planHash, resourceArn: checked.resourceArn,
        expectedRevision: checked.expectedRevision, completedItems: 0, state: 'PREPARED' };
      await storage.createIfAbsent(checked.planHash, { revision: 0, journal });
      return load(plan, envelope);
    },
    async advance(plan, envelope, expectedRevision, next) {
      const checked = validatePlan(plan, envelope);
      const current = await load(plan, envelope);
      const result = advanceRecovery(current.journal, next, plan, envelope, current.revision, expectedRevision);
      const acknowledged = await storage.compareAndSwap(checked.planHash, expectedRevision,
        { revision: result.storageRevision, journal: result.journal });
      if (acknowledged === false) throw new Error('OPS_JOURNAL_CONFLICT');
      if (acknowledged !== true) throw new Error('OPS_JOURNAL_UNAVAILABLE');
      const observed = await load(plan, envelope);
      // Readback can include legitimate later writers. It must still establish
      // this progression, without accepting stale contents or a rollback.
      if (observed.revision < result.storageRevision
        || (observed.revision === result.storageRevision
          && Object.entries(result.journal).some(([key, value]) => observed.journal[key] !== value))
        || observed.journal.completedItems < result.journal.completedItems
        || (result.journal.state === 'APPLYING' && observed.journal.state === 'PREPARED')
        || (result.journal.state === 'COMPLETE' && (observed.journal.state !== 'COMPLETE'
          || observed.journal.completedItems !== result.journal.completedItems))) throw new Error('OPS_JOURNAL_UNAVAILABLE');
      return observed;
    }
  };
}
