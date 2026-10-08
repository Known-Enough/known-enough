import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySource } from './verify.mjs';
import { partitionSetupTemplate } from './partition-setup.mjs';
export function partitionVerificationReport(env, savedTemplate) {
  const sourceSha = verifySource(env);
  const template = JSON.stringify(partitionSetupTemplate(), null, 2) + '\n';
  if (savedTemplate !== template) throw new Error('PARTITION_SETUP_DRIFT');
  return { schemaVersion: 1, sourceSha, templateHash: createHash('sha256').update(template).digest('hex'),
    result: 'OFFLINE_VERIFIED', installation: 'UNKNOWN', effectivePermissions: 'UNKNOWN',
    migration: 'NOT_EXECUTED', activation: 'DISABLED', managedRecovery: 'UNKNOWN' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(partitionVerificationReport(process.env, readFileSync('infra/operations/partition-setup.json', 'utf8')))); }
  catch { console.error('PARTITION_VERIFICATION_FAILED'); process.exitCode = 1; }
}
