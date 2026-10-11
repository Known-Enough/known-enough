import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeDisabledControl } from './jobs-control.mjs';
const source='a'.repeat(40);
const auth={mode:'standing',approved:true,maxAttemptsPerRun:2,maxTokensPerRun:50000,maxCostMicrosPerRun:20000,attemptCostMicros:10000,maxSignupMessagesPerRun:2,retentionReviewed:true,invocationLoggingDisabled:true};
const wire=(PK,value,kind='version')=>({PK:{S:PK},SK:{S:'STATE'},[kind]:{N:String(value.revision??3)},payload:{S:JSON.stringify(value)}});
function fixture(options={}){
 const cells=new Map([['AUTH',wire('AUTH',auth)],['TOTAL',wire('TOTAL',{runs:63,reservedTokens:16024361,reservedCostMicros:16024361,messages:58})]]);
 if(options.control)cells.set('OPERATIONS#MODEL_JOBS',wire('OPERATIONS#MODEL_JOBS',options.control,'revision'));
 const writes=[];const send=async command=>{
  if(command.constructor.name==='GetItemCommand')return {Item:cells.get(command.input.Key.PK.S)};
  assert.equal(command.constructor.name,'TransactWriteItemsCommand');assert.equal(command.input.TransactItems.length,1);
  const put=command.input.TransactItems[0].Put;assert.equal(put.TableName,'KnownEnoughOperationsJournal');assert.equal(put.ConditionExpression,'attribute_not_exists(PK)');
  assert.equal(put.Item.PK.S,'OPERATIONS#MODEL_JOBS');assert.equal(JSON.parse(put.Item.payload.S).enabled,false);writes.push(put);
  if(!options.uncertainAbsent)cells.set(put.Item.PK.S,structuredClone(put.Item));
  if(options.lostAck||options.uncertainAbsent)throw Error('PRIVATE_PROVIDER_DIAGNOSTIC');return {};
 };return {cells,writes,send};
}
test('only an absent empty disabled control is initialized; existing totals remain byte-identical',async()=>{
 const f=fixture();const before=JSON.stringify(f.cells.get('TOTAL'));const result=await initializeDisabledControl(f.send,source);
 assert.equal(result.result,'JOB_CONTROL_DISABLED_READBACK_PASS');assert.equal(result.writeAcknowledged,true);assert.equal(result.state,'DISABLED');
 assert.equal(JSON.stringify(f.cells.get('TOTAL')),before);assert.equal(result.totalWrites,0);assert.equal(f.writes.length,1);
 await initializeDisabledControl(f.send,source);assert.equal(f.writes.length,1);
});
test('lost acknowledgement reconciles exact durable bytes without a second write; unresolved absence remains unknown',async()=>{
 const f=fixture({lostAck:true});const result=await initializeDisabledControl(f.send,source);
 assert.equal(result.writeAcknowledged,false);assert.equal(result.result,'JOB_CONTROL_DISABLED_READBACK_PASS');assert.equal(f.writes.length,1);
 const unknown=fixture({uncertainAbsent:true});await assert.rejects(initializeDisabledControl(unknown.send,source),/JOB_CONTROL_WRITE_UNKNOWN/);assert.equal(unknown.writes.length,1);
});
test('existing active or foreign-source control is never disabled, cleared or re-pinned',async()=>{
 const control={schemaVersion:1,revision:4,enabled:true,sourceSha:'b'.repeat(40),active:['12345678-1234-4234-9234-123456789abc'],slots:[]};
 const f=fixture({control});const before=JSON.stringify(f.cells.get('OPERATIONS#MODEL_JOBS'));const result=await initializeDisabledControl(f.send,source);
 assert.equal(result.result,'JOB_CONTROL_PRESENT_UNCHANGED');assert.equal(result.sourceMatches,false);assert.equal(result.active,1);assert.equal(f.writes.length,0);
 assert.equal(JSON.stringify(f.cells.get('OPERATIONS#MODEL_JOBS')),before);
});
test('missing/corrupt totals or legacy authority cannot trigger a seed or control mutation',async()=>{
 for(const mutate of [f=>f.cells.delete('TOTAL'),f=>f.cells.set('TOTAL',wire('TOTAL',{private:'CANARY'})),f=>f.cells.set('AUTH',wire('AUTH',{approved:true})),f=>{f.cells.get('TOTAL').version.N='0';}]){
  const f=fixture();mutate(f);await assert.rejects(initializeDisabledControl(f.send,source));assert.equal(f.writes.length,0);
 }
});
