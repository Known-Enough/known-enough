import test from 'node:test';
import assert from 'node:assert/strict';
import { ownFixture,behaviorReport,jsonResponse,callbackCode } from './partition-live-behavior.mjs';
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
