import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedPublicDraft, enqueueRequest, proofReport, PROOF_ROLES, awsFailure } from './jobs-owned-proof.mjs';
import { RequestNegotiation } from '@deal-table/contracts/durable-command';
const nonce='11111111-1111-4111-9111-111111111111';
const group={members:['own-a','own-b'],version:2};
const accounts=group.members.map(subject=>({subject,status:'APPROVED',displayName:'Owned synthetic persona'}));
test('synthetic structured frame binds every actual owned member without inventing participant grants',()=>{
 const draft=ownedPublicDraft(group,accounts,nonce);
 assert.equal(draft.frame.participants.length,2);assert.deepEqual(draft.frame.requiredParticipantIds,draft.frame.participants.map(p=>p.id));
 assert.equal(draft.groupVersion,2);assert.equal(draft.createdDecisionId,null);assert.equal(draft.clarificationQuestions.length,0);
 assert.ok(draft.frame.variables.every(v=>v.visibility==='PUBLIC'&&!('ownerParticipantId' in v)));
});
test('unapproved or missing member cannot enter synthetic setup',()=>{
 assert.throws(()=>ownedPublicDraft(group,accounts.slice(0,1),nonce),/OWN_DRAFT_ACCOUNT_INVALID/);
 assert.throws(()=>ownedPublicDraft(group,accounts.map(a=>({...a,status:'PENDING'})),nonce),/OWN_DRAFT_ACCOUNT_INVALID/);
});
test('enqueue uses the actual strict contract and contains no fixture identity or provider input',()=>{
 const owner={controlVersion:4,publicSnapshot:{frame:{contextToken:'c'.repeat(64),semanticVersion:1}},private:'synthetic-private-marker'};
 const request=enqueueRequest('owned-decision',owner);assert.deepEqual(RequestNegotiation.parse(request),request);
 assert.deepEqual(Object.keys(request).sort(),['decisionId','expected','requestId','schemaVersion','type']);assert.equal(request.expected.controlVersion,4);
 assert.ok(!JSON.stringify(request).includes('synthetic-private-marker'));
});
test('finite public report omits credentials, subjects, private drafts and unsafe error text',()=>{
 const report=proofReport('a'.repeat(40),'observe',{accessToken:'synthetic-private-marker',subject:'private',apiChecks:4,terminalSuccesses:0},'OWNED_JOB_PHASE_BLOCKED','private error value');
 assert.equal(report.apiChecks,4);assert.equal(report.terminalSuccesses,0);assert.ok(!JSON.stringify(report).includes('synthetic-private-marker'));assert.ok(!('code' in report));
 assert.equal(proofReport('a'.repeat(40),'observe',null,'OWNED_JOB_PHASE_BLOCKED','AccessDeniedException').code,'AccessDeniedException');
});

test('phase uses installed room-writer role while resource setup remains migration-only',()=>{
 assert.equal(PROOF_ROLES.prepare,'KnownEnoughGithubPartitionMigration');
 assert.equal(PROOF_ROLES.consent,'KnownEnoughGithubModelJobOperations');
 assert.equal(PROOF_ROLES.policy,'KnownEnoughGithubRetentionPolicy');
 assert.equal(PROOF_ROLES.preserve,'KnownEnoughGithubQaRelease');
 assert.ok(Object.isFrozen(PROOF_ROLES));
});
test('native wrapped AWS failures retain their exact sanitized cause',()=>{
 assert.equal(awsFailure({cause:{cause:{name:'AccessDeniedException',message:'synthetic-private-marker'}}}),'AccessDeniedException');
 assert.equal(awsFailure({name:'unclassified',message:'synthetic-private-marker'}),null);
});

import { TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { ownedDraftGuardPut } from './jobs-owned-proof.mjs';
import { lifecycleFixture } from '../../packages/adapters/src/test-support/partition-lifecycle-fixture.ts';
import { encodeDecisionStateItem, decodeGuardItem } from '../../packages/adapters/src/dynamodb-codec.ts';
async function nativeDraftCommand(){
 const {record,guard}=await lifecycleFixture();const table='arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughStage';
 const command=new TransactWriteItemsCommand({ClientRequestToken:'11111111-1111-4111-9111-111111111111',TransactItems:[
  {Put:{TableName:table,Item:encodeDecisionStateItem(record),ConditionExpression:'attribute_exists(#pk)',ExpressionAttributeNames:{'#pk':'PK'}}},
  {Update:{TableName:table,Key:{PK:{S:'ROOM#'+record.decisionId},SK:{S:'GUARD'}},
   UpdateExpression:'SET #version = :nextVersion, #ordinary = :nextOrdinary, #permission = :nextPermission, #safety = :nextSafety, #total = :nextTotal',
   ConditionExpression:'#version = :oldVersion AND #incarnation = :incarnation AND #ordinary = :oldOrdinary AND #permission = :oldPermission AND #safety = :oldSafety AND #total = :oldTotal',
   ExpressionAttributeNames:{'#version':'version','#incarnation':'incarnation','#ordinary':'ordinaryReceipts','#permission':'permissionHistoryReceipts','#safety':'safetyReserveReceipts','#total':'totalReceipts'},
   ExpressionAttributeValues:{':nextVersion':{N:String(guard.version+1)},':nextOrdinary':{N:String(guard.ordinaryReceipts)},':nextPermission':{N:String(guard.permissionHistoryReceipts)},':nextSafety':{N:String(guard.safetyReserveReceipts)},':nextTotal':{N:String(guard.totalReceipts)},':oldVersion':{N:String(guard.version)},':incarnation':{S:guard.incarnation},':oldOrdinary':{N:String(guard.ordinaryReceipts)},':oldPermission':{N:String(guard.permissionHistoryReceipts)},':oldSafety':{N:String(guard.safetyReserveReceipts)},':oldTotal':{N:String(guard.totalReceipts)}}}}]});
 return {record,guard,table,command};
}
test('synthetic native guard replacement preserves state and every CAS fence without UpdateItem',async()=>{
 const {record,guard,table,command}=await nativeDraftCommand(),before=structuredClone(command.input);
 const result=ownedDraftGuardPut(command,record.decisionId,table);
 assert.deepEqual(command.input,before);assert.deepEqual(result.input.TransactItems[0],before.TransactItems[0]);
 assert.equal(result.input.ClientRequestToken,before.ClientRequestToken);assert.ok(result.input.TransactItems.every(i=>!i.Update));
 const put=result.input.TransactItems[1].Put;assert.deepEqual(decodeGuardItem(put.Item,record.decisionId),{...guard,version:guard.version+1});
 assert.ok(put.ConditionExpression.startsWith(before.TransactItems[1].Update.ConditionExpression));
 assert.equal(put.ExpressionAttributeValues[':oldVersion'].N,String(guard.version));
 assert.equal(put.ExpressionAttributeValues[':incarnation'].S,guard.incarnation);assert.ok(!(':nextVersion' in put.ExpressionAttributeValues));
});
test('synthetic setup refuses any new receipt, foreign room, altered CAS or guard expression',async()=>{
 const {record,table,command}=await nativeDraftCommand();
 for(const mutate of [u=>{u.ExpressionAttributeValues[':nextOrdinary'].N='999';},u=>{u.Key.PK.S='ROOM#foreign';},u=>{u.ConditionExpression='attribute_exists(PK)';},u=>{u.UpdateExpression='SET #version = :nextVersion';},u=>{u.ExpressionAttributeNames['#extra']='payload';}]){
  const copy=new TransactWriteItemsCommand(structuredClone(command.input));mutate(copy.input.TransactItems[1].Update);
  assert.throws(()=>ownedDraftGuardPut(copy,record.decisionId,table));
 }
});

test('synthetic guard adapter cannot write another room state or partition record',async()=>{const {record,table,command}=await nativeDraftCommand();const copy=new TransactWriteItemsCommand(structuredClone(command.input));copy.input.TransactItems[0].Put.Item.PK.S='ROOM#foreign';assert.throws(()=>ownedDraftGuardPut(copy,record.decisionId,table),/OWN_DRAFT_SCOPE_INVALID/);});

import {scopedGetGroups,awsDeniedDetails} from './jobs-owned-proof.mjs';
import {createPartitionedGroupRepository} from '../../packages/adapters/src/partitioned-group-repository.ts';
test('consent scope uses repository bounded single-read fallback and preserves full final fences',async()=>{
 const {data}=await lifecycleFixture();const rows=new Map(data.entries.map(e=>[e.key.PK+'/'+e.key.SK,e.row]));const reads=[];let batchCalls=0;
 const transport={read:async(key,io)=>{assert.ok(io.signal);reads.push(key);return rows.get(key.PK+'/'+key.SK)??null;},readMany:async()=>{batchCalls++;throw new Error('BATCH_DENIED');},commit:async(mutations)=>mutations.every(m=>m.expected===(rows.get(m.key.PK+'/'+m.key.SK)?.revision??0))};
 const selected=scopedGetGroups(transport);assert.ok(!('readMany' in selected));
 const repo=createPartitionedGroupRepository(selected);let accountCount=0;const fence=await repo.fence({accountSubjects:['iris','omar'],groupId:'garden'},snapshot=>{accountCount=snapshot.accounts.length;});
 assert.equal(accountCount,2);assert.equal(batchCalls,0);assert.ok(reads.some(k=>k.PK==='ACCOUNT#iris'));assert.ok(reads.some(k=>k.PK==='GROUP#garden'));
 assert.equal(await selected.commit(fence.mutations),true);
 const row=rows.get('ACCOUNT#iris/STATE');row.revision++;assert.equal(await selected.commit(fence.mutations),false);
});
test('AWS denial metadata retains only fixed action, never role/subject/resource/raw text',()=>{
 const result=awsDeniedDetails({cause:{name:'AccessDeniedException',message:'private-role not authorized to perform: dynamodb:BatchGetItem on private-resource'}});
 assert.deepEqual(result,{deniedAction:'dynamodb:BatchGetItem'});assert.ok(!JSON.stringify(result).includes('private'));
 assert.deepEqual(awsDeniedDetails({name:'AccessDeniedException',message:'private body only'}),{});
});

test('single-read fallback preserves request limits instead of treating many reads as one batch',async()=>{
 const {data}=await lifecycleFixture();const rows=new Map(data.entries.map(e=>[e.key.PK+'/'+e.key.SK,e.row]));let calls=0;
 const groups=scopedGetGroups({read:async key=>{calls++;return rows.get(key.PK+'/'+key.SK)??null;},commit:async()=>true});
 const repo=createPartitionedGroupRepository(groups,{maxRequests:1});await assert.rejects(repo.fence({accountSubjects:['iris','omar'],groupId:'garden'},()=>{}),/PARTITION_REQUEST_LIMIT/);assert.ok(calls<=1);
});

import { exactJobReservation, nativeWorkerRace } from './jobs-owned-proof.mjs';
import { DurableJobError } from '../../packages/adapters/src/durable-model-jobs.ts';
test('exact reservation rejects both under-accounting and an unexpected extra reservation or counter change',()=>{
 const before={runs:65,reservedTokens:100,reservedCostMicros:200,messages:60};const job={reservedTokens:18432,reservedCostMicros:10000};
 const after={...before,reservedTokens:18532,reservedCostMicros:10200};exactJobReservation(before,after,job);
 for(const changed of [{...after,reservedTokens:18531},{...after,reservedTokens:18533},{...after,reservedCostMicros:10201},{...after,runs:66},{...after,messages:61}])
  assert.throws(()=>exactJobReservation(before,changed,job),/PROOF_USAGE_NOT_EXACT/);
});
test('native race launches both deliveries before completion and reconstructs a third terminal worker',async()=>{
 let count=0,release;const gate=new Promise(resolve=>{release=resolve;});
 const result=await nativeWorkerRace(()=>{
  const index=++count;return {process:async()=>{
   if(index===1){await gate;return 'APPLIED';}
   if(index===2){release();throw new DurableJobError('CONFLICT');}
   return 'SKIPPED';
  }};
 },{jobId:'owned-id'});
 assert.equal(count,3);assert.deepEqual(result,{workers:2,outcomes:['APPLIED','CONFLICT'],terminalRestart:'SKIPPED'});
});
test('a foreign race error, no applied result or terminal re-execution never becomes a managed pass',async()=>{
 let count=0;
 await assert.rejects(nativeWorkerRace(()=>({process:async()=>{if(++count===1)return 'APPLIED';throw Error('private error');}}),{}),/PROOF_NATIVE_RACE_FAILED/);
 await assert.rejects(nativeWorkerRace(()=>({process:async()=> 'SKIPPED'}),{}),/PROOF_NATIVE_RACE_NO_RESULT/);
 count=0;
 await assert.rejects(nativeWorkerRace(()=>({process:async()=>++count===1||count===3?'APPLIED':'SKIPPED'}),{}),/PROOF_TERMINAL_REDELIVERY_CHANGED/);
});

import { preCallGuardResult, disabledPolicyPlan } from './jobs-owned-proof.mjs';
import { syntheticProofPolicy } from './lifecycle-owned-behavior.mjs';
test('negative managed proof rejects any dispatch, charge, usage or undrained delivery',()=>{
 const totals={runs:65,reservedTokens:100,reservedCostMicros:200,messages:60};
 const job={phase:'DEAD',reason:'STALE',attempts:0,reservedTokens:0,reservedCostMicros:0,usage:null};
 const empty={active:[],slots:[]};assert.equal(preCallGuardResult(job,totals,totals,empty).totalsUnchanged,true);
 for(const changed of [{...job,phase:'READY'},{...job,reason:'PROVIDER_UNCONFIRMED'},{...job,attempts:1},{...job,reservedTokens:1},{...job,reservedCostMicros:1},{...job,usage:{inputTokens:0,outputTokens:0}}])
  assert.throws(()=>preCallGuardResult(changed,totals,totals,empty),/PROOF_GUARD_DISPATCHED_OR_NOT_DEAD/);
 assert.throws(()=>preCallGuardResult(job,totals,{...totals,reservedTokens:101},empty),/PROOF_GUARD_TOTAL_CHANGED/);
 assert.throws(()=>preCallGuardResult(job,totals,totals,{active:['owned'],slots:[]}),/PROOF_GUARD_OUTBOX_NOT_EMPTY/);
 assert.throws(()=>preCallGuardResult(job,totals,totals,{active:[],slots:[{}]}),/PROOF_GUARD_OUTBOX_NOT_EMPTY/);
});
test('policy cleanup reconciles only its exact saved disable intent without another write',()=>{
 const policy=syntheticProofPolicy(null),prior={PK:{S:'OPERATIONS#RETENTION'},SK:{S:'STATE'},revision:{N:String(policy.revision)},payload:{S:JSON.stringify(policy)}};
 const first=disabledPolicyPlan(prior,prior);assert.equal(first.writeRequired,true);
 assert.equal(JSON.parse(first.item.payload.S).enabled,false);
 assert.equal(JSON.parse(first.item.payload.S).revision,policy.revision+1);
 assert.deepEqual(disabledPolicyPlan(first.item,prior,first.item),{item:first.item,writeRequired:false});
 const foreign={...first.item,payload:{S:JSON.stringify({...JSON.parse(first.item.payload.S),revision:policy.revision+2})}};
 assert.throws(()=>disabledPolicyPlan(foreign,prior,first.item),/PROOF_POLICY_CLEANUP_CONFLICT/);
});

import { ownedRevisionDraft } from './jobs-owned-proof.mjs';
test('new unconfirmed input after confirmation uses current owner/context with an erased prior draft',()=>{
 const owner={draft:null,draftVersion:null,ownerParticipantId:'actual-owner',ownerVersion:2,publicSnapshot:{frame:{decisionId:'actual-decision',semanticVersion:3,contextToken:'c'.repeat(64)}}};
 const draft=ownedRevisionDraft(owner,{nonce},0);
 assert.equal(draft.draftVersion,1);assert.equal(draft.ownerVersion,2);assert.equal(draft.semanticVersion,3);
 assert.equal(draft.ownerParticipantId,'actual-owner');assert.equal(draft.decisionId,'actual-decision');assert.deepEqual(draft.proposedConstraints,[]);
 assert.throws(()=>ownedRevisionDraft({...owner,ownerVersion:-1},{nonce},0));
});
