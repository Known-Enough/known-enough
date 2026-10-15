import type { ConverseTransport } from '@deal-table/adapters';
import { expect,it,vi } from 'vitest';
import { createPartitionDraftRuntime } from './partition-draft-runtime.ts';
import { publicDraftFixture } from '../../../packages/adapters/src/test-support/public-draft-fixture.ts';
import { JOB_TARGET,type JobSnapshot,type PublicDraftCommit,type PublicDraftFence,type PublicDraftEffect,type DurableJobStore } from '@deal-table/adapters/durable-model-runtime';
import type { PublicDraftAtomicItem,PartitionMutation } from '@deal-table/adapters/partition-request';
const source='a'.repeat(40);
function fixture(options:{disabled?:boolean;invalid?:boolean;revoke?:boolean;loseAck?:boolean;reject?:string;occupied?:boolean;delay?:number;fenceFailAt?:number}={}) {
 const native=publicDraftFixture();let calls=0;let lost=false;
 let state:JobSnapshot={job:null,control:{schemaVersion:1,revision:1,enabled:!options.disabled,sourceSha:source,active:[],slots:[]},totals:{runs:65,reservedTokens:1234,reservedCostMicros:5678,messages:60}};
 if(options.occupied)state.control.slots=Array.from({length:2},(_,i)=>({jobId:i?'12345678-1234-4234-8234-123456789abc':'22345678-1234-4234-8234-123456789abc',token:'32345678-1234-4234-8234-123456789abc',until:Date.now()-100}));
 const pending=new WeakMap<PublicDraftAtomicItem[],PartitionMutation[]>();
 const transport:ConverseTransport={send:async(command:unknown)=>{calls++;if(options.revoke)native.disable();
  if(options.delay)await new Promise(resolve=>setTimeout(resolve,options.delay));
  if(options.reject)throw Object.assign(new Error('PRIVATE_PROVIDER_TEXT'),{name:options.reject});
  expect(JSON.stringify(command)).not.toContain('emailHash');
  return {stopReason:'tool_use',output:{message:{role:'assistant',content:[{toolUse:{toolUseId:'mock-tool',name:'ke_architect_output',input:options.invalid?{unknown:'PRIVATE_MODEL_CANARY'}:{title:'Workday',description:'A public choice',variables:[{id:'activity',type:'ENUM',label:'Activity',required:true,visibility:'PUBLIC',ownerParticipantId:null,options:[{id:'planting',label:'Planting'},{id:'watering',label:'Watering'}]}],rules:[],clarificationQuestions:[],participantInformationRequirements:[]}}}]}},usage:{inputTokens:20,outputTokens:30,totalTokens:50},metrics:{latencyMs:1},$metadata:{}};
 }};
 const createStore=(commit:PublicDraftCommit):DurableJobStore<PublicDraftFence,PublicDraftEffect>=>({
  read:async()=>structuredClone(state),deliveries:async()=>state.control.active.map(jobId=>({jobId})),
  commit:async(prior,next,fence,effect)=>{
   if(JSON.stringify(prior)!==JSON.stringify(state))return false;
   if(fence){const prepared=await commit(fence,effect);const mutations=pending.get(prepared.items);if(!mutations||!await native.commit(mutations))return false;}
   state=structuredClone(next);if(options.loseAck&&!lost&&next.job?.phase==='SUCCEEDED'){lost=true;throw new Error('lost ack');}return true;
  },
 });
 const diagnostics:unknown[]=[];let fences=0;
 const port=createPartitionDraftRuntime({sourceSha:source,transport,store:createStore,diagnostic:value=>diagnostics.push(value),
  prepareGroupCommit:async mutations=>{const items:PublicDraftAtomicItem[]=[];pending.set(items,mutations);return items;},
  authority:async()=>({table:JOB_TARGET.budget,key:{PK:'AUTH',SK:'STATE'},attribute:'version',revision:1,payload:'{}'}),
 });
 return {native,session:native.session((subject,request,io,scope)=>port(subject,request,io,scope&&options.fenceFailAt?{...scope,fence:output=>{if(++fences===options.fenceFailAt)throw new Error('PRIVATE_SCOPE_CANARY');return scope.fence(output);}}:scope)),diagnostics,calls:()=>calls,state:()=>structuredClone(state)};
}
it('real forced-tool architect composition joins the validated native draft and durable result, replays after a lost acknowledgement without another call',async()=>{
 const f=fixture({loseAck:true});const principal={kind:'participant' as const,subject:'iris'},body={objective:'Pick a garden activity',idempotencyKey:'same-request'};
 const first=await f.session.generateDraft(principal,'garden',body);expect(first.frame.variables).toHaveLength(1);
 expect(f.state().job?.phase).toBe('SUCCEEDED');expect(f.state().job?.usage).toEqual({inputTokens:20,outputTokens:30});
 expect(f.state().totals).toEqual({runs:65,messages:60,reservedTokens:1234+18432,reservedCostMicros:5678+10000});
 expect(JSON.stringify(f.state())).not.toContain('Pick a garden activity');
 const again=await f.session.generateDraft(principal,'garden',body);expect(again).toEqual(first);expect(f.calls()).toBe(1);
});
it('unavailable control and non-organizer access have no provider or usage effects',async()=>{
 const disabled=fixture({disabled:true});await expect(disabled.session.generateDraft({kind:'participant',subject:'iris'},'garden',{objective:'Pick activity',idempotencyKey:'one'})).rejects.toHaveProperty('category','AI_UNAVAILABLE');expect(disabled.calls()).toBe(0);expect(disabled.state().totals.reservedTokens).toBe(1234);
 const other=fixture();await expect(other.session.generateDraft({kind:'participant',subject:'omar'},'garden',{objective:'Pick activity',idempotencyKey:'one'})).rejects.toThrow('FORBIDDEN');expect(other.calls()).toBe(0);
});
it('invalid acknowledged model data never becomes a saved/public draft or a free replay',async()=>{
 const f=fixture({invalid:true}),body={objective:'Pick activity',idempotencyKey:'bad'};await expect(f.session.generateDraft({kind:'participant',subject:'iris'},'garden',body)).rejects.toHaveProperty('category','INVALID_MODEL_OUTPUT');
 expect(f.state().job?.reason).toBe('INVALID_OUTPUT');expect(f.state().job?.usage).toEqual({inputTokens:20,outputTokens:30});
 await expect(f.session.generateDraft({kind:'participant',subject:'iris'},'garden',body)).rejects.toHaveProperty('category','INVALID_MODEL_OUTPUT');expect(f.calls()).toBe(1);expect(JSON.stringify(f.state())).not.toContain('PRIVATE_MODEL_CANARY');
});
it('admission revoked during the provider call cannot publish a draft and leaves reservations charged',async()=>{
 const f=fixture({revoke:true});await expect(f.session.generateDraft({kind:'participant',subject:'iris'},'garden',{objective:'Pick activity',idempotencyKey:'revoked'})).rejects.toThrow();
 expect(f.state().job?.phase).toBe('DEAD');expect(f.state().totals.reservedTokens).toBe(1234+18432);expect(f.calls()).toBe(1);
 expect([...f.native.rows.values()].filter(row=>row.kind==='DRAFT')).toHaveLength(0);
});

