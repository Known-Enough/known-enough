import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticProofPolicy, ownedRegistrationStamp, ownerProofReport } from './lifecycle-owned-behavior.mjs';
const runId='12345678-1234-1234-1234-123456789abc';
const at='2026-10-11T06:00:00.000Z';
const fixture={runId,nonce:runId,subject:runId,password:'PRIVATE_PASSWORD_CANARY'.repeat(2),
 mailbox:{address:'keqa-test@example.invalid'},registered:true,observedRegistrationAt:at};
test('a proof cannot replace a real, active, unknown or changed retention policy',()=>{
 const enabled=syntheticProofPolicy(null);assert.equal(enabled.structuredMs,30*86400000);assert.equal(enabled.dataClass,'SYNTHETIC');
 assert.throws(()=>syntheticProofPolicy(enabled),/PROOF_POLICY_NOT_SAFE_TO_REPLACE/);
 assert.throws(()=>syntheticProofPolicy({...enabled,enabled:false,dataClass:'REAL',realPersonPolicy:'APPROVED'}));
 assert.throws(()=>syntheticProofPolicy({...enabled,enabled:false,structuredMs:86400000}));
 assert.equal(syntheticProofPolicy({...enabled,enabled:false}).revision,2);
});
test('only recent observed registration for the exact owned signed fixture supplies timestamps',()=>{
 const now=Date.parse(at)+1000;const result=ownedRegistrationStamp(fixture,runId,1,now);
 assert.equal(result.createdAt,at);assert.equal(result.lastActivityAt,at);assert.equal(result.dataClass,'SYNTHETIC');
 for(const changes of [{registered:false},{observedRegistrationAt:'invalid'},{observedRegistrationAt:'2026-10-11T07:00:00.000Z'},{runId:'foreign'},{subject:'foreign'}])
  assert.throws(()=>ownedRegistrationStamp({...fixture,...changes},runId,1,now));
 assert.throws(()=>ownedRegistrationStamp(fixture,runId,1,now+3600000));
});
test('proof reports disclose only bounded counters and no fixture, grant, plan or deleted contents',()=>{
 const report=ownerProofReport('a'.repeat(40),{exports:2,apiChecks:-1,erased:'PRIVATE_SECRET',plans:[{bytes:'PRIVATE_PLAN'}],accessToken:'PRIVATE_TOKEN'},'execute','OWNER_PROOF_PHASE_PASS');
 assert.equal(report.exports,2);assert.equal(report.apiChecks,0);assert.equal(report.erased,0);
 assert.ok(!/PRIVATE|token|plans|subject|mailbox/.test(JSON.stringify(report)));
});
