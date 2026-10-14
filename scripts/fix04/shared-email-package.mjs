import { createHash, createHmac } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySource } from '../operations/verify.mjs';
import { partitionDeploymentOptions } from '../../apps/api/src/partition-deployment.ts';

/** Checked private deployment bytes only. No AWS configuration/IAM write or account mutation. */
export function withSharedEmailConfiguration(configurationBytes, manifestBytes, release, email) {
  const options = partitionDeploymentOptions(configurationBytes, manifestBytes, release);
  if (options.identity.userPoolId !== 'us-east-1_V9OMjd0zx'
      || options.allowedOrigin !== 'https://main.d143q5ravxp5av.amplifyapp.com'
      || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('SHARED_EMAIL_PACKAGE_INVALID');
  }
  const hash = createHmac('sha256', options.emailKey).update(email.trim().toLowerCase()).digest('hex');
  const allowed = [...(options.sharedTestEmailHashes ?? [])];
  if (!allowed.includes(hash)) allowed.push(hash);
  const config = JSON.parse(configurationBytes);
  const next = Buffer.from(JSON.stringify({ ...config, sharedTestEmailHashes: allowed }));
  const binding = { ...release, configurationHash: createHash('sha256').update(next).digest('hex') };
  // Validate the new independent config anchor while preserving every migration/source/private key.
  partitionDeploymentOptions(next, manifestBytes, binding);
  return { configurationBytes: next, release: binding };
}

export async function configureSharedEmailPackage(directory, email) {
  const configurationBytes = await readFile(join(directory, 'configuration-private.json'));
  const manifestBytes = await readFile(join(directory, 'manifest-private.json'));
  const release = JSON.parse(await readFile(join(directory, 'release-private.json')));
  const next = withSharedEmailConfiguration(configurationBytes, manifestBytes, release, email);
  await writeFile(join(directory, 'configuration-private.json'), next.configurationBytes, { mode: 0o600 });
  await writeFile(join(directory, 'release-private.json'), JSON.stringify(next.release), { mode: 0o600 });
}

export function verifySharedEmailConfigured(configurationBytes, manifestBytes, release, email) {
  const configured = withSharedEmailConfiguration(configurationBytes, manifestBytes, release, email);
  if (!configured.configurationBytes.equals(configurationBytes)) throw new Error('SHARED_EMAIL_READBACK_MISMATCH');
  return true;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const source = verifySource(process.env), directory = join(process.env.RUNNER_TEMP, 'partition-cutover-private');
    verifySharedEmailConfigured(await readFile(join(directory, 'configuration-private.json')),
      await readFile(join(directory, 'manifest-private.json')), JSON.parse(await readFile(join(directory, 'release-private.json'))),
      process.env.KE_SHARED_TEST_EMAIL);
    console.log(JSON.stringify({ source, result: 'PRIVATE_SELECTED_EMAIL_READBACK_PASS', accountChanges: 0, emailRequests: 0, modelCalls: 0 }));
  } catch { console.log(JSON.stringify({ result: 'BLOCKED', code: 'SHARED_EMAIL_READBACK_MISMATCH' })); process.exitCode = 1; }
}
