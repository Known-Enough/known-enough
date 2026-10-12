import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedDrain,proofKeys} from './jobs-precall-drain.mjs';
const source='a'.repeat(40),owned='b'.repeat(40),id='own-job';
const control={enabled:false,sourceSha:source,active:[id],slots:[]};
const job={phase:'READY',attempts:0,reservedTokens:0,reservedCostMicros:0,usage:null,lease:null,reference:{jobId:id,decisionId:'own-decision',sourceSha:source}};
const proof={sourceSha:owned,packageSource:source,jobId:id,decisionId:'own-decision',signedFrameConfirmations:2,signedPrivateConfirmations:2,duplicateReceipts:2};
test('owned disabled never-dispatched job is the only drainable class',()=>{
 assert.deepEqual(checkedDrain(control,job,proof,{packageSource:source,ownedSource:owned}),{jobId:id});
 for(const edit of [{phase:'CALLING'},{phase:'LEASED'},{phase:'DEAD'},{attempts:1},{reservedTokens:1},{reservedCostMicros:1},{usage:{inputTokens:0,outputTokens:0}},{lease:{token:'private'}}])
  assert.throws(()=>checkedDrain(control,{...job,...edit},proof,{packageSource:source,ownedSource:owned}),/DRAIN_PAID_OR_LEASED_JOB_PRESERVED/);
});
test('changed controls or missing signed source/owner proof preserve the job',()=>{
 for(const edit of [{enabled:true},{active:[]},{active:[id,'other']},{slots:[{}]},{sourceSha:owned}])
  assert.throws(()=>checkedDrain({...control,...edit},job,proof,{packageSource:source,ownedSource:owned}));
 for(const edit of [{sourceSha:source},{packageSource:owned},{jobId:'other'},{decisionId:'other'},{signedPrivateConfirmations:0},{signedFrameConfirmations:0},{duplicateReceipts:0}])
  assert.throws(()=>checkedDrain(control,job,{...proof,...edit},{packageSource:source,ownedSource:owned}),/DRAIN_OWNED_PROOF_MISMATCH/);
});
test('private proof search excludes old DEBT01 and unrelated object classes and stays bounded',()=>{
 const rows=[{Key:'ops01-owned/1ea949f1-4fc2-4bc5-981c-371819e8d57b/ops03-proof-private.json',LastModified:'9999'},
 {Key:'ops01-owned/11111111-1111-4111-9111-111111111111/state-private.json',LastModified:'9999'},
 ...Array.from({length:10},(_,i)=>({Key:`ops01-owned/11111111-1111-4111-9111-11111111111${i}/ops03-proof-private.json`,LastModified:String(i)}))];
 const keys=proofKeys(rows);assert.equal(keys.length,8);assert.ok(keys.every(key=>!key.includes('1ea949f1')&&!key.includes('state-private')));
 assert.ok(keys[0].includes('111111111119'));
});
