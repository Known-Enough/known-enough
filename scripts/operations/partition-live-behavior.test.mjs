import test from 'node:test';
import assert from 'node:assert/strict';
import { ownFixture,behaviorReport,jsonResponse,callbackCode,visibleGroup,largeOwnedDrafts } from './partition-live-behavior.mjs';
const runId='12345678-1234-1234-1234-123456789abc';
const fixture={runId,nonce:runId,subject:null,password:'PRIVATE_PASSWORD_CANARY'.repeat(2),mailbox:{address:'keqa-owned@example.invalid',token:'PRIVATE_MAIL_TOKEN'}};
test('a fixture cannot become owned through a supplied foreign run, subject, mailbox or malformed private record',()=>{
 assert.equal(ownFixture(fixture,runId),fixture);
 for(const changes of [{runId:'OTHER'},{nonce:'OTHER'},{subject:'OTHER'},{password:'SHORT'},{mailbox:{address:'real-person@example.invalid'}}])assert.throws(()=>ownFixture({...fixture,...changes},runId));
});
test('public behavior reports expose only finite counters, never fixture subjects, emails, passwords, tokens or group recovery',()=>{
 const report=behaviorReport({fixtures:[fixture],signup:1,accessToken:'PRIVATE_ACCESS_TOKEN',subject:'PRIVATE_SUBJECT',groupId:'PRIVATE_GROUP'},'fixtures','LIVE_FIXTURES_PASS');
 assert.equal(report.identities,1);assert.equal(report.modelCalls,0);assert.equal(report.signup,1);assert.ok(!/PRIVATE|example.invalid|"mailbox":|"subject":|"accessToken":|"groupId":/.test(JSON.stringify(report)));
});

