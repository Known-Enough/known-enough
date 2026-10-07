import { validatePlan } from './plan.mjs';
import { manifestStore } from './manifest.mjs';
import { journalService } from './journal.mjs';
// Preparation preserves recovery first and creates/resumes its journal. It performs
// no participant/data mutation and cannot advance a journal to COMPLETE.
export async function prepareRecovery({ plan, envelope, manifestBytes, manifestTransport, bucket, journalStorage }) {
  const checked = validatePlan(plan, envelope);
  const manifests = manifestStore(manifestTransport, bucket);
  const journals = journalService(journalStorage);
  await manifests.preserve(manifestBytes, checked.recoveryManifestHash);
  const current = await journals.prepare(plan, envelope);
  return Object.freeze({ sourceSha: checked.sourceSha, planHash: checked.planHash, contractHash: checked.contractHash,
    state: current.journal.state, storageRevision: current.revision, completedItems: current.journal.completedItems,
    recoveryPreservation: 'READBACK_VERIFIED', operationExecution: 'NOT_EXECUTED' });
}
