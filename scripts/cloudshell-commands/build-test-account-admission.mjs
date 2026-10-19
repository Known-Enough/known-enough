// Local packaging only; this script performs no AWS or participant operations.
import { rolldown } from 'rolldown';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const bundle = await rolldown({ input: 'scripts/cloudshell-commands/test-account-admission.ts',
  platform: 'node', external: [/^node:/] });
try {
  const { output } = await bundle.generate({ format: 'esm', codeSplitting: false, minify: true });
  if (output.length !== 1 || output[0].type !== 'chunk') throw new Error('ONE_BUNDLE_REQUIRED');
  const bytes = gzipSync(Buffer.from(output[0].code), { level: 9 });
  await writeFile('scripts/cloudshell-commands/test-account-admission.mjs.gz', bytes);
  console.log(JSON.stringify({ sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    awsOperations: 0, testsExecuted: 0 }));
} finally { await bundle.close(); }
