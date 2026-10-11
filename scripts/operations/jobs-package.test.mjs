import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJobsPackage } from './jobs-package.ts';
test('only finite source-bound private packages select the runtime', () => {
  const valid = { schemaVersion: 1, sourceSha: 'a'.repeat(40) };
  assert.deepEqual(loadJobsPackage(Buffer.from(JSON.stringify(valid))), valid);
  for (const value of [null, [], { ...valid, sourceSha: '0'.repeat(40) }, { ...valid, enabled: true },
    { ...valid, sourceSha: 'bad' }, { ...valid, schemaVersion: 2 }]) {
    assert.throws(() => loadJobsPackage(Buffer.from(JSON.stringify(value))), /JOBS_PACKAGE_INVALID/);
  }
  for (const bytes of [Buffer.from([255]), Buffer.alloc(257), Buffer.from('')]) assert.throws(() => loadJobsPackage(bytes));
});
