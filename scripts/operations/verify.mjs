import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setupTemplate } from './setup.mjs';
export function verifySource(env) {
  try {
    const sourceSha = env.GITHUB_SHA;
    if (env.GITHUB_REPOSITORY !== 'Known-Enough/known-enough' || env.GITHUB_REF !== 'refs/heads/main'
      || env.GITHUB_ACTOR_ID !== '143764700' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
      || typeof sourceSha !== 'string' || !/^[a-f0-9]{40}$/.test(sourceSha) || env.EXPECTED_SOURCE !== sourceSha
      || env.CHECKOUT_SOURCE !== sourceSha) throw new Error();
    return sourceSha;
  } catch { throw new Error('OPS_SOURCE_REJECTED'); }
}
export function verificationReport(sourceSha, installedTemplate) {
  if (typeof sourceSha !== 'string' || !/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('OPS_SOURCE_REJECTED');
  const template = JSON.stringify(setupTemplate(), null, 2) + '\n';
  if (installedTemplate !== template) throw new Error('OPS_TEMPLATE_DRIFT');
  return { schemaVersion: 1, sourceSha, templateHash: createHash('sha256').update(template).digest('hex'),
    result: 'OFFLINE_VERIFIED', installation: 'UNKNOWN', managedRecovery: 'UNKNOWN', apply: 'DISABLED' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const sourceSha = verifySource(process.env);
    const template = readFileSync('infra/operations/setup.json', 'utf8');
    console.log(JSON.stringify(verificationReport(sourceSha, template), null, 2));
  } catch { console.error('OPS_VERIFICATION_FAILED'); process.exitCode = 1; }
}
