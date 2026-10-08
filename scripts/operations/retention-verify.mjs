import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { verifySource } from './verify.mjs';
import { retentionPreparationBytes } from './retention-setup.mjs';
export function retentionVerificationReport(env, saved) {
  const source = verifySource(env);
  if (saved !== retentionPreparationBytes()) throw new Error('RETENTION_PREPARATION_DRIFT');
  return { schemaVersion: 1, result: 'OFFLINE_VERIFIED', sourceSha: source,
    preparationHash: createHash('sha256').update(saved).digest('hex'), installation: 'UNKNOWN', activation: 'DISABLED',
    realPersonPolicy: 'UNAPPROVED', dataOperations: 'NOT_EXECUTED', participantGrants: 'NOT_GRANTED', managedProof: 'UNKNOWN' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(retentionVerificationReport(process.env, readFileSync('infra/operations/retention-setup.json', 'utf8')))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
