import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { KnownEnoughApplication } from '@deal-table/application';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { RequestNegotiation } from '@deal-table/contracts/durable-command';
import { createPartitionManagedDriver } from '../../packages/adapters/src/partition-managed.ts';
import { createPartitionedGroupRepository } from '../../packages/adapters/src/partitioned-group-repository.ts';
import { createPartitionDecisionRepository, validatePartitionDecisionCommand } from '../../packages/adapters/src/partition-decision-repository.ts';
import { partitionMemberId } from '../../packages/adapters/src/partition-group-session.ts';
import { encodeGuardItem, decodeGuardItem } from '../../packages/adapters/src/dynamodb-codec.ts';
import { ControlSchema, JobSchema, TotalsSchema, DurableJobError } from '../../packages/adapters/src/durable-model-jobs.ts';
import { RetentionPolicy } from '../../packages/adapters/src/partition-lifecycle.ts';
import { createCognitoIdentityResolver } from '../../apps/api/src/cognito-identity.ts';
import { syntheticProofPolicy, ownedRegistrationStamp } from './lifecycle-owned-behavior.mjs';
import { ownFixture, jsonResponse } from './partition-live-behavior.mjs';
import { verifySource } from './verify.mjs';
import { createManagedDurableNegotiationWorker } from '../../apps/api/src/durable-model-worker.ts';
import { genericCandidates } from '../../packages/adapters/src/generic-candidates.ts';
export const PROOF_ROLES=Object.freeze({preserve:'KnownEnoughGithubQaRelease',prepare:'KnownEnoughGithubPartitionMigration',policy:'KnownEnoughGithubRetentionPolicy',consent:'KnownEnoughGithubModelJobOperations',activate:'KnownEnoughGithubModelJobOperations',enqueue:'KnownEnoughGithubModelJobOperations',observe:'KnownEnoughGithubModelJobOperations','native-race':'KnownEnoughGithubModelJobOperations','disable-control':'KnownEnoughGithubModelJobOperations','disable-policy':'KnownEnoughGithubRetentionPolicy'});
const execute=promisify(execFile), table='KnownEnoughOperationsJournal';
const key=PK=>({PK:{S:PK},SK:{S:'STATE'}}),controlKey=key('OPERATIONS#MODEL_JOBS'),policyKey=key('OPERATIONS#RETENTION');
const fail=code=>{throw Object.assign(new Error(code),{safeCode:code});};
const envelope=(key,value)=>({...key,revision:{N:String(value.revision)},payload:{S:JSON.stringify(value)}});
const cas=prior=>prior?{ConditionExpression:'#r = :r AND #p = :p',ExpressionAttributeNames:{'#r':'revision','#p':'payload'},ExpressionAttributeValues:{':r':prior.revision,':p':prior.payload}}:{ConditionExpression:'attribute_not_exists(PK)'};
/** Test setup only: exact native guard-only update becomes its allowed conditional replacement.
 * The production repository/worker, participant fences and installed grants are unchanged. */
