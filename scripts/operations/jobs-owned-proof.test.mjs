import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedPublicDraft, enqueueRequest, proofReport } from './jobs-owned-proof.mjs';
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
