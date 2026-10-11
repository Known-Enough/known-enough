import test from 'node:test';
import assert from 'node:assert/strict';
import {lifecycleReadProof,ownerPolicyProof} from './lifecycle-installed-check.mjs';
import {accessProfiles} from './access-setup.mjs';
const nonce='12345678-1234-1234-1234-123456789abc';
test('missing policy is explicit absence, not installed retention or permission denial',async()=>{const result=await lifecycleReadProof(async()=>({}),'retention',nonce);assert.equal(result.result,'LIFECYCLE_READ_ACCESS_PASS');assert.equal(result.policyState,'ABSENT');assert.equal(result.mutations,0);});
test('actual denial remains failed while private SDK diagnostics never enter reports',async()=>{const result=await lifecycleReadProof(async()=>{throw Object.assign(new Error('PRIVATE_EMAIL SECRET'),{name:'AccessDeniedException'});},'erasure',nonce);assert.equal(result.result,'LIFECYCLE_READ_ACCESS_INCOMPLETE');assert.equal(result.checks.length,5);assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.ok(result.checks.every(item=>item.code==='AccessDeniedException'));});
test('unexpected fixture collision cannot be claimed a clean empty probe',async()=>{const result=await lifecycleReadProof(async()=>({Items:[{}]}),'erasure',nonce);assert.equal(result.result,'LIFECYCLE_READ_ACCESS_INCOMPLETE');});
test('configured owner policy requires exact current role document and does not prove a self-consent execution',()=>{assert.equal(ownerPolicyProof(accessProfiles().ownerRuntime).result,'OWNER_POLICY_CONFIGURATION_MATCH');assert.equal(ownerPolicyProof({Version:'2012-10-17',Statement:[]}).result,'OWNER_POLICY_CONFIGURATION_MISMATCH');assert.equal(ownerPolicyProof(accessProfiles().ownerRuntime).effectiveOwnerOperation,'NOT_EXECUTED');});