it('acknowledged provider rejection ends the public attempt without quarantining a slot; transport uncertainty remains protected',async()=>{
 for(const name of ['AccessDeniedException','ValidationException','ThrottlingException']){
  const f=fixture({reject:name});await expect(f.session.generateDraft({kind:'participant',subject:'iris'},'garden',{objective:'Pick activity',idempotencyKey:'ack'})).rejects.toHaveProperty('category','PROVIDER_FAILED');
  expect(f.state().job).toMatchObject({phase:'DEAD',reason:'STALE',attempts:1});expect(f.state().control.slots).toHaveLength(0);expect(f.state().totals.reservedTokens).toBe(1234+18432);
 }
 const unknown=fixture({reject:'TimeoutError'});await expect(unknown.session.generateDraft({kind:'participant',subject:'iris'},'garden',{objective:'Pick activity',idempotencyKey:'unknown'})).rejects.toHaveProperty('category','PROVIDER_FAILED');
 expect(unknown.state().job?.reason).toBe('PROVIDER_UNCONFIRMED');expect(unknown.state().control.slots).toHaveLength(1);
});
it('occupied global slots reject before enqueueing an abandoned public request or reserving usage',async()=>{
 const f=fixture({occupied:true});await expect(f.session.generateDraft({kind:'participant',subject:'iris'},'garden',{objective:'Pick activity',idempotencyKey:'capacity'})).rejects.toHaveProperty('category','AI_AT_CAPACITY');expect(f.state().job).toBeNull();expect(f.calls()).toBe(0);expect(f.state().totals.reservedTokens).toBe(1234);
});
it('a public response after the former eight-second cutoff can still commit within its bounded lease',async()=>{
 vi.useFakeTimers();try{
  const f=fixture({delay:9000});const work=f.session.generateDraft({kind:'participant',subject:'iris'},'garden',{objective:'Pick activity',idempotencyKey:'slow'});
  await vi.advanceTimersByTimeAsync(9100);expect((await work).frame.variables).toHaveLength(1);expect(f.state().job?.phase).toBe('SUCCEEDED');expect(f.calls()).toBe(1);
 }finally{vi.useRealTimers();}
});

it('a definitive failure before transport dispatch does not quarantine an uncalled provider and logs only safe flags',async()=>{
 const f=fixture({fenceFailAt:4});await expect(f.session.generateDraft({kind:'participant',subject:'iris'},'garden',{objective:'Pick activity',idempotencyKey:'before-provider'})).rejects.toHaveProperty('category','AI_UNAVAILABLE');expect(f.calls()).toBe(0);expect(f.state().job?.phase).toBe('DEAD');expect(f.state().job?.reason).toBe('STALE');expect(f.state().control.slots).toHaveLength(0);expect(JSON.stringify(f.diagnostics)).not.toContain('PRIVATE');expect(f.diagnostics).toEqual([{providerDispatched:false,providerAcknowledged:false,phase:'DEAD',reason:'STALE',rejectionStage:'ARCHITECT_CALL'}]);
});
