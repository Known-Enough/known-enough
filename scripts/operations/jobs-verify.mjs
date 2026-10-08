import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { verifySource } from './verify.mjs';
import { jobPreparationBytes } from './jobs-setup.mjs';
export function jobVerificationReport(env, saved) {
  const source = verifySource(env); if (saved !== jobPreparationBytes()) throw new Error('JOB_PREPARATION_DRIFT');
  return { schemaVersion: 1, result: 'OFFLINE_VERIFIED', sourceSha: source, preparationHash: createHash('sha256').update(saved).digest('hex'),
    installation: 'UNKNOWN', activation: 'DISABLED', providerCalls: 'NOT_EXECUTED', managedRecovery: 'UNKNOWN', participantConsent: 'NOT_GRANTED', cleanup: 'UNKNOWN' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(jobVerificationReport(process.env, readFileSync('infra/operations/jobs-setup.json', 'utf8')))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
