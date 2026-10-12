import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createMailtmClient } from '../live-qa/mailtm.mjs';
import { ownFixture } from './partition-live-behavior.mjs';
const execute=promisify(execFile);
export const ORIGINAL_SOURCE='246a1d8552810e46efdc635ba956ed459bbd9ad2';
export const ORIGINAL_KEY='ops01-owned/1ea949f1-4fc2-4bc5-981c-371819e8d57b/state-private.json';
const invalid=code=>{throw new Error(code);};
export async function recoverMailbox(state,key,mail,save){
 if(key!==ORIGINAL_KEY||state.sourceSha!==ORIGINAL_SOURCE||key!=='ops01-owned/'+state.runId+'/state-private.json'||state.fixtures?.length!==2)invalid('ORIGINAL_CHECKPOINT_MISMATCH');
 for(const f of state.fixtures){ownFixture(f,state.runId);if(f.mailbox.runId!==state.runId||typeof f.mailbox.password!=='string'||f.mailbox.password.length<20)invalid('ORIGINAL_MAILBOX_INTENT_INVALID');if(f.signupIntent&&!f.deleted)invalid('COGNITO_CLEANUP_NOT_CONFIRMED');}
 const pending=state.fixtures.filter(f=>!f.mailboxRemoved);
 if(pending.length>1||state.fixtures.filter(f=>f.deleted).length!==1)invalid('ORIGINAL_CLEANUP_SHAPE_CHANGED');
 for(const fixture of pending){
  if(!fixture.mailbox.id){fixture.mailbox=await mail.recoverExistingIntent(fixture.mailbox);await save(state);}
  fixture.mailboxDeleteIntent=true;await save(state);
  await mail.remove(fixture.mailbox);
  fixture.mailboxRemoved=true;state.mailboxesRemoved=(state.mailboxesRemoved??0)+1;await save(state);
 }
 return {result:'ORIGINAL_MAILBOX_CLEANUP_PASS',reconciledMailboxes:pending.length,knownDeletedUsers:1,knownRemovedMailboxes:state.fixtures.filter(f=>f.mailboxRemoved).length,unconfirmedMailboxIntents:0,signup:0,providerCalls:0};
}
async function main(){
 const directory=process.env.RUNNER_TEMP,bucket='known-enough-qa-artifacts-092954139775';
 const target=join(directory,'original-mailbox-checkpoint-private.json');let operation='sts:GetCallerIdentity';
 const aws=async(...args)=>{try{const {stdout}=await execute('aws',[...args,'--region','us-east-1','--output','json','--no-cli-pager'],{timeout:30000,maxBuffer:262144});return JSON.parse(stdout||'{}');}catch(error){const match=error.stderr?.match(/\(([A-Za-z0-9]+)\)/);throw new Error(match?.[1]??'AWS_REQUEST_FAILED',{cause:error});}};
 let report={result:'ORIGINAL_MAILBOX_CLEANUP_BLOCKED',signup:0,providerCalls:0};let httpStatus=null;
 try{
  const identity=await aws('sts','get-caller-identity');if(identity.Account!=='092954139775'||!identity.Arn?.startsWith('arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubQaRelease/'))invalid('OWN_QA_ROLE_REQUIRED');
  operation='s3:GetObject';const read=await aws('s3api','get-object','--bucket',bucket,'--key',ORIGINAL_KEY,target);let etag=read.ETag;
  if(typeof etag!=='string')invalid('CHECKPOINT_ETAG_MISSING');
  const state=JSON.parse(await readFile(target,'utf8'));
  const save=async(value)=>{operation='s3:PutObject';await writeFile(target,JSON.stringify(value),{mode:0o600});const result=await aws('s3api','put-object','--bucket',bucket,'--key',ORIGINAL_KEY,'--body',target,'--server-side-encryption','AES256','--if-match',etag);if(typeof result.ETag!=='string')invalid('CHECKPOINT_WRITE_ACK_UNKNOWN');etag=result.ETag;operation='mailbox:authenticate-or-delete';};
  const mail=createMailtmClient(async(url,options)=>{const path=new globalThis.URL(url).pathname;operation=path==='/token'?'mailbox:POST-token':path==='/me'?'mailbox:GET-me':options.method==='DELETE'?'mailbox:DELETE-owned-account':'mailbox:GET-owned-account';httpStatus=null;const response=await globalThis.fetch(url,options);httpStatus=response.status;return response;});
  operation='mailbox:authenticate-or-delete';report=await recoverMailbox(state,ORIGINAL_KEY,mail,save);
 }catch(error){const code=/^[A-Za-z0-9_]{1,100}$/.test(error.message)?error.message:'UNCLASSIFIED';report={...report,operation,code,...(Number.isInteger(httpStatus)?{httpStatus}:{})};}
 report.sourceSha=process.env.GITHUB_SHA;report.originalSource=ORIGINAL_SOURCE;
 await writeFile(join(directory,'original-mailbox-cleanup-report.json'),JSON.stringify(report)+'\n');console.log(JSON.stringify(report));if(report.result!=='ORIGINAL_MAILBOX_CLEANUP_PASS')process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