test('malformed counters or caller strings cannot turn the finite report into a private payload',()=>{
 const result=behaviorReport({signup:'PRIVATE_EMAIL',archived:{secret:'PRIVATE_TOKEN'},apiChecks:-1},'PRIVATE_PHASE','PRIVATE_RESULT');
 assert.equal(result.signup,0);assert.equal(result.archived,0);assert.equal(result.apiChecks,0);assert.equal(result.phase,'UNKNOWN');assert.equal(result.result,'NOT_VERIFIED');assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('successful empty Cognito acknowledgements parse without inventing data; excessive provider bodies remain bounded',async()=>{
 assert.deepEqual(await jsonResponse(new globalThis.Response(null,{status:200})),{});
 assert.deepEqual(await jsonResponse(new globalThis.Response('{"owned":true}',{status:200})),{owned:true});
 await assert.rejects(jsonResponse(new globalThis.Response('x'.repeat(100001),{status:200})),/RESPONSE_LIMIT/);
});

// The navigation URL is available before a route callback necessarily completes.
test('PKCE code comes from the actual matching callback URL, independent of route timing',()=>{
 assert.equal(callbackCode('https://example.invalid/?code=owned-code&state=owned-state','https://example.invalid','owned-state'),'owned-code');
 for(const url of ['https://other.invalid/?code=owned-code&state=owned-state','https://example.invalid/?code=owned-code&state=foreign-state','https://example.invalid/?error=invalid_scope&state=owned-state'])assert.throws(()=>callbackCode(url,'https://example.invalid','owned-state'),/PKCE_CALLBACK_INVALID/);
});

test('installed group-list checks require actual membership and reject stranger, removal or archived visibility',()=>{
 const group={id:'owned-group',name:'Owned',version:1,isOrganizer:true,members:[{id:'member',displayName:'Owned',isOrganizer:true}],drafts:[],pendingInvitations:0,decisions:[]};
 assert.equal(visibleGroup({groups:[group]},group.id,1).id,group.id);
 assert.equal(visibleGroup({groups:[]},group.id,null),null);
 assert.throws(()=>visibleGroup({groups:[group]},group.id,null),/LIVE_GROUP_VISIBILITY_LEAK/);
 assert.throws(()=>visibleGroup({groups:[]},group.id,1),/LIVE_GROUP_MEMBERSHIP_CHANGED/);
 assert.throws(()=>visibleGroup({groups:[group]},group.id,2),/LIVE_GROUP_MEMBERSHIP_CHANGED/);
});

test('large owned storage fixture exceeds the old aggregate ceiling while each child remains bounded',()=>{
 const drafts=largeOwnedDrafts(4);assert.equal(drafts.length,32);assert.ok(Buffer.byteLength(JSON.stringify(drafts))>300000);
 assert.ok(drafts.every(draft=>Buffer.byteLength(JSON.stringify(draft))<352*1024&&draft.groupVersion===4&&draft.createdDecisionId===null));
});

import { fixtureFailureCode } from './partition-live-behavior.mjs';
test('fixture failures retain bounded mail-service codes without leaking arbitrary exception messages',()=>{
 assert.equal(fixtureFailureCode(new Error('MAILTM_REQUEST_FAILED')),'MAILTM_REQUEST_FAILED');
 assert.equal(fixtureFailureCode(new Error('MAILTM_NO_PUBLIC_DOMAIN')),'MAILTM_NO_PUBLIC_DOMAIN');
 assert.equal(fixtureFailureCode(new Error('MAILTM_REQUEST_FAILED_PRIVATE_MARKER')),'UNCLASSIFIED');
 assert.equal(fixtureFailureCode({safeCode:'COGNITO_SignUp_TooManyRequestsException',message:'private-marker'}),'COGNITO_SignUp_TooManyRequestsException');
 assert.equal(fixtureFailureCode(new Error('private-marker')),'UNCLASSIFIED');
});

import {createOwnedMailbox,mailFailureMetadata} from './partition-live-behavior.mjs';
function pendingMailbox(){return {...fixture,mailbox:{runId,address:'keqa-owned@example.invalid',password:'PRIVATE_MAIL_PASSWORD'}};}
test('creation intent and acknowledged identity persist before a failed token, without signup',async()=>{
 const value=pendingMailbox(),events=[];const mail={create:async(m,observe)=>{events.push('create');await observe({...m,id:'owned-id'});events.push('token');throw new Error('MAILTM_REQUEST_FAILED');}};
 await assert.rejects(createOwnedMailbox(value,runId,mail,async()=>events.push(value.mailbox.id?'saved-id':'saved-intent')),/MAILTM_REQUEST_FAILED/);
 assert.deepEqual(events,['saved-intent','create','saved-id','token']);assert.equal(value.mailbox.id,'owned-id');assert.equal(value.mailboxCreateAck,true);assert.ok(!value.signupIntent);
 await assert.rejects(createOwnedMailbox(value,runId,mail,async()=>{}),/MAILBOX_CREATION_ALREADY_ATTEMPTED/);
});
test('failed intent checkpoint prevents account creation; invalid acknowledgment is not persisted',async()=>{
 const value=pendingMailbox();let calls=0;await assert.rejects(createOwnedMailbox(value,runId,{create:async()=>calls++},async()=>{throw new Error('SAVE_FAILED');}),/SAVE_FAILED/);assert.equal(calls,0);
 const other=pendingMailbox();await assert.rejects(createOwnedMailbox(other,runId,{create:async(m,observe)=>observe({...m,address:'foreign@example.invalid',id:'foreign'})},async()=>{}),/MAILBOX_CREATION_ACK_INVALID/);assert.ok(!other.mailbox.id);
});
test('a provider failure before acknowledgment stays an unresolved intent',async()=>{
 const value=pendingMailbox();await assert.rejects(createOwnedMailbox(value,runId,{create:async()=>{throw new Error('MAILTM_REQUEST_FAILED');}},async()=>{}));assert.equal(value.mailboxCreateIntent,true);assert.ok(!value.mailboxCreateAck);assert.ok(!value.mailbox.id);
});
test('finite mail failure metadata never contains a path, address or provider text',()=>{
 assert.deepEqual(mailFailureMetadata({mailOperation:'TOKEN',httpStatus:401,message:'PRIVATE_TOKEN'}),{mailOperation:'TOKEN',httpStatus:401});
 assert.deepEqual(mailFailureMetadata({mailOperation:'https://private.example',httpStatus:401}),{});
 assert.deepEqual(mailFailureMetadata({mailOperation:'TOKEN',httpStatus:'PRIVATE_STATUS'}),{mailOperation:'TOKEN'});
});

import { recoverableConfirmedTriggerFailure } from './partition-live-behavior.mjs';
test('FIX01 recovery is explicit and only a post-confirmation Lambda failure, never an email/auth bypass',()=>{
 assert.equal(recoverableConfirmedTriggerFailure({safeCode:'COGNITO_ConfirmSignUp_InvalidLambdaResponseException'},'true'),true);
 for(const code of ['COGNITO_ConfirmSignUp_CodeMismatchException','COGNITO_ConfirmSignUp_NotAuthorizedException','COGNITO_ConfirmSignUp_UNCLASSIFIED','COGNITO_SignUp_UnexpectedLambdaException']) assert.equal(recoverableConfirmedTriggerFailure({safeCode:code},'true'),false);
 assert.equal(recoverableConfirmedTriggerFailure({safeCode:'COGNITO_ConfirmSignUp_InvalidLambdaResponseException'},undefined),false);
});
