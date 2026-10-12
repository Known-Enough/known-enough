import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { ControlSchema, JobSchema, TotalsSchema, DurableModelJobs } from '../../packages/adapters/src/durable-model-jobs.ts';
import { createDynamoModelJobStore } from '../../packages/adapters/src/dynamo-model-jobs.ts';
import { verifySource } from './verify.mjs';
const account='092954139775', table='KnownEnoughOperationsJournal', budget='KnownEnoughQaControl';
const execute=promisify(execFile), key=PK=>({PK:{S:PK},SK:{S:'STATE'}});
const fail=code=>{throw Object.assign(new Error(code),{safeCode:code});};
export function checkedDrain(control,job,proof,expected) {
 if(control.enabled||control.sourceSha!==expected.packageSource||control.slots.length||control.active.length!==1||control.active[0]!==job.reference.jobId)return fail('DRAIN_CONTROL_NOT_EXACT_DISABLED');
 if(job.phase!=='READY'||job.attempts!==0||job.reservedTokens!==0||job.reservedCostMicros!==0||job.usage!==null||job.lease!==null)return fail('DRAIN_PAID_OR_LEASED_JOB_PRESERVED');
 if(proof.sourceSha!==expected.ownedSource||proof.packageSource!==expected.packageSource||proof.jobId!==job.reference.jobId||proof.decisionId!==job.reference.decisionId
  ||proof.signedFrameConfirmations!==2||proof.signedPrivateConfirmations!==2||proof.duplicateReceipts!==2||job.reference.sourceSha!==expected.packageSource)return fail('DRAIN_OWNED_PROOF_MISMATCH');
 return {jobId:job.reference.jobId};
}
export function proofKeys(contents) {
 return contents.filter(item=>/^ops01-owned\/[a-f0-9-]{36}\/ops03-proof-private\.json$/.test(item.Key??'')
  &&!item.Key.startsWith('ops01-owned/1ea949f1-4fc2-4bc5-981c-371819e8d57b/'))
  .sort((a,b)=>String(b.LastModified).localeCompare(String(a.LastModified))).slice(0,8).map(item=>item.Key);
}
export function precallOnlyWorker(state, expected, native) {
 const {ownedSource,packageSource}=expected;
  const store={async read(id){const value=await native.read(id);checkedDrain(value.control,value.job,state.proof,{ownedSource,packageSource});return value;},
   async commit(prior,next){checkedDrain(prior.control,prior.job,state.proof,{ownedSource,packageSource});
    if(next.control.enabled||next.control.active.length||next.control.slots.length||next.job?.phase!=='DEAD'||next.job.reason!=='DISABLED'||next.job.attempts!==0||!isDeepStrictEqual(prior.totals,next.totals))return fail('DRAIN_FORBIDDEN_TRANSITION');
    return native.commit(prior,next);},deliveries:async()=>[]};
  const forbidden=async()=>fail('DRAIN_EXECUTION_FORBIDDEN');
  return new DurableModelJobs({store,now:Date.now,execution:{reload:forbidden,invoke:forbidden,prepare:forbidden}});
}
async function main(phase) {
 const sourceSha=verifySource(process.env),root=process.env.RUNNER_TEMP,packageSource=process.env.PACKAGE_SOURCE,ownedSource=process.env.OWNED_SOURCE;
 if(!/^[a-f0-9]{40}$/.test(packageSource??'')||!/^[a-f0-9]{40}$/.test(ownedSource??''))return fail('DRAIN_SOURCE_INVALID');
 const aws=async(...args)=>{const {stdout}=await execute('aws',[...args,'--region','us-east-1','--output','json','--no-cli-pager'],{timeout:20000,maxBuffer:262144});return stdout.trim()?JSON.parse(stdout):{};};
 const identity=await aws('sts','get-caller-identity'),role=phase==='recover'?'KnownEnoughGithubQaRelease':'KnownEnoughGithubModelJobOperations';
 if(identity.Account!==account||!identity.Arn?.startsWith(`arn:aws:sts::${account}:assumed-role/${role}/`))return fail('DRAIN_IDENTITY_INVALID');
 const statePath=join(root,'precall-drain-private.json');
 const client=new DynamoDBClient({region:'us-east-1',maxAttempts:1});
 const get=async(TableName,PK)=>(await client.send(new GetItemCommand({TableName,Key:key(PK),ConsistentRead:true}),{abortSignal:globalThis.AbortSignal.timeout(10000)})).Item;
 if(phase==='inline') {
  const proof=JSON.parse(await readFile(join(root,'partition-cutover-private/ops03-proof-private.json'),'utf8'));
  if(proof.sourceSha!==ownedSource||ownedSource!==sourceSha||proof.packageSource!==packageSource)return fail('DRAIN_PRIVATE_SOURCE_MISMATCH');
  if(!proof.jobId)return {sourceSha,phase,result:'NO_OWN_JOB_CREATED',providerCalls:0};
  const control=ControlSchema.parse(JSON.parse((await get(table,'OPERATIONS#MODEL_JOBS')).payload.S)),job=JobSchema.parse(JSON.parse((await get(table,'MODELJOB#'+proof.jobId)).payload.S)),totals=TotalsSchema.parse(JSON.parse((await get(budget,'TOTAL')).payload.S));
  if(['SUCCEEDED','DEAD'].includes(job.phase)&&job.reason!=='PROVIDER_UNCONFIRMED'){
   if(control.enabled||control.sourceSha!==packageSource||control.active.length||control.slots.length)return fail('DRAIN_TERMINAL_CONTROL_NOT_EMPTY');
   return {sourceSha,phase,result:'OWNED_TERMINAL_JOB_PRESERVED',providerCalls:0,totalsValuesUnchanged:true,active:0,slots:0};
  }
  const state={proof};const delivery=checkedDrain(control,job,proof,{ownedSource,packageSource});
  const worker=precallOnlyWorker(state,{ownedSource,packageSource},createDynamoModelJobStore({verifiedTarget:{account,region:'us-east-1'},sourceSha:packageSource}));
  if(await worker.process(delivery)!=='DEAD')return fail('DRAIN_NOT_TERMINATED');
  const after=TotalsSchema.parse(JSON.parse((await get(budget,'TOTAL')).payload.S)),end=ControlSchema.parse(JSON.parse((await get(table,'OPERATIONS#MODEL_JOBS')).payload.S));
  if(!isDeepStrictEqual(totals,after)||end.enabled||end.sourceSha!==packageSource||end.active.length||end.slots.length)return fail('DRAIN_FINAL_STATE_MISMATCH');
 }else if(phase==='read') {
  const control=ControlSchema.parse(JSON.parse((await get(table,'OPERATIONS#MODEL_JOBS')).payload.S));
  if(control.enabled||control.sourceSha!==packageSource||control.slots.length||control.active.length!==1)return fail('DRAIN_CONTROL_NOT_EXACT_DISABLED');
  const job=JobSchema.parse(JSON.parse((await get(table,'MODELJOB#'+control.active[0])).payload.S)),totals=TotalsSchema.parse(JSON.parse((await get(budget,'TOTAL')).payload.S));
  await writeFile(statePath,JSON.stringify({sourceSha,ownedSource,packageSource,control,job,totals}),{mode:0o600});
 }else if(phase==='recover') {
  const state=JSON.parse(await readFile(statePath,'utf8'));if(state.sourceSha!==sourceSha||state.ownedSource!==ownedSource||state.packageSource!==packageSource)return fail('DRAIN_PRIVATE_SOURCE_MISMATCH');
  const list=await aws('s3api','list-objects-v2','--bucket','known-enough-qa-artifacts-'+account,'--prefix','ops01-owned/','--max-keys','1000','--no-paginate');
  if(list.IsTruncated)return fail('DRAIN_OBJECT_LIST_TRUNCATED');
  let found=null;
  for(const objectKey of proofKeys(list.Contents??[])) {
   const file=join(root,'precall-proof-'+randomUUID()+'.json');await aws('s3api','get-object','--bucket','known-enough-qa-artifacts-'+account,'--key',objectKey,file);
   const proof=JSON.parse(await readFile(file,'utf8'));if(proof.sourceSha===ownedSource&&proof.packageSource===packageSource&&proof.jobId===state.job.reference.jobId){if(found)return fail('DRAIN_MULTIPLE_OWNED_PROOFS');found=proof;}
  }
  if(!found)return fail('DRAIN_PRIVATE_PROOF_NOT_FOUND');checkedDrain(state.control,state.job,found,{ownedSource,packageSource});
  await writeFile(statePath,JSON.stringify({...state,proof:found}),{mode:0o600});
 }else if(phase==='drain') {
  const state=JSON.parse(await readFile(statePath,'utf8'));if(state.sourceSha!==sourceSha||state.ownedSource!==ownedSource||state.packageSource!==packageSource)return fail('DRAIN_PRIVATE_SOURCE_MISMATCH');
  const control=ControlSchema.parse(JSON.parse((await get(table,'OPERATIONS#MODEL_JOBS')).payload.S)),job=JobSchema.parse(JSON.parse((await get(table,'MODELJOB#'+state.job.reference.jobId)).payload.S)),before=TotalsSchema.parse(JSON.parse((await get(budget,'TOTAL')).payload.S));
  if(!isDeepStrictEqual(before,state.totals))return fail('DRAIN_TOTAL_CHANGED');
  const delivery=checkedDrain(control,job,state.proof,{ownedSource,packageSource});
  const worker=precallOnlyWorker(state,{ownedSource,packageSource},createDynamoModelJobStore({verifiedTarget:{account,region:'us-east-1'},sourceSha:packageSource}));
  if(await worker.process(delivery)!=='DEAD')return fail('DRAIN_NOT_TERMINATED');
  const after=TotalsSchema.parse(JSON.parse((await get(budget,'TOTAL')).payload.S)),end=ControlSchema.parse(JSON.parse((await get(table,'OPERATIONS#MODEL_JOBS')).payload.S)),terminal=JobSchema.parse(JSON.parse((await get(table,'MODELJOB#'+delivery.jobId)).payload.S));
  if(!isDeepStrictEqual(before,after)||end.enabled||end.sourceSha!==packageSource||end.active.length||end.slots.length||terminal.phase!=='DEAD'||terminal.reason!=='DISABLED'||terminal.attempts!==0)return fail('DRAIN_FINAL_STATE_MISMATCH');
 }else return fail('DRAIN_PHASE_INVALID');
 return {sourceSha,phase,result:'OWNED_PRECALL_DRAIN_PHASE_PASS',providerCalls:0,totalsValuesUnchanged:['drain','inline'].includes(phase)?true:'NOT_VERIFIED',...(['drain','inline'].includes(phase)?{state:'DISABLED',active:0,slots:0,job:'DEAD_DISABLED',attempts:0}:{})};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {const report=await main(process.argv[2]);await writeFile(join(process.env.RUNNER_TEMP,'precall-drain-'+process.argv[2]+'-report.json'),JSON.stringify(report)+'\n');}
 catch(error){const awsCode=['AccessDeniedException','AccessDenied','ExpiredToken','TransactionCanceledException'].includes(error.name)?error.name:error.stderr?.match(/\(([A-Za-z0-9]+)\)/)?.[1];await writeFile(join(process.env.RUNNER_TEMP,'precall-drain-'+process.argv[2]+'-report.json'),JSON.stringify({result:'OWNED_PRECALL_DRAIN_BLOCKED',code:error.safeCode??awsCode??'DRAIN_UNVERIFIED',providerCalls:0})+'\n');process.exitCode=1;}
}
