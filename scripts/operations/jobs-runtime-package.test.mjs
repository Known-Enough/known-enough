import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { prepareJobRuntime } from './jobs-runtime-package.mjs';
test('actual compiled worker archive contains only ID runtime configuration and bundled executable with matching digest', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ops03-worker-package-'));
  try {
    const report = await prepareJobRuntime('a'.repeat(40), join(folder, 'private'));
    const bytes = await readFile(join(folder, 'private/model-worker.zip'));
    assert.equal(report.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(report.providerCalls, 0); assert.equal(report.schedule, 'DISABLED');
    const { stdout } = await promisify(execFile)('python3', ['-c', "import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.namelist()==['jobs-private.json','worker.mjs']; c=json.loads(z.read('jobs-private.json')); assert sorted(c)==['schemaVersion','sourceSha']; print(c['sourceSha'])", join(folder, 'private/model-worker.zip')]);
    assert.equal(stdout.trim(), 'a'.repeat(40));
    const bundle = await readFile(join(folder, 'private/worker.mjs'), 'utf8');
    assert.ok(!/from ['"](?:@aws-sdk|@deal-table)/.test(bundle));
    await assert.rejects(prepareJobRuntime('a'.repeat(40), join(folder, 'private')));
  } finally { await rm(folder, { recursive: true, force: true }); }
});
