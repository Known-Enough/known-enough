import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { createPartitionManagedDriver } from '../../packages/adapters/src/partition-managed.ts';
import { createPartitionedGroupRepository } from '../../packages/adapters/src/partitioned-group-repository.ts';
import { RetentionPolicy, RetentionStamp, loadLifecyclePlan } from '../../packages/adapters/src/partition-lifecycle.ts';
import { createCognitoIdentityResolver } from '../../apps/api/src/cognito-identity.ts';
import { loadLifecyclePackage } from './lifecycle-package.ts';
import { ownFixture, jsonResponse } from './partition-live-behavior.mjs';
import { verifySource } from './verify.mjs';
const execute=promisify(execFile);
const policyKey={PK:{S:'OPERATIONS#RETENTION'},SK:{S:'STATE'}};
const table='KnownEnoughOperationsJournal';
const base={schemaVersion:1,kind:'RETENTION_POLICY',enabled:true,dataClass:'SYNTHETIC',rawConversationMs:0,
 structuredMs:30*86400000,replayMs:86400000,journalMs:7*86400000,backupMs:null,providerMs:null,realPersonPolicy:'UNAPPROVED'};
const fail=code=>{throw Object.assign(new Error(code),{safeCode:code});};
export function syntheticProofPolicy(prior){
 if(prior===null)return RetentionPolicy.parse({...base,revision:1});
 const parsed=RetentionPolicy.parse(prior);
 if(parsed.enabled||!isDeepStrictEqual({...parsed,enabled:true,revision:1},RetentionPolicy.parse({...base,revision:1})))return fail('PROOF_POLICY_NOT_SAFE_TO_REPLACE');
 return RetentionPolicy.parse({...base,revision:parsed.revision+1});
}
export function ownedRegistrationStamp(fixture,runId,revision,now){
 ownFixture(fixture,runId);
 const at=Date.parse(fixture.observedRegistrationAt);
 if(!fixture.registered||!Number.isFinite(at)||!Number.isSafeInteger(now)||at>now||now-at>3600000)return fail('OWN_REGISTRATION_TIME_NOT_VERIFIED');
 return RetentionStamp.parse({revision:1,dataClass:'SYNTHETIC',policyRevision:revision,
 schemaVersion:1,kind:'RETENTION_STAMP',createdAt:fixture.observedRegistrationAt,lastActivityAt:fixture.observedRegistrationAt});
}
const envelope=(key,value)=>({...key,revision:{N:String(value.revision)},payload:{S:JSON.stringify(value)}});
function cas(old){return old?{ConditionExpression:'#r = :r AND #p = :p',ExpressionAttributeNames:{'#r':'revision','#p':'payload'},
 ExpressionAttributeValues:{':r':old.revision,':p':old.payload}}:{ConditionExpression:'attribute_not_exists(PK)'};}
