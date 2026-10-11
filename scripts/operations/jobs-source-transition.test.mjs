import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionDisabledJobSource } from './jobs-source-transition.mjs';
const auth={mode:'standing',approved:true,maxAttemptsPerRun:2,maxTokensPerRun:50000,maxCostMicrosPerRun:20000,attemptCostMicros:10000,maxSignupMessagesPerRun:2,retentionReviewed:true,invocationLoggingDisabled:true};
function fixture(controlPatch={},lostAck=false) {
  const control={schemaVersion:1,revision:1,enabled:false,sourceSha:'a'.repeat(40),active:[],slots:[],...controlPatch};
  const envelope=(PK,field,value,n=1)=>({PK:{S:PK},SK:{S:'STATE'},[field]:{N:String(n)},payload:{S:JSON.stringify(value)}});
  const items=new Map([['OPERATIONS#MODEL_JOBS',envelope('OPERATIONS#MODEL_JOBS','revision',control)],
    ['AUTH',envelope('AUTH','version',auth)],['TOTAL',envelope('TOTAL','version',{runs:63,reservedTokens:500,reservedCostMicros:700,messages:4})]]);
  const writes=[];
  const send=async command=>{
    if(command.input.TransactItems){writes.push(command.input);items.set('OPERATIONS#MODEL_JOBS',structuredClone(command.input.TransactItems[0].Put.Item));if(lostAck)throw Error('lost');return {};}
    return {Item:structuredClone(items.get(command.input.Key.PK.S))};
  };
  return {items,writes,send};
}
test('disabled empty source transition is guarded and leaves existing cumulative totals untouched',async()=>{
  const f=fixture();const before=structuredClone(f.items.get('TOTAL'));const report=await transitionDisabledJobSource(f.send,'a'.repeat(40),'b'.repeat(40));
  assert.equal(report.state,'DISABLED');assert.equal(report.totalWrites,0);assert.deepEqual(f.items.get('TOTAL'),before);
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].TransactItems[0].Put.ConditionExpression,'#r = :r AND #p = :p');
  assert.equal(f.writes[0].TransactItems[1].ConditionCheck.Key.PK.S,'AUTH');
});
test('active enabled or foreign source cannot be overwritten',async()=>{
  for(const patch of [{enabled:true},{active:['12345678-1234-4234-9234-123456789012']},{sourceSha:'c'.repeat(40)}]){
    const f=fixture(patch);await assert.rejects(transitionDisabledJobSource(f.send,'a'.repeat(40),'b'.repeat(40)));assert.equal(f.writes.length,0);
  }
});
test('lost acknowledgement reconciles once; already matching source performs no write',async()=>{
  const f=fixture({},true);assert.equal((await transitionDisabledJobSource(f.send,'a'.repeat(40),'b'.repeat(40))).result,'JOB_SOURCE_DISABLED_READBACK_PASS');
  assert.equal((await transitionDisabledJobSource(f.send,'a'.repeat(40),'b'.repeat(40))).result,'JOB_SOURCE_ALREADY_MATCHES');assert.equal(f.writes.length,1);
});
test('an unapplied transaction is not retried or reported as verified',async()=>{
  const f=fixture();let attempts=0;
  const send=async command=>{if(command.input.TransactItems){attempts++;throw Error('unknown acknowledgement');}return f.send(command);};
  await assert.rejects(transitionDisabledJobSource(send,'a'.repeat(40),'b'.repeat(40)),/JOB_SOURCE_CHANGE_UNCONFIRMED/);
  assert.equal(attempts,1);assert.equal(f.writes.length,0);
});
test('malformed cumulative totals block before any source change',async()=>{
  const f=fixture();f.items.get('TOTAL').payload.S='{}';
  await assert.rejects(transitionDisabledJobSource(f.send,'a'.repeat(40),'b'.repeat(40)));
  assert.equal(f.writes.length,0);
});