export function ownedDraftGuardPut(command,decisionId,tableArn){
 if(!(command instanceof TransactWriteItemsCommand))return command;
 validatePartitionDecisionCommand(command);
 const copy=structuredClone(command.input),updates=copy.TransactItems.filter(item=>item.Update);
 const writes=copy.TransactItems.filter(item=>item.Put||item.Update),state=writes.find(item=>item.Put)?.Put;
 if(writes.length!==2||!state||state.TableName!==tableArn||state.Item?.PK?.S!=='ROOM#'+decisionId||state.Item?.SK?.S!=='STATE')return fail('OWN_DRAFT_SCOPE_INVALID');
 if(updates.length!==1)return fail('OWN_DRAFT_GUARD_SHAPE_INVALID');
 const u=updates[0].Update,n=u.ExpressionAttributeNames,v=u.ExpressionAttributeValues;
 const names={'#version':'version','#incarnation':'incarnation','#ordinary':'ordinaryReceipts','#permission':'permissionHistoryReceipts','#safety':'safetyReserveReceipts','#total':'totalReceipts'};
 const condition='#version = :oldVersion AND #incarnation = :incarnation AND #ordinary = :oldOrdinary AND #permission = :oldPermission AND #safety = :oldSafety AND #total = :oldTotal';
 if(u.TableName!==tableArn||u.Key?.PK?.S!=='ROOM#'+decisionId||u.Key?.SK?.S!=='GUARD'
  ||u.ConditionExpression!==condition||u.UpdateExpression!=='SET #version = :nextVersion, #ordinary = :nextOrdinary, #permission = :nextPermission, #safety = :nextSafety, #total = :nextTotal'
  ||!isDeepStrictEqual(n,names)||Object.keys(v??{}).sort().join('|')!==[':nextVersion',':nextOrdinary',':nextPermission',':nextSafety',':nextTotal',':oldVersion',':incarnation',':oldOrdinary',':oldPermission',':oldSafety',':oldTotal'].sort().join('|')
  ||Object.keys(u).sort().join('|')!==['TableName','Key','UpdateExpression','ConditionExpression','ExpressionAttributeNames','ExpressionAttributeValues'].sort().join('|'))return fail('OWN_DRAFT_GUARD_SHAPE_INVALID');
 const integer=k=>{const value=v[k]?.N;if(!/^(0|[1-9][0-9]*)$/.test(value??'')||!Number.isSafeInteger(Number(value)))return fail('OWN_DRAFT_GUARD_VALUE_INVALID');return Number(value);};
 if(integer(':nextVersion')!==integer(':oldVersion')+1||['Ordinary','Permission','Safety','Total'].some(name=>integer(':next'+name)!==integer(':old'+name)))return fail('OWN_DRAFT_GUARD_RECEIPTS_CHANGED');
 const guard={version:integer(':nextVersion'),incarnation:v[':incarnation']?.S,ordinaryReceipts:integer(':nextOrdinary'),permissionHistoryReceipts:integer(':nextPermission'),safetyReserveReceipts:integer(':nextSafety'),totalReceipts:integer(':nextTotal')};
 const Item=encodeGuardItem(decisionId,guard);decodeGuardItem(Item,decisionId);
 const values=Object.fromEntries(Object.entries(v).filter(([key])=>!key.startsWith(':next')));
 for(const item of copy.TransactItems)if(item.Update){delete item.Update;item.Put={TableName:tableArn,Item,ConditionExpression:condition+' AND #schemaVersion = :schemaVersion',ExpressionAttributeNames:{...names,'#schemaVersion':'schemaVersion'},ExpressionAttributeValues:{...values,':schemaVersion':Item.schemaVersion}};}
 return new TransactWriteItemsCommand(copy);
}
export function scopedGetGroups(groups){
 if(typeof groups?.read!=='function'||typeof groups?.commit!=='function')return fail('OWN_GROUP_TRANSPORT_INVALID');
 return {read:groups.read.bind(groups),commit:groups.commit.bind(groups)};
}
export function ownedPublicDraft(group,accounts,nonce){
 const participants=group.members.map(subject=>{const account=accounts.find(a=>a.subject===subject);if(!account||account.status!=='APPROVED')return fail('OWN_DRAFT_ACCOUNT_INVALID');return {id:partitionMemberId(subject),displayName:account.displayName,requiredForApproval:true};});
 return Groups.GroupDraft.parse({id:'ops03-'+nonce,bodyHash:createHash('sha256').update(nonce).digest('hex'),revision:1,groupVersion:group.version,
 frame:{schemaVersion:KE.KE_SCHEMA_VERSION,decisionId:'owned-'+nonce,frameVersion:1,semanticVersion:1,contextToken:'c'.repeat(64),title:'Owned scheduled negotiation proof',objective:'Choose one of two synthetic options.',description:'Synthetic setup only; no real architect output.',participants,requiredParticipantIds:participants.map(p=>p.id),
 variables:[{id:'activity',label:'Activity',type:'ENUM',required:true,visibility:'PUBLIC',options:[{id:'first',label:'First'},{id:'second',label:'Second'}]}],rules:[]},clarificationQuestions:[],createdDecisionId:null});
}
export function enqueueRequest(decisionId,owner){return RequestNegotiation.parse({schemaVersion:KE.KE_SCHEMA_VERSION,type:'REQUEST_NEGOTIATION',requestId:randomUUID(),decisionId,expected:{contextToken:owner.publicSnapshot.frame.contextToken,semanticVersion:owner.publicSnapshot.frame.semanticVersion,controlVersion:owner.controlVersion}});}
export function exactJobReservation(before, after, job) {
 const expected=TotalsSchema.parse({...TotalsSchema.parse(before),reservedTokens:before.reservedTokens+job.reservedTokens,reservedCostMicros:before.reservedCostMicros+job.reservedCostMicros});
 if(!isDeepStrictEqual(TotalsSchema.parse(after),expected))return fail('PROOF_USAGE_NOT_EXACT');
}
export async function nativeWorkerRace(createWorker, delivery) {
 const workers=[createWorker(),createWorker()];
 const results=await Promise.allSettled(workers.map(worker=>worker.process(delivery)));
 const outcomes=results.map(result=>{
  if(result.status==='fulfilled'&&['APPLIED','SKIPPED'].includes(result.value))return result.value;
  if(result.status==='rejected'&&result.reason instanceof DurableJobError&&result.reason.code==='CONFLICT')return 'CONFLICT';
  throw Object.assign(new Error('PROOF_NATIVE_RACE_FAILED'),{safeCode:'PROOF_NATIVE_RACE_FAILED',cause:result.status==='rejected'?result.reason:undefined});
 });
 if(!outcomes.includes('APPLIED'))return fail('PROOF_NATIVE_RACE_NO_RESULT');
 const restart=await createWorker().process(delivery);
 if(restart!=='SKIPPED')return fail('PROOF_TERMINAL_REDELIVERY_CHANGED');
 return {workers:2,outcomes,terminalRestart:restart};
}
export function awsDeniedDetails(error){
 for(let depth=0;error&&depth<8;depth++,error=error.cause){
  if(error.name!=='AccessDeniedException'||typeof error.message!=='string')continue;
  const action=error.message.match(/perform:\s*(dynamodb:(?:BatchGetItem|GetItem|PutItem|UpdateItem|ConditionCheckItem|TransactWriteItems))\b/)?.[1];
  if(action)return {deniedAction:action};
 }return {};
}
export function awsFailure(error){for(let depth=0;error&&depth<8;depth++,error=error.cause)if(['AccessDeniedException','AccessDenied','ExpiredToken','ResourceNotFoundException','TransactionCanceledException'].includes(error.name))return error.name;return null;}
export function proofReport(sourceSha,phase,state,result,code){
 const count=k=>Number.isSafeInteger(state?.[k])&&state[k]>=0&&state[k]<=1000?state[k]:0;
 return {sourceSha,phase,result,apiChecks:count('apiChecks'),signedFrameConfirmations:count('signedFrameConfirmations'),signedPrivateConfirmations:count('signedPrivateConfirmations'),duplicateReceipts:count('duplicateReceipts'),terminalSuccesses:count('terminalSuccesses'),
 syntheticPublicAndOwnerDrafts:'DECLARED_SETUP_NOT_MODEL_QUALIFICATION',realParticipants:0,...(code&&/^[A-Za-z0-9_]{1,100}$/.test(code)?{code}:{})};
}
async function main(phase){
 const sourceSha=verifySource(process.env),packageSource=process.env.PACKAGE_SOURCE;
 if(!/^[a-f0-9]{40}$/.test(packageSource??''))return fail('PROOF_PACKAGE_SOURCE_INVALID');
 const roles=PROOF_ROLES;
 if(!roles[phase])return fail('PROOF_PHASE_INVALID');
 const aws=async(service,op,...args)=>{const {stdout}=await execute('aws',[service,op,...args,'--region','us-east-1','--output','json','--no-cli-pager'],{timeout:20000,maxBuffer:131072});return stdout.trim()?JSON.parse(stdout):{};};
 const identity=await aws('sts','get-caller-identity');if(identity.Account!=='092954139775'||!identity.Arn?.startsWith('arn:aws:sts::092954139775:assumed-role/'+roles[phase]+'/'))return fail('PROOF_ROLE_INVALID');
 const directory=join(process.env.RUNNER_TEMP,'partition-cutover-private'),statePath=join(directory,'ops03-proof-private.json');
 const fixtures=JSON.parse(await readFile(join(directory,'owned-fixtures-private.json'),'utf8'));
 if(fixtures.sourceSha!==sourceSha||fixtures.fixtures?.length!==2)return fail('PROOF_FIXTURES_INVALID');
 const config=JSON.parse(await readFile(join(directory,'configuration-private.json'),'utf8')),release=JSON.parse(await readFile(join(directory,'release-private.json'),'utf8'));
 const manifestBytes=await readFile(join(directory,'manifest-private.json')),authenticate=createCognitoIdentityResolver(config);
 for(const fixture of fixtures.fixtures){ownFixture(fixture,fixtures.runId);const principal=await authenticate('Bearer '+fixture.accessToken);if(principal?.kind!=='participant'||principal.subject!==fixture.subject)return fail('PROOF_SIGNED_IDENTITY_INVALID');}
 let state;try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={sourceSha,packageSource,apiChecks:0,signedFrameConfirmations:0,signedPrivateConfirmations:0,duplicateReceipts:0,terminalSuccesses:0};}
 if(state.sourceSha!==sourceSha||state.packageSource!==packageSource)return fail('PROOF_SOURCE_CHANGED');
 const save=()=>writeFile(statePath,JSON.stringify(state),{mode:0o600});
 const client=new DynamoDBClient({region:'us-east-1',endpoint:'https://dynamodb.us-east-1.amazonaws.com',maxAttempts:1});
 const get=async(TableName,Key)=>(await client.send(new GetItemCommand({TableName,Key,ConsistentRead:true}),{abortSignal:globalThis.AbortSignal.timeout(10000)})).Item??null;
 const transact=items=>client.send(new TransactWriteItemsCommand({TransactItems:items,ClientRequestToken:randomUUID()}),{abortSignal:globalThis.AbortSignal.timeout(20000)});
 const managed=()=>createPartitionManagedDriver({manifestBytes,expected:{sourceSha:release.sourceSha,sourceRevision:release.sourceRevision,sourceHash:release.sourceHash,manifestHash:release.manifestHash},manifestVersion:release.manifestVersion,verifiedTarget:{account:'092954139775',region:'us-east-1'},cursorKey:Buffer.from(config.cursorKeyBase64,'base64')});
 const request=async(fixture,path,method='GET',body)=>{
  const response=await globalThis.fetch('https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com'+path,{method,redirect:'error',signal:globalThis.AbortSignal.timeout(20000),headers:{authorization:'Bearer '+fixture.accessToken,origin:config.allowedOrigin,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const value=await jsonResponse(response);state.apiChecks++;if(response.status!==200)return fail('PROOF_HTTP_'+response.status+'_'+(value.error?.code??'UNCLASSIFIED'));return value;
 };
 const command=async(fixture,type,payload)=>{
  const owner=await request(fixture,'/decisions/'+state.decisionId+'/me');const expected={contextToken:owner.publicSnapshot.frame.contextToken,semanticVersion:owner.publicSnapshot.frame.semanticVersion,controlVersion:owner.controlVersion,ownerVersion:owner.ownerVersion};
  const value=await request(fixture,'/decisions/'+state.decisionId+'/commands','POST',{schemaVersion:KE.KE_SCHEMA_VERSION,type,requestId:randomUUID(),idempotencyKey:randomUUID(),decisionId:state.decisionId,expected,payload});if(!value.ok)return fail('PROOF_COMMAND_NOT_ACCEPTED');return owner;
 };
 try{
  if(phase==='preserve'){
   await save();await aws('s3api','put-object','--bucket','known-enough-qa-artifacts-092954139775','--key','ops01-owned/'+fixtures.runId+'/ops03-proof-private.json','--body',statePath,'--server-side-encryption','AES256');
  }else if(phase==='prepare'){
   if(state.groupId)return fail('PROOF_PREPARE_ALREADY_RECORDED');
   for(const fixture of fixtures.fixtures)await createPartitionedGroupRepository(managed().groups).transaction({accountSubjects:[fixture.subject]},snapshot=>{const account=snapshot.accounts.find(a=>a.subject===fixture.subject);if(!account||account.status!=='PENDING')return fail('PROOF_ACCOUNT_NOT_PENDING');account.status='APPROVED';account.version++;});
   const [organizer,member]=fixtures.fixtures;state.groupId=(await request(organizer,'/groups','POST',{name:'OPS03 owned live proof',idempotencyKey:'ops03-'+organizer.nonce})).group.id;await save();
   const invite=await request(organizer,'/groups/'+state.groupId+'/invitations','POST',{email:member.mailbox.address,replace:false});await request(member,'/groups/accept','POST',{token:invite.token});
   await createPartitionedGroupRepository(managed().groups).transaction({accountSubjects:fixtures.fixtures.map(f=>f.subject),groupId:state.groupId},snapshot=>{const group=snapshot.groups.find(g=>g.id===state.groupId);if(!group||group.organizer!==organizer.subject||group.members.length!==2||group.drafts.length)return fail('PROOF_GROUP_NOT_OWNED');const draft=ownedPublicDraft(group,snapshot.accounts,organizer.nonce);group.drafts.push(draft);state.draftId=draft.id;});await save();
   state.decisionId=(await request(organizer,`/groups/${state.groupId}/drafts/${state.draftId}/create`,'POST',{revision:1})).snapshot.frame.decisionId;await save();
  }else if(phase==='policy'){
   const prior=await get(table,policyKey),policy=syntheticProofPolicy(prior?JSON.parse(prior.payload.S):null);if(state.policyIntent)return fail('PROOF_POLICY_NOT_RECONCILED');state.policyIntent=envelope(policyKey,policy);await save();
   const puts=[{Put:{TableName:table,Item:state.policyIntent,...cas(prior)}}];
   for(const fixture of fixtures.fixtures){const stamp=ownedRegistrationStamp(fixture,fixtures.runId,policy.revision,Date.now());puts.push({Put:{TableName:table,Item:envelope({PK:{S:'RETENTION#'+fixture.subject},SK:{S:'STAMP'}},stamp),...cas(null)}});}
   await transact(puts);if(!isDeepStrictEqual(await get(table,policyKey),state.policyIntent))return fail('PROOF_POLICY_UNKNOWN');
  }else if(phase==='consent'){
   for(const fixture of fixtures.fixtures)await command(fixture,'CONFIRM_FRAME',{frameVersion:1});state.signedFrameConfirmations=2;await save();
   const driver=managed(),repository=createPartitionDecisionRepository({decisionArn:driver.decisionArn,partitionArn:driver.partitionArn,transport:{send:(command,io)=>driver.decisions.send(ownedDraftGuardPut(command,state.decisionId,driver.decisionArn),io)},groups:scopedGetGroups(driver.groups)});
   for(const fixture of fixtures.fixtures){const principal=await authenticate('Bearer '+fixture.accessToken);const owner=await request(fixture,'/decisions/'+state.decisionId+'/me');const draft=KE.AIConstraintDraft.parse({schemaVersion:KE.KE_SCHEMA_VERSION,draftId:'empty-'+fixture.nonce,draftVersion:1,decisionId:state.decisionId,ownerParticipantId:owner.ownerParticipantId,ownerVersion:owner.ownerVersion,semanticVersion:owner.publicSnapshot.frame.semanticVersion,contextToken:owner.publicSnapshot.frame.contextToken,sourceSummary:'Owned synthetic empty structured constraints fixture; no interpreter model claim.',proposedConstraints:[],unsupportedConditions:[],createdAt:new Date().toISOString()});
    const application=new KnownEnoughApplication({repository:repository.forParticipant(principal),clock:{now:()=>new Date().toISOString()},ids:{next:()=>randomUUID()}});
    await application.storeConstraintDraft({kind:'service',subject:'owned-fixture-setup',roomIds:[state.decisionId]},draft,{principal,controlVersion:owner.controlVersion,expiresAt:Date.now()+30000});
    await command(fixture,'CONFIRM_CONSTRAINTS',{draftId:draft.draftId,draftVersion:1,constraintIds:[]});state.signedPrivateConfirmations++;await save();
   }
   const owner=await request(fixtures.fixtures[0],'/decisions/'+state.decisionId+'/me');if(owner.publicSnapshot.status!=='READY')return fail('PROOF_NOT_READY');
  }else if(phase==='disable-control'&&!state.controlIntent){
   state.controlCleanup='NOT_STARTED';
  }else if(phase==='activate'||phase==='disable-control'){
   const prior=await get(table,controlKey),control=ControlSchema.parse(JSON.parse(prior.payload.S));if(control.sourceSha!==packageSource)return fail('PROOF_CONTROL_SOURCE_MISMATCH');
   if(phase==='activate'&&(control.enabled||control.active.length||control.slots.length||state.signedPrivateConfirmations!==2))return fail('PROOF_ACTIVATION_NOT_EMPTY_CONSENTED');
   if(phase==='activate')state.totalsBefore=TotalsSchema.parse(JSON.parse((await get('KnownEnoughQaControl',key('TOTAL'))).payload.S));
   const next=ControlSchema.parse({...control,revision:control.revision+1,enabled:phase==='activate'});state.controlIntent=envelope(controlKey,next);await save();
   const items=[{Put:{TableName:table,Item:state.controlIntent,...cas(prior)}}];
   if(phase==='activate'){
    const auth=await get('KnownEnoughQaControl',key('AUTH')),policy=await get(table,policyKey);const authority=JSON.parse(auth.payload.S);
    if(authority.mode!=='standing'||authority.approved!==true||authority.retentionReviewed!==true||authority.invocationLoggingDisabled!==true||!isDeepStrictEqual(policy,state.policyIntent)||RetentionPolicy.parse(JSON.parse(policy.payload.S)).enabled!==true)return fail('PROOF_ACTIVATION_AUTHORITY_CHANGED');
    items.push({ConditionCheck:{TableName:'KnownEnoughQaControl',Key:key('AUTH'),ConditionExpression:'#v = :v AND #p = :p',ExpressionAttributeNames:{'#v':'version','#p':'payload'},ExpressionAttributeValues:{':v':auth.version,':p':auth.payload}}});
    items.push({ConditionCheck:{TableName:table,Key:policyKey,...cas(policy)}});
   }
   await transact(items);if(!isDeepStrictEqual(await get(table,controlKey),state.controlIntent))return fail('PROOF_CONTROL_UNKNOWN');
  }else if(phase==='enqueue'){
   const fixture=fixtures.fixtures[0],owner=await request(fixture,'/decisions/'+state.decisionId+'/me');const body=enqueueRequest(state.decisionId,owner);
   state.enqueueBody=body;await save();const first=await request(fixture,'/decisions/'+state.decisionId+'/commands','POST',body);state.jobId=first.job?.jobId;await save();const second=await request(fixture,'/decisions/'+state.decisionId+'/commands','POST',body);if(!state.jobId||second.job?.jobId!==state.jobId)return fail('PROOF_DUPLICATE_JOB_MISMATCH');state.duplicateReceipts=2;await save();
  }else if(phase==='native-race'){
   if(!state.jobId||state.signedPrivateConfirmations!==2)return fail('PROOF_NATIVE_RACE_NOT_CONSENTED');
   const logging=JSON.parse(await readFile(join(process.env.RUNNER_TEMP,'model-job-logging-report.json'),'utf8'));
   if(logging.sourceSha!==sourceSha||logging.result!=='PROVIDER_LOGGING_DISABLED')return fail('PROOF_ACTUAL_LOGGING_UNVERIFIED');
   const before=TotalsSchema.parse(JSON.parse((await get('KnownEnoughQaControl',key('TOTAL'))).payload.S));
   if(!isDeepStrictEqual(before,state.totalsBefore))return fail('PROOF_NATIVE_RACE_BASELINE_CHANGED');
   const make=()=>createManagedDurableNegotiationWorker({verifiedTarget:{account:'092954139775',region:'us-east-1'},sourceSha:packageSource,
    approval:{paidCallsApproved:true,invocationLoggingDisabled:true,retentionReviewed:true},publicCandidates:genericCandidates});
   state.nativeRace=await nativeWorkerRace(make,{jobId:state.jobId});await save();
   const job=JobSchema.parse(JSON.parse((await get(table,key('MODELJOB#'+state.jobId))).payload.S));
   if(job.phase!=='SUCCEEDED'||job.attempts!==1||!job.usage)return fail('PROOF_NATIVE_RACE_NOT_SINGLE_CALL');
   const after=TotalsSchema.parse(JSON.parse((await get('KnownEnoughQaControl',key('TOTAL'))).payload.S));exactJobReservation(before,after,job);
   const control=ControlSchema.parse(JSON.parse((await get(table,controlKey)).payload.S));
   if(control.active.length||control.slots.length)return fail('PROOF_NATIVE_RACE_OUTBOX_NOT_EMPTY');
   state.nativeRace.singlePaidAttempt=1;state.nativeRace.exactReservation=true;state.nativeRace.emptyOutbox=true;await save();
  }else if(phase==='observe'){
   if(!state.jobId)return fail('PROOF_JOB_MISSING');let job;
   for(let attempt=0;attempt<18;attempt++){const item=await get(table,key('MODELJOB#'+state.jobId));job=JobSchema.parse(JSON.parse(item.payload.S));if(['SUCCEEDED','DEAD'].includes(job.phase))break;await new Promise(r=>globalThis.setTimeout(r,10000));}
   state.actualJob={phase:job.phase,reason:job.reason,attempts:job.attempts,usage:job.usage,reservedTokens:job.reservedTokens,reservedCostMicros:job.reservedCostMicros};await save();
   if(job.phase!=='SUCCEEDED'||!job.usage||job.attempts!==1)return fail('PROOF_JOB_'+job.phase+'_'+(job.reason??'UNRESOLVED'));
   const snapshot=KE.PublicDecisionSnapshot.parse(await request(fixtures.fixtures[0],'/decisions/'+state.decisionId+'/public'));if(snapshot.status!=='PROPOSED'||!snapshot.currentProposal)return fail('PROOF_RESULT_NOT_PUBLISHED');state.terminalSuccesses=1;
   state.totalsAfter=TotalsSchema.parse(JSON.parse((await get('KnownEnoughQaControl',key('TOTAL'))).payload.S));exactJobReservation(state.totalsBefore,state.totalsAfter,job);await save();
  }else if(phase==='disable-policy'){
   if(state.policyIntent){const prior=await get(table,policyKey);if(!isDeepStrictEqual(prior,state.policyIntent))return fail('PROOF_POLICY_CLEANUP_CONFLICT');const policy=RetentionPolicy.parse(JSON.parse(prior.payload.S));const next=envelope(policyKey,RetentionPolicy.parse({...policy,revision:policy.revision+1,enabled:false}));await transact([{Put:{TableName:table,Item:next,...cas(prior)}}]);if(!isDeepStrictEqual(await get(table,policyKey),next))return fail('PROOF_POLICY_DISABLE_UNKNOWN');}
  }
  const report={...proofReport(sourceSha,phase,state,'OWNED_JOB_PHASE_PASS'),...(phase==='observe'?{actualJob:state.actualJob,totalsBefore:state.totalsBefore,totalsAfter:state.totalsAfter}:{}),...(state.nativeRace?{nativeRace:state.nativeRace}:{})};console.log(JSON.stringify(report));
 }catch(error){await save();const code=error.safeCode??awsFailure(error)??'OWNED_JOB_UNVERIFIED';console.log(JSON.stringify({...proofReport(sourceSha,phase,state,'OWNED_JOB_PHASE_BLOCKED',code),...awsDeniedDetails(error),...(state.actualJob?{actualJob:state.actualJob}:{})}));process.exitCode=1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await main(process.argv[2]);}catch(error){console.log(JSON.stringify(proofReport(process.env.GITHUB_SHA,process.argv[2],null,'OWNED_JOB_PHASE_BLOCKED',error.safeCode??'OWNED_JOB_SETUP_UNVERIFIED')));process.exitCode=1;}
}
