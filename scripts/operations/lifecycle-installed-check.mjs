import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { RetentionPolicy } from '../../packages/adapters/src/partition-lifecycle.ts';
import { accessProfiles } from './access-setup.mjs';
import { verifySource } from './verify.mjs';
const execute=promisify(execFile);
const roles={retention:'KnownEnoughGithubRetentionPolicy',erasure:'KnownEnoughGithubLifecycleExecutor',owner:'KnownEnoughGithubStagingInspector'};
const journal='KnownEnoughOperationsJournal';
const safeError=error=>['AccessDeniedException','AccessDenied','ResourceNotFoundException','TimeoutError','NoSuchEntity'].includes(error?.name)?error.name:'UNCLASSIFIED';
export async function lifecycleReadProof(send,phase,nonce){
 if(!['retention','erasure'].includes(phase)||typeof send!=='function'||!/^[a-f0-9-]{36}$/.test(nonce))throw new Error('LIFECYCLE_CHECK_INVALID');
 const signal=globalThis.AbortSignal.timeout(20000);const results=[];let policyState='UNKNOWN';
 const key=(PK,SK)=>({PK:{S:PK},SK:{S:SK}});
 const checks=[{id:'retentionPolicy',command:new GetItemCommand({TableName:journal,Key:key('OPERATIONS#RETENTION','STATE'),ConsistentRead:true})},
 {id:'ownedTimestamp',command:new GetItemCommand({TableName:journal,Key:key('RETENTION#ops02-'+nonce,'STAMP'),ConsistentRead:true})}];
 if(phase==='erasure')checks.push({id:'ownedConsent',command:new GetItemCommand({TableName:journal,Key:key('CONSENT#ops02-'+nonce,'SUBJECT#ops02-'+nonce),ConsistentRead:true})},
 {id:'ownedProgress',command:new GetItemCommand({TableName:journal,Key:key('LIFECYCLE#ops02-'+nonce,'PLAN'),ConsistentRead:true})},
 {id:'ownedMembershipInventory',command:new QueryCommand({TableName:'KnownEnoughPartitions',KeyConditionExpression:'PK = :pk',ExpressionAttributeValues:{':pk':{S:'MEMBER#ops02-'+nonce}},ConsistentRead:true,Limit:1})});
 for(const check of checks){try{const reply=await send(check.command,{abortSignal:signal});
  if(check.id==='retentionPolicy'){if(!reply.Item)policyState='ABSENT';else{const raw=RetentionPolicy.safeParse(JSON.parse(reply.Item.payload?.S??'null'));policyState=raw.success?(raw.data.enabled?'ENABLED_SYNTHETIC':'DISABLED_SYNTHETIC'):'INVALID';}}
  else if(reply.Item||(reply.Items?.length??0)>0)throw Object.assign(new Error(),{name:'UNEXPECTED_COLLISION'});
  results.push({capability:check.id,result:'READ_ALLOWED'});
 }catch(error){results.push({capability:check.id,result:'READ_FAILED',code:safeError(error)});}}
 return {result:results.every(item=>item.result==='READ_ALLOWED')?'LIFECYCLE_READ_ACCESS_PASS':'LIFECYCLE_READ_ACCESS_INCOMPLETE',policyState,requests:checks.length,mutations:0,checks:results};
}
export function ownerPolicyProof(document){return {result:isDeepStrictEqual(document,accessProfiles().ownerRuntime)?'OWNER_POLICY_CONFIGURATION_MATCH':'OWNER_POLICY_CONFIGURATION_MISMATCH',mutations:0,effectiveOwnerOperation:'NOT_EXECUTED'};}
async function main(){const phase=process.argv[2];if(!roles[phase])throw new Error('LIFECYCLE_PHASE_INVALID');const sourceSha=verifySource(process.env);
 const command=async(args)=>{const {stdout}=await execute('aws',[...args,'--region','us-east-1','--output','json','--no-cli-pager'],{timeout:15000,maxBuffer:65536});return JSON.parse(stdout);};
 const identity=await command(['sts','get-caller-identity']);if(identity.Account!=='092954139775'||!identity.Arn?.startsWith('arn:aws:sts::092954139775:assumed-role/'+roles[phase]+'/'))throw new Error('LIFECYCLE_IDENTITY_INVALID');
 let result;if(phase==='owner'){const policy=await command(['iam','get-role-policy','--role-name','KnownEnoughStageApiRole','--policy-name','KnownEnoughLifecycleOwner']);result=ownerPolicyProof(policy.PolicyDocument);}else{const client=new DynamoDBClient({region:'us-east-1',endpoint:'https://dynamodb.us-east-1.amazonaws.com',maxAttempts:1});result=await lifecycleReadProof(client.send.bind(client),phase,randomUUID());}
 console.log(JSON.stringify({sourceSha,account:'092954139775',region:'us-east-1',phase,...result,participantAction:'NOT_EXECUTED',deployment:'UNCHANGED'}));if(!['LIFECYCLE_READ_ACCESS_PASS','OWNER_POLICY_CONFIGURATION_MATCH'].includes(result.result))process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{await main();}catch{console.error(JSON.stringify({result:'LIFECYCLE_INSTALLED_READBACK_NOT_VERIFIED',mutations:0}));process.exitCode=1;}}
