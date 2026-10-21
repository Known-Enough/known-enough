import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { ControlSchema, TotalsSchema, JobSchema } from '../../packages/adapters/src/durable-model-jobs.ts';
import { RetentionPolicy } from '../../packages/adapters/src/partition-lifecycle.ts';
import { MigrationControlSchema } from '../../packages/adapters/src/partition-migration-runner.ts';
import { validateAuthorization } from '../live-qa/config.mjs';
import { verifySource } from './verify.mjs';
import { createHash } from 'node:crypto';
import { decodeDecisionStateItem, decodeGuardItem, validateDecisionStateGuard } from '../../packages/adapters/src/dynamodb-codec.ts';
const execute=promisify(execFile);
const errorCode=error=>['AccessDeniedException','AccessDenied','ResourceNotFoundException','TimeoutError'].includes(error?.name)?error.name:'UNCLASSIFIED';
export function classifyJobRead(id,item,sourceSha){
 if(!item)return {state:'ABSENT'};
 try{
  const payload=JSON.parse(item.payload?.S??'null');
  if(id==='control'){
   const control=ControlSchema.parse(payload);
   if(item.revision?.N!==String(control.revision)||JSON.stringify(control)!==item.payload.S)throw Error();
   return {state:control.enabled?'ENABLED':'DISABLED',controlSource:control.sourceSha,sourceMatches:control.sourceSha===sourceSha,active:control.active.length,slots:control.slots.length};
  }
  if(id==='authority'){
   const auth=validateAuthorization(payload);if(auth.mode!=='standing'||auth.approved!==true)throw Error();
   return {state:'STANDING_APPROVED',loggingDeclaration:auth.invocationLoggingDisabled?'DISABLED':'NOT_DISABLED',actualProviderLogging:'NOT_READ'};
  }
  if(id==='totals'){
   const totals=TotalsSchema.parse(payload);if(JSON.stringify(totals)!==item.payload.S||!/^[1-9][0-9]*$/.test(item.version?.N??''))throw Error();
   return {state:'PRESENT_VALID',...totals};
  }
  if(id==='retention'){
   const policy=RetentionPolicy.parse(payload);if(item.revision?.N!==String(policy.revision)||JSON.stringify(policy)!==item.payload.S)throw Error();
   return {state:policy.enabled?'ENABLED':'DISABLED',dataClass:policy.dataClass};
  }
  if(id==='migration'){
   const control=MigrationControlSchema.parse(payload);if(item.revision?.N!==String(control.revision))throw Error();
   return {state:control.active?'ACTIVE':'INACTIVE'};
  }
 }catch{return {state:'INVALID'};}
 return {state:'INVALID'};
}
export async function installedJobReadProof(send,sourceSha){
 if(typeof send!=='function'||!/^[a-f0-9]{40}$/.test(sourceSha))throw Error('JOBS_READBACK_INVALID');
 const checks=[];const refs=[['control','KnownEnoughOperationsJournal','OPERATIONS#MODEL_JOBS'],['authority','KnownEnoughQaControl','AUTH'],
 ['totals','KnownEnoughQaControl','TOTAL'],['retention','KnownEnoughOperationsJournal','OPERATIONS#RETENTION'],['migration','KnownEnoughPartitions','MIGRATION#CONTROL']];
 for(const [id,TableName,PK] of refs){
  try{const key={PK:{S:PK},SK:{S:'STATE'}};const result=await send(new GetItemCommand({TableName,Key:key,ConsistentRead:true}),{abortSignal:globalThis.AbortSignal.timeout(10000)});
   if(result.Item&&(result.Item.PK?.S!==PK||result.Item.SK?.S!=='STATE'))throw Error('FOREIGN_ITEM');
   checks.push({capability:id,result:'READ_ALLOWED',...classifyJobRead(id,result.Item,sourceSha)});
  }catch(error){checks.push({capability:id,result:'READ_FAILED',code:errorCode(error)});}
 }
 return {result:checks.every(check=>check.result==='READ_ALLOWED')?'JOB_READ_ACCESS_PASS':'JOB_READ_ACCESS_INCOMPLETE',checks,requests:5,
 mutations:0,providerCalls:0,runtimePublication:'NOT_EXECUTED',allMemberRetention:'NOT_EXECUTED',actualProviderLogging:'NOT_READ'};
}
/** Read finite phases only; identifiers, subjects, input/output and raw SDK errors never leave this function. */
export async function installedJobQueueProof(send,now=Date.now()) {
 const result={result:'JOB_QUEUE_READ_INCOMPLETE',requests:0,mutations:0,providerCalls:0};
 try {
  if(!Number.isSafeInteger(now)||now<0)throw Error();
  const read=async PK=>{result.requests++;const value=await send(new GetItemCommand({TableName:'KnownEnoughOperationsJournal',Key:{PK:{S:PK},SK:{S:'STATE'}},ConsistentRead:true}),{abortSignal:globalThis.AbortSignal.timeout(10000)});
   if(value.Item&&(value.Item.PK?.S!==PK||value.Item.SK?.S!=='STATE'))throw Error();return value.Item;};
  const item=await read('OPERATIONS#MODEL_JOBS');const control=ControlSchema.parse(JSON.parse(item?.payload?.S??'null'));
  if(item.revision?.N!==String(control.revision)||JSON.stringify(control)!==item.payload.S)throw Error();
  const jobs=[];
  for(const id of control.active){const row=await read('MODELJOB#'+id);const job=JobSchema.parse(JSON.parse(row?.payload?.S??'null'));
   if(job.reference.jobId!==id||job.reference.sourceSha!==control.sourceSha||row.revision?.N!==String(job.revision)||JSON.stringify(job)!==row.payload.S)throw Error();jobs.push(job);}
  const after=await read('OPERATIONS#MODEL_JOBS');if(after?.payload?.S!==item.payload.S||after.revision?.N!==item.revision.N)return {...result,code:'QUEUE_CHANGED'};
  return {...result,result:'JOB_QUEUE_READ_PASS',controlSource:control.sourceSha,enabled:control.enabled,active:control.active.length,slots:control.slots.length,
   slotsExpired:control.slots.filter(slot=>slot.until<=now).length,
   jobs:jobs.map(job=>({kind:job.reference.kind,phase:job.phase,reason:job.reason,attempts:job.attempts,failures:job.failures,expired:job.reference.expiresAt<=now,
    leaseExpired:job.lease?job.lease.until<=now:null,reservedTokens:job.reservedTokens,reservedCostMicros:job.reservedCostMicros,usageRecorded:job.usage!==null}))};
 }catch(error){return {...result,code:errorCode(error)};}
}
/** Optional exact-ID terminal readback. Only finite disposition and observed usage are published. */
export async function installedOwnedJobProof(send, ids, runtimeSource) {
 const result={result:'OWNED_JOB_READ_INCOMPLETE',requests:0,mutations:0,providerCalls:0};
 try {
  if(!Array.isArray(ids)||ids.length<1||ids.length>8||new Set(ids).size!==ids.length
   ||ids.some(id=>!/^[a-f0-9-]{36}$/.test(id))||!/^[a-f0-9]{40}$/.test(runtimeSource))throw Error();
  const jobs=[];
  for(const id of ids){result.requests++;const PK='MODELJOB#'+id;
   const value=await send(new GetItemCommand({TableName:'KnownEnoughOperationsJournal',Key:{PK:{S:PK},SK:{S:'STATE'}},ConsistentRead:true}),{abortSignal:globalThis.AbortSignal.timeout(10000)});
   const row=value.Item,job=JobSchema.parse(JSON.parse(row?.payload?.S??'null'));
   if(row.PK?.S!==PK||row.SK?.S!=='STATE'||row.revision?.N!==String(job.revision)||JSON.stringify(job)!==row.payload.S
    ||job.reference.jobId!==id||job.reference.sourceSha!==runtimeSource)throw Error();
   jobs.push({kind:job.reference.kind,phase:job.phase,reason:job.reason,attempts:job.attempts,failures:job.failures,
    reservedTokens:job.reservedTokens,reservedCostMicros:job.reservedCostMicros,usage:job.usage});
  }
  return {...result,result:'OWNED_JOB_READ_PASS',runtimeSource,jobs};
 }catch(error){return {...result,code:errorCode(error)};}
}
/** Exact user-reported decision metadata only; no names, answers, rules or proposal values. */
export async function installedDecisionOutcomeProof(send, decisionId) {
 const result={result:'DECISION_OUTCOME_READ_INCOMPLETE',requests:0,mutations:0,providerCalls:0};
 try {
  if(!/^groupdecision-[a-f0-9]{40}$/.test(decisionId))throw Error();
  const rows=[];
  for(const SK of ['STATE','GUARD']){
   result.requests++;
   const response=await send(new GetItemCommand({TableName:'KnownEnoughStage',Key:{PK:{S:'ROOM#'+decisionId},SK:{S:SK}},ConsistentRead:true}),{abortSignal:globalThis.AbortSignal.timeout(10000)});
   rows.push(response.Item);
  }
  const record=decodeDecisionStateItem(rows[0],decisionId),guard=decodeGuardItem(rows[1],decisionId);
  validateDecisionStateGuard(record,guard);
  return {...result,result:'DECISION_OUTCOME_READ_PASS',decisionHash:createHash('sha256').update(decisionId).digest('hex'),
   status:record.status,reasoningActive:record.job!==null,proposalPresent:record.publicProposal!==null,
   participants:record.definition.participants.length,answered:record.owners.filter(owner=>owner.readiness==='READY').length,
   publicRevision:record.publicRevision,controlVersion:record.controlVersion};
 }catch(error){return {...result,code:errorCode(error)};}
}
async function main(){const sourceSha=verifySource(process.env);
 const {stdout}=await execute('aws',['sts','get-caller-identity','--region','us-east-1','--output','json','--no-cli-pager'],{timeout:15000,maxBuffer:8192});
 const identity=JSON.parse(stdout);if(identity.Account!=='092954139775'||!identity.Arn?.startsWith('arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubModelJobOperations/'))throw Error('JOBS_ROLE_INVALID');
 const client=new DynamoDBClient({region:'us-east-1',endpoint:'https://dynamodb.us-east-1.amazonaws.com',maxAttempts:1});
 const send=client.send.bind(client),result=await installedJobReadProof(send,sourceSha);
 const decision=process.env.DECISION_ID?await installedDecisionOutcomeProof(send,process.env.DECISION_ID):null;
 const owned=process.env.OWNED_JOB_IDS?await installedOwnedJobProof(send,process.env.OWNED_JOB_IDS.split(','),process.env.RUNTIME_SOURCE):null;
 console.log(JSON.stringify({sourceSha,account:'092954139775',region:'us-east-1',...result,queue:await installedJobQueueProof(send),...(owned?{owned}:{}),...(decision?{decision}:{})}));
 if(result.result!=='JOB_READ_ACCESS_PASS'||(owned&&owned.result!=='OWNED_JOB_READ_PASS')||(decision&&decision.result!=='DECISION_OUTCOME_READ_PASS'))process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await main();}catch{console.error(JSON.stringify({result:'JOBS_INSTALLED_READBACK_NOT_VERIFIED',mutations:0,providerCalls:0}));process.exitCode=1;}
}
