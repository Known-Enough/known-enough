import { expect,it } from 'vitest';
import { createDraftRequestRecovery } from './partition-draft-recovery.ts';
import { stableDeliveryId } from './durable-enqueue.ts';
import { publicDraftId } from './partition-draft-runtime.ts';
import type { DurableJobStore,JobSnapshot,PublicDraftFence,PublicDraftEffect } from '@deal-table/adapters/durable-model-runtime';
const source='a'.repeat(40),now=1000;
function fixture(options:{calling?:boolean;loseAck?:boolean;race?:boolean}={}) {
 const reference={jobId:stableDeliveryId(source,'garden',publicDraftId('garden','iris','nonce')),kind:'ARCHITECT' as const,subject:'iris',decisionId:'garden',reasoningJobId:publicDraftId('garden','iris','nonce'),sourceSha:source,authorityHash:'b'.repeat(64),expiresAt:now+300000,requestKey:'nonce'};
 let state:JobSnapshot={control:{schemaVersion:1,revision:1,enabled:true,sourceSha:source,active:[],slots:[]},totals:{runs:65,messages:60,reservedTokens:100,reservedCostMicros:200},job:null};let writes=0;let checks=0;
 if(options.calling){state.control.active=[reference.jobId];state.control.slots=[{jobId:reference.jobId,token:'12345678-1234-4234-8234-123456789abc',until:2000}];state.job={schemaVersion:1,revision:1,reference,phase:'CALLING',reason:null,lease:{token:'12345678-1234-4234-8234-123456789abc',until:2000},attempts:1,failures:0,availableAt:now,reservedTokens:18432,reservedCostMicros:10000,usage:null,recoveryProofHash:null};}
 const store:DurableJobStore<PublicDraftFence,PublicDraftEffect>={read:async()=>structuredClone(state),deliveries:async()=>state.control.active.map(jobId=>({jobId})),commit:async(prior,next)=>{writes++;if(options.race)return false;expect(JSON.stringify(prior)).toBe(JSON.stringify(state));state=structuredClone(next);if(options.loseAck)throw new Error('lost ack');return true;}};
 const recovery=createDraftRequestRecovery({sourceSha:source,now:()=>now,store:()=>store,releaseStore:()=>store});
 const request={principal:{kind:'participant' as const,subject:'iris'},groupId:'garden',key:'nonce',io:{signal:new AbortController().signal,request:()=>{}},inspect:async()=>({saved:null,fence:{mutations:[],assertCurrent:async()=>{checks++;}}})};
 return {recovery,request,state:()=>state,writes:()=>writes,checks:()=>checks};
}
it('readonly outcome lookup never dispatches or mutates; safe release creates a durable same-key cancellation tombstone and preserves totals',async()=>{
 const f=fixture({loseAck:true});expect(await f.recovery(f.request)).toEqual({draftRequest:{state:'NOT_SUBMITTED',canRelease:true,revision:0}});expect(f.writes()).toBe(0);expect(f.checks()).toBe(1);
 expect((await f.recovery({...f.request,releaseRevision:0})).draftRequest?.state).toBe('CANCELLED');expect(f.writes()).toBe(1);expect(f.state().job?.reason).toBe('CANCELLED');expect(f.state().totals).toEqual({runs:65,messages:60,reservedTokens:100,reservedCostMicros:200});
});
it('calling/unknown outcomes cannot be released and a racing release never causes a repeated write',async()=>{
 const calling=fixture({calling:true});expect((await calling.recovery(calling.request)).draftRequest?.canRelease).toBe(false);
 await expect(calling.recovery({...calling.request,releaseRevision:1})).rejects.toHaveProperty('category','REQUEST_UNKNOWN');expect(calling.writes()).toBe(0);
 const racing=fixture({race:true});await expect(racing.recovery({...racing.request,releaseRevision:0})).rejects.toHaveProperty('category','REQUEST_UNKNOWN');expect(racing.writes()).toBe(1);
});
it('foreign principals and changed revisions cannot cancel another request',async()=>{
 const f=fixture({calling:true});await expect(f.recovery({...f.request,principal:{kind:'display',subject:'iris',roomId:'garden'}})).rejects.toThrow('FORBIDDEN');expect(f.writes()).toBe(0);
 await expect(f.recovery({...f.request,releaseRevision:0})).rejects.toThrow('STALE_CONTEXT');expect(f.writes()).toBe(0);
});
