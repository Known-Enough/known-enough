import test from 'node:test';
import assert from 'node:assert/strict';
import { lifecyclePackageBytes, loadLifecyclePackage } from './lifecycle-package.ts';
test('independent random keys are preserved across source updates',()=>{
 const first=lifecyclePackageBytes('a'.repeat(40));const second=lifecyclePackageBytes('a'.repeat(40));
 assert.notEqual(loadLifecyclePackage(first).signingKeyBase64,loadLifecyclePackage(second).signingKeyBase64);
 const updated=loadLifecyclePackage(lifecyclePackageBytes('b'.repeat(40),first));
 assert.equal(updated.sourceSha,'b'.repeat(40));assert.equal(updated.signingKeyBase64,loadLifecyclePackage(first).signingKeyBase64);
});
test('bad sources, corrupt, oversized, zero, noncanonical and extended records fail closed',()=>{
 for(const source of ['0'.repeat(40),'a'.repeat(39),'OTHER'])assert.throws(()=>lifecyclePackageBytes(source),/LIFECYCLE_PACKAGE_INVALID/);
 const valid=loadLifecyclePackage(lifecyclePackageBytes('a'.repeat(40)));
 for(const value of [null,{...valid,extra:true},{...valid,signingKeyBase64:Buffer.alloc(32).toString('base64')},
 {...valid,signingKeyBase64:valid.signingKeyBase64+'='},{...valid,schemaVersion:2}])assert.throws(()=>loadLifecyclePackage(Buffer.from(JSON.stringify(value))),/LIFECYCLE_PACKAGE_INVALID/);
 assert.throws(()=>loadLifecyclePackage(Buffer.alloc(1025)),/LIFECYCLE_PACKAGE_INVALID/);
 assert.throws(()=>loadLifecyclePackage(Buffer.from([255])),/LIFECYCLE_PACKAGE_INVALID/);
 assert.throws(()=>lifecyclePackageBytes('a'.repeat(40),Buffer.from('corrupt')),/LIFECYCLE_PACKAGE_INVALID/);
});
