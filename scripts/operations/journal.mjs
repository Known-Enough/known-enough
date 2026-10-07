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
      if (!await storage.compareAndSwap(checked.planHash, expectedRevision,
        { revision: result.storageRevision, journal: result.journal })) throw new Error('OPS_JOURNAL_CONFLICT');
      return load(plan, envelope);
    }
  };
}
