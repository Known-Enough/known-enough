import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyJobRead, installedJobReadProof } from './jobs-installed-check.mjs';
import { JobSchema } from '../../packages/adapters/src/durable-model-jobs.ts';
import { jobSetupPreparation } from './jobs-setup.mjs';
const source='a'.repeat(40);
const envelope=value=>({revision:{N:String(value.revision)},payload:{S:JSON.stringify(value)}});
test('absent configuration is an explicit missing prerequisite, never permission or activation proof',async()=>{
 const result=await installedJobReadProof(async()=>({}),source);assert.equal(result.result,'JOB_READ_ACCESS_PASS');
 assert.ok(result.checks.every(check=>check.state==='ABSENT'));assert.equal(result.providerCalls,0);assert.equal(result.mutations,0);
});
test('denials and foreign items remain failures without exposing SDK diagnostics or private attributes',async()=>{
 const denied=await installedJobReadProof(async()=>{throw Object.assign(new Error('PRIVATE_EMAIL_TOKEN'),{name:'AccessDeniedException'});},source);
 assert.equal(denied.result,'JOB_READ_ACCESS_INCOMPLETE');assert.ok(denied.checks.every(check=>check.code==='AccessDeniedException'));
 assert.ok(!JSON.stringify(denied).includes('PRIVATE'));
 const foreign=await installedJobReadProof(async()=>({Item:{PK:{S:'PRIVATE_FOREIGN'},SK:{S:'STATE'}}}),source);
 assert.equal(foreign.result,'JOB_READ_ACCESS_INCOMPLETE');assert.ok(!JSON.stringify(foreign).includes('PRIVATE'));
});
test('control inspection exposes bounded counts, source equality and state without job IDs',()=>{
 const control={schemaVersion:1,revision:1,enabled:false,sourceSha:source,active:[],slots:[]};
 assert.deepEqual(classifyJobRead('control',envelope(control),source),{state:'DISABLED',controlSource:source,sourceMatches:true,active:0,slots:0});
 const foreign={...control,sourceSha:'b'.repeat(40)};assert.equal(classifyJobRead('control',envelope(foreign),source).sourceMatches,false);
 assert.equal(classifyJobRead('control',{...envelope(control),revision:{N:'2'}},source).state,'INVALID');
});
test('synthetic versus real retention and disabled state are explicit',()=>{
 const policy={schemaVersion:1,kind:'RETENTION_POLICY',revision:1,enabled:false,dataClass:'SYNTHETIC',rawConversationMs:0,structuredMs:86400000,
 replayMs:3600000,journalMs:604800000,backupMs:null,providerMs:null,realPersonPolicy:'UNAPPROVED'};
 assert.deepEqual(classifyJobRead('retention',envelope(policy),source),{state:'DISABLED',dataClass:'SYNTHETIC'});
 assert.equal(classifyJobRead('retention',envelope({...policy,enabled:true,dataClass:'REAL',realPersonPolicy:'APPROVED'}),source).dataClass,'REAL');
});
test('existing cumulative totals are inspected unchanged; malformed or absent totals are not initialized',()=>{
 const total={runs:3,reservedTokens:400,reservedCostMicros:900,messages:4};const before=JSON.stringify(total);
 assert.deepEqual(classifyJobRead('totals',{version:{N:'7'},payload:{S:JSON.stringify(total)}},source),{state:'PRESENT_VALID',...total});
 assert.equal(JSON.stringify(total),before);assert.equal(classifyJobRead('totals',null,source).state,'ABSENT');
 assert.equal(classifyJobRead('totals',{version:{N:'0'},payload:{S:JSON.stringify(total)}},source).state,'INVALID');
 assert.equal(jobSetupPreparation().accounting.inheritedTotal,'PRESERVE_EXACT_EXISTING_TOTAL_NO_SEED_RESET_OR_REFUND');
});

test('active queue census reveals pre-call and uncertain slots without identity or raw errors, never writes',async()=>{
 const {installedJobQueueProof}=await import('./jobs-installed-check.mjs');
 const id='12345678-1234-4234-8234-123456789abc';const control={schemaVersion:1,revision:1,enabled:true,sourceSha:source,active:[id],slots:[{jobId:id,token:id,until:50}]};
 const job={schemaVersion:1,revision:1,reference:{jobId:id,kind:'ARCHITECT',subject:'PRIVATE_IDENTITY',decisionId:'PRIVATE_GROUP',reasoningJobId:'private-draft',authorityHash:'b'.repeat(64),sourceSha:source,expiresAt:50,requestKey:'private-key'},phase:'DEAD',reason:'PROVIDER_UNCONFIRMED',lease:null,attempts:1,failures:0,availableAt:0,reservedTokens:18432,reservedCostMicros:10000,usage:null,recoveryProofHash:null};
 const send=async command=>{assert.equal(command.constructor.name,'GetItemCommand');const PK=command.input.Key.PK.S;return {Item:{PK:{S:PK},SK:{S:'STATE'},...envelope(PK==='OPERATIONS#MODEL_JOBS'?control:JobSchema.parse(job))}};};
 const result=await installedJobQueueProof(send,100);assert.equal(result.result,'JOB_QUEUE_READ_PASS');assert.equal(result.slotsExpired,1);assert.equal(result.jobs[0].reason,'PROVIDER_UNCONFIRMED');assert.equal(result.requests,3);assert.equal(result.mutations,0);assert.ok(!JSON.stringify(result).match(/PRIVATE|private|12345678/));
 const denied=await installedJobQueueProof(async()=>{throw Object.assign(Error('PRIVATE_TOKEN'),{name:'AccessDeniedException'});},100);assert.equal(denied.code,'AccessDeniedException');assert.ok(!JSON.stringify(denied).includes('PRIVATE'));
 let calls=0;const changed=await installedJobQueueProof(async command=>{const value=await send(command);if(++calls===3)value.Item.revision.N='2';return value;},100);assert.equal(changed.code,'QUEUE_CHANGED');
});