export function ownerProofReport(sourceSha,state,phase,result,code){
 const count=name=>Number.isSafeInteger(state?.[name])&&state[name]>=0&&state[name]<=512?state[name]:0;
 return {sourceSha,phase:['approve','policy','execute','disable-policy'].includes(phase)?phase:'UNKNOWN',
 result:['OWNER_PROOF_PHASE_PASS','OWNER_PROOF_BLOCKED'].includes(result)?result:'NOT_VERIFIED',
 exports:count('exports'),apiChecks:count('apiChecks'),foreignOwnerDenied:count('foreignOwnerDenied'),
 revokedExecutionDenied:count('revokedExecutionDenied'),erased:count('erased'),restartSteps:count('restartSteps'),
 modelCalls:0,realParticipants:0,...(typeof code==='string'&&/^[A-Za-z0-9_]{1,100}$/.test(code)?{code}:{})};
}
async function main(phase){
 const sourceSha=verifySource(process.env);const roles={approve:'KnownEnoughGithubPartitionMigration',policy:'KnownEnoughGithubRetentionPolicy',execute:'KnownEnoughGithubLifecycleExecutor','disable-policy':'KnownEnoughGithubRetentionPolicy'};
 if(!roles[phase])return fail('OWNER_PROOF_PHASE_INVALID');
 const aws=async(service,operation,...args)=>{const {stdout}=await execute('aws',[service,operation,...args,'--region','us-east-1','--output','json','--no-cli-pager'],{timeout:20000,maxBuffer:131072});return stdout.trim()?JSON.parse(stdout):{};};
 const identity=await aws('sts','get-caller-identity');if(identity.Account!=='092954139775'||!identity.Arn?.startsWith('arn:aws:sts::092954139775:assumed-role/'+roles[phase]+'/'))return fail('OWNER_PROOF_ROLE_INVALID');
 const directory=join(process.env.RUNNER_TEMP,'partition-cutover-private');
 const fixturePath=join(directory,'owned-fixtures-private.json');const privatePath=join(directory,'owner-proof-private.json');
 const fixtures=JSON.parse(await readFile(fixturePath,'utf8'));
 if(fixtures.sourceSha!==sourceSha||fixtures.fixtures?.length!==2)return fail('OWNER_PROOF_FIXTURES_INVALID');
 const config=JSON.parse(await readFile(join(directory,'configuration-private.json'),'utf8'));
 const release=JSON.parse(await readFile(join(directory,'release-private.json'),'utf8'));
 const manifestBytes=await readFile(join(directory,'manifest-private.json'));
 const lifecycle=loadLifecyclePackage(await readFile(join(directory,'lifecycle-private.json')));
 const authenticate=createCognitoIdentityResolver(config);
 for(const fixture of fixtures.fixtures){ownFixture(fixture,fixtures.runId);const principal=await authenticate('Bearer '+fixture.accessToken);if(principal?.kind!=='participant'||principal.subject!==fixture.subject)return fail('OWNER_PROOF_SIGNED_IDENTITY_INVALID');}
 let state;try{state=JSON.parse(await readFile(privatePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 state??={sourceSha,runId:fixtures.runId,plans:[],exports:0,apiChecks:0,foreignOwnerDenied:0,revokedExecutionDenied:0,erased:0,restartSteps:0};
 if(state.sourceSha!==sourceSha||state.runId!==fixtures.runId)return fail('OWNER_PROOF_STATE_INVALID');
 const save=()=>writeFile(privatePath,JSON.stringify(state),{mode:0o600});
 const client=new DynamoDBClient({region:'us-east-1',endpoint:'https://dynamodb.us-east-1.amazonaws.com',maxAttempts:1});
 const get=async key=>(await client.send(new GetItemCommand({TableName:table,Key:key,ConsistentRead:true}),{abortSignal:globalThis.AbortSignal.timeout(10000)})).Item??null;
 const transact=items=>client.send(new TransactWriteItemsCommand({TransactItems:items,ClientRequestToken:randomUUID()}),{abortSignal:globalThis.AbortSignal.timeout(20000)});
 const managed=()=>createPartitionManagedDriver({manifestBytes,expected:{sourceSha:release.sourceSha,sourceRevision:release.sourceRevision,sourceHash:release.sourceHash,manifestHash:release.manifestHash},
 manifestVersion:release.manifestVersion,verifiedTarget:{account:'092954139775',region:'us-east-1'},cursorKey:Buffer.from(config.cursorKeyBase64,'base64')});
 const owner=()=>managed().lifecycle({sourceSha:lifecycle.sourceSha,signingKey:Buffer.from(lifecycle.signingKeyBase64,'base64')});
 const request=async(fixture,path,method='GET',body,expected=200)=>{
  const response=await globalThis.fetch('https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com'+path,{method,redirect:'error',signal:globalThis.AbortSignal.timeout(20000),
   headers:{authorization:'Bearer '+fixture.accessToken,origin:config.allowedOrigin,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const value=await jsonResponse(response);state.apiChecks++;
  if(response.status!==expected)return fail('OWNER_HTTP_'+response.status+'_'+(value.error?.code??'UNCLASSIFIED'));
  if(expected===200&&response.headers.get('cache-control')!=='no-store'&&path.startsWith('/account/'))return fail('OWNER_RESPONSE_NOT_PRIVATE');
  return value;
 };
 try{
  if(phase==='approve'){
   for(const fixture of fixtures.fixtures){await createPartitionedGroupRepository(managed().groups).transaction({accountSubjects:[fixture.subject]},snapshot=>{
    const account=snapshot.accounts.find(item=>item.subject===fixture.subject);if(!account||account.status!=='PENDING')return fail('OWNER_FIXTURE_NOT_PENDING');account.status='APPROVED';account.version++;});}
   const group=await request(fixtures.fixtures[0],'/groups','POST',{name:'OPS02 owned deletion proof',idempotencyKey:'ops02-'+fixtures.fixtures[0].nonce});
   if(typeof group.group?.id!=='string')return fail('OWNER_GROUP_NOT_CREATED');state.groupId=group.group.id;await save();
  }else if(phase==='policy'){
   if(!state.groupId||state.policyIntent)return fail('OWNER_POLICY_REPEAT_NOT_RECONCILED');
   const prior=await get(policyKey);const policy=syntheticProofPolicy(prior?JSON.parse(prior.payload.S):null);
   const next=envelope(policyKey,policy);state.policyIntent=next;await save();
   const items=[{Put:{TableName:table,Item:next,...cas(prior)}}];
   for(const fixture of fixtures.fixtures){const key={PK:{S:'RETENTION#'+fixture.subject},SK:{S:'STAMP'}};
    const stamp=ownedRegistrationStamp(fixture,fixtures.runId,policy.revision,Date.now());items.push({Put:{TableName:table,Item:envelope(key,stamp),...cas(null)}});}
   await transact(items);const actual=await get(policyKey);if(!isDeepStrictEqual(actual,next))return fail('OWNER_POLICY_WRITE_UNKNOWN');state.policyInstalled=true;await save();
  }else if(phase==='disable-policy'){
   if(state.policyIntent){const actual=await get(policyKey);const intended=state.policyIntent;
    if(isDeepStrictEqual(actual,intended)){
     const policy=RetentionPolicy.parse(JSON.parse(intended.payload.S));const next=envelope(policyKey,RetentionPolicy.parse({...policy,revision:policy.revision+1,enabled:false}));
     state.policyDisableIntent=next;await save();await transact([{Put:{TableName:table,Item:next,...cas(actual)}}]);
     if(!isDeepStrictEqual(await get(policyKey),next))return fail('OWNER_POLICY_DISABLE_UNKNOWN');state.policyDisabled=true;
    }else if(state.policyDisableIntent&&isDeepStrictEqual(actual,state.policyDisableIntent))state.policyDisabled=true;
    else if(actual===null)state.policyNotApplied=true;else return fail('OWNER_POLICY_CHANGED_BEFORE_CLEANUP');await save();
   }
  }else{
   if(!state.policyInstalled||state.plans.length)return fail('OWNER_PROOF_REPEAT_NOT_RECONCILED');
   for(const fixture of fixtures.fixtures){const exported=await request(fixture,'/account/export');
    if(exported.schemaVersion!==1||exported.account?.status!=='APPROVED'||exported.decisions?.length!==0
     ||Object.keys(exported.account).sort().join('|')!=='displayName|status|version')return fail('OWNER_EXPORT_NOT_SCOPED');state.exports++;}
   for(let index=0;index<2;index++){
    const fixture=fixtures.fixtures[index];const foreign=fixtures.fixtures[1-index];
    const scope=index===0?{kind:'GROUP',groupId:state.groupId}:{kind:'ACCOUNT',subject:fixture.subject};
    const prepared=await owner().prepare(scope,'ops02-'+fixture.nonce);const expected={planHash:prepared.planHash,opId:prepared.opId};
    const plan=loadLifecyclePlan(prepared.bytes,Buffer.from(lifecycle.signingKeyBase64,'base64'),{...expected,sourceSha:lifecycle.sourceSha});
    if(plan.requiredSubjects.length!==1||plan.requiredSubjects[0]!==fixture.subject)return fail('OWNER_PLAN_NOT_SELF_ONLY');
    state.plans.push({nonce:fixture.nonce,scope,expected,bytes:prepared.bytes.toString('base64')});await save();await owner().publishPlan(prepared.bytes,expected);
    const path='/account/erasure/'+expected.opId;
    await request(foreign,path,'GET',undefined,403);state.foreignOwnerDenied++;
    const grant={planHash:expected.planHash,expiresAt:new Date(Date.now()+1200000).toISOString(),revoked:false};
    await request(foreign,path+'/consent','POST',grant,403);state.foreignOwnerDenied++;
    if((await request(fixture,path+'/consent','POST',grant)).granted!==true)return fail('OWNER_GRANT_NOT_RECORDED');
    if((await request(fixture,path+'/consent','POST',{...grant,revoked:true})).granted!==false)return fail('OWNER_REVOCATION_NOT_RECORDED');
    try{await owner().runner(prepared.bytes,expected).advance();return fail('REVOKED_OWNER_EXECUTION_SUCCEEDED');}catch(error){if(error.code!=='LIFECYCLE_AUTHORITY_DENIED')throw error;state.revokedExecutionDenied++;}
    await request(fixture,path+'/consent','POST',grant);
    let current;for(let step=0;step<plan.steps.length+1;step++){current=await owner().runner(prepared.bytes,expected).advance();state.restartSteps++;await save();if(current.state==='ERASED')break;}
    if(current?.state!=='ERASED')return fail('OWNER_ERASURE_INCOMPLETE');
    const repeated=await owner().runner(prepared.bytes,expected).advance();if(!isDeepStrictEqual(current,repeated))return fail('OWNER_ERASURE_REPEAT_CHANGED');
    if((await request(fixture,path)).state!=='ERASED')return fail('OWNER_PROGRESS_NOT_ERASED');state.erased++;await save();
    if(index===0){const groups=await request(fixture,'/groups');if(groups.groups?.some(group=>group.id===state.groupId))return fail('ERASED_GROUP_STILL_VISIBLE');}
    else await request(fixture,'/account/export','GET',undefined,403);
   }
  }
  await save();console.log(JSON.stringify(ownerProofReport(sourceSha,state,phase,'OWNER_PROOF_PHASE_PASS')));
 }catch(error){await save();const awsCode=error?.name;const code=error.safeCode??error.code??(['AccessDeniedException','TransactionCanceledException'].includes(awsCode)?awsCode:'UNCLASSIFIED');
  console.error(JSON.stringify(ownerProofReport(sourceSha,state,phase,'OWNER_PROOF_BLOCKED',code)));process.exitCode=1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await main(process.argv[2]);}catch{console.error(JSON.stringify({result:'OWNER_PROOF_NOT_STARTED',modelCalls:0,realParticipants:0}));process.exitCode=1;}
}
