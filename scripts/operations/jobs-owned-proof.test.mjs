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
