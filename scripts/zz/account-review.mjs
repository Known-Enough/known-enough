/** Private administrator tooling; no public endpoint or provider-profile output. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Groups } from '@deal-table/contracts';
import { createPartitionManagedDriver } from '@deal-table/adapters/partition-request';
import { createPartitionedGroupRepository } from '../../packages/adapters/src/partitioned-group-repository.ts';
const account='092954139775',region='us-east-1',pool='us-east-1_V9OMjd0zx',functionName='known-enough-stage-api';
const [mode,expectedHash,selectionFile,indexText]=process.argv.slice(2);
const fail=()=>{throw Error('PRIVATE_ACCOUNT_REVIEW_NOT_VERIFIED');};
function aws(service,operation,input={}){
 try{return JSON.parse(execFileSync('aws',[service,operation,'--region',region,'--cli-input-json',JSON.stringify(input),'--output','json','--no-cli-pager'],{maxBuffer:4*1024*1024,timeout:30000,stdio:['ignore','pipe','pipe']}).toString()||'{}');}
 catch{throw Error('PRIVATE_REVIEW_AWS_OPERATION_FAILED');}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))try{
 if(!['list','approve','reject','backfill'].includes(mode)||!/^[a-f0-9]{64}$/.test(expectedHash??''))fail();
 if(aws('sts','get-caller-identity').Account!==account)fail();
 process.umask(0o077);const directory=mkdtempSync(join(tmpdir(),'known-enough-private-review-'));
 const functionInfo=aws('lambda','get-function',{FunctionName:functionName});
 if(functionInfo.Configuration?.FunctionArn!==`arn:aws:lambda:${region}:${account}:function:${functionName}`
  ||Buffer.from(functionInfo.Configuration.CodeSha256,'base64').toString('hex')!==expectedHash)fail();
 const url=URL.parse(functionInfo.Code?.Location??'');if(!url||url.protocol!=='https:'||!url.hostname.endsWith('.amazonaws.com'))fail();
 const response=await globalThis.fetch(url,{redirect:'error',signal:globalThis.AbortSignal.timeout(30000)});if(!response.ok)fail();
 const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>2*1024*1024||createHash('sha256').update(bytes).digest('hex')!==expectedHash)fail();
 const zip=join(directory,'runtime-private.zip');writeFileSync(zip,bytes,{mode:0o600});
 const entries=execFileSync('unzip',['-Z1',zip],{stdio:['ignore','pipe','pipe']}).toString().trim().split('\n');
 if(entries.some(path=>!/^[-A-Za-z0-9_.]+$/.test(path)))fail();
 execFileSync('unzip',['-q',zip,'-d',directory],{stdio:['ignore','pipe','pipe']});
 const config=JSON.parse(readFileSync(join(directory,'configuration-private.json'))),release=JSON.parse(readFileSync(join(directory,'release-private.json')));
 if(config.account!==account||config.region!==region||config.userPoolId!==pool)fail();
 const driver=createPartitionManagedDriver({manifestBytes:readFileSync(join(directory,'manifest-private.json')),
  expected:{sourceSha:release.sourceSha,sourceRevision:release.sourceRevision,sourceHash:release.sourceHash,manifestHash:release.manifestHash},
  manifestVersion:release.manifestVersion,verifiedTarget:{account,region},cursorKey:Buffer.from(config.cursorKeyBase64,'base64')});
 const users=[];let token;
 for(let page=0;page<8;page++){
  const result=aws('cognito-idp','list-users',{UserPoolId:pool,Limit:60,...(token?{PaginationToken:token}:{})});users.push(...result.Users);token=result.PaginationToken;if(!token)break;
 }
 if(token)fail();const pending=[];let unverified=0,notQueued=0,backfilled=0;
 for(const user of users){
  const attrs=Object.fromEntries(user.Attributes.map(a=>[a.Name,a.Value]));
  if(user.UserStatus!=='CONFIRMED'||attrs.email_verified!=='true'){unverified++;continue;}
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(attrs.sub??''))fail();
  const key={PK:'ACCOUNT#'+attrs.sub,SK:'STATE'};const raw=await driver.groups.read(key);
  if(raw===null){notQueued++;if(mode==='backfill'){
   const {createPartitionGroupSession}=await import('@deal-table/adapters/partition-request');
   await createPartitionGroupSession(driver.groups,{emailKey:config.emailKey}).register({kind:'participant',subject:attrs.sub},
    {subject:attrs.sub,email:attrs.email,verified:true,username:user.Username},{displayName:'New member'});backfilled++;}continue;}
  if(raw.kind!=='ACCOUNT')continue;const value=Groups.Account.parse(raw.value);
  if(value.subject!==attrs.sub)fail();
  if(value.status==='PENDING')pending.push({subject:value.subject,version:value.version,loginUsername:user.Username,displayName:value.displayName});
 }
 const file=join(directory,'pending-private.json');writeFileSync(file,JSON.stringify({expectedHash,pending},null,2),{mode:0o600});
 if(mode==='approve'||mode==='reject'){
  const fileInfo=lstatSync(selectionFile??'');if(!fileInfo.isFile()||fileInfo.isSymbolicLink()||(fileInfo.mode&0o077)!==0||fileInfo.uid!==process.getuid())fail();
  const selection=JSON.parse(readFileSync(selectionFile));if(selection.expectedHash!==expectedHash||!Array.isArray(selection.pending))fail();
  const index=Number(indexText);if(!Number.isSafeInteger(index)||index<0||!selection.pending[index])fail();
  const selected=selection.pending[index];if(!/^[A-Za-z0-9_-]{1,80}$/.test(selected.subject)||!Number.isSafeInteger(selected.version)||selected.version<1)fail();
  const status=mode==='approve'?'APPROVED':'REJECTED';
  // Fresh guarded native account/source transaction; no browser/operator assertion changes identity.
  try { await createPartitionedGroupRepository(driver.groups).transaction({accountSubjects:[selected.subject]},state=>{
   const value=state.accounts.find(a=>a.subject===selected.subject);if(!value||value.status!=='PENDING'||value.version!==selected.version)fail();value.status=status;value.version++;
  }); } catch { /* Lost acknowledgment: one fresh exact read, no reissued admission write. */ }
  const got=await driver.groups.read({PK:'ACCOUNT#'+selected.subject,SK:'STATE'});
  if(got?.kind!=='ACCOUNT'||got.value.status!==status||got.value.version!==selected.version+1)fail();
 }
 console.log(JSON.stringify({result:'PRIVATE_ACCOUNT_REVIEW_PASS',pending:pending.length,unverified,notQueued,backfilled,operation:mode,privateQueueFile:file,providerCalls:0}));
}catch{console.error(JSON.stringify({result:'PRIVATE_ACCOUNT_REVIEW_NOT_VERIFIED',providerCalls:0}));process.exitCode=1;}
