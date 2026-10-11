import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinatedPrivatePackages } from './jobs-api-release.mjs';
import { lifecyclePackageBytes, loadLifecyclePackage } from './lifecycle-package.ts';
import { loadJobsPackage } from './jobs-package.ts';
test('coordinated source transition keeps the original private key and joins API and worker source',()=>{
  const prior=lifecyclePackageBytes('a'.repeat(40));const next=coordinatedPrivatePackages('b'.repeat(40),prior);
  assert.equal(loadLifecyclePackage(next.lifecycle).signingKeyBase64,loadLifecyclePackage(prior).signingKeyBase64);
  assert.equal(loadLifecyclePackage(next.lifecycle).sourceSha,loadJobsPackage(next.jobs).sourceSha);
  assert.equal(loadJobsPackage(next.jobs).sourceSha,'b'.repeat(40));
});
test('missing corrupt or foreign private source bytes cannot rotate keys or become a package',()=>{
  for(const previous of [undefined,Buffer.from('bad'),Buffer.alloc(1025)])assert.throws(()=>coordinatedPrivatePackages('a'.repeat(40),previous));
  assert.throws(()=>coordinatedPrivatePackages('0'.repeat(40),lifecyclePackageBytes('a'.repeat(40))));
});
