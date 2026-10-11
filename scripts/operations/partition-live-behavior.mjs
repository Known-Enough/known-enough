import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { createPartitionManagedDriver } from '../../packages/adapters/src/partition-managed.ts';
import { createPartitionedGroupRepository, partitionGroupKey } from '../../packages/adapters/src/partitioned-group-repository.ts';
import { preparePartitionArchive, createPartitionArchiveRunner } from '../../packages/adapters/src/partition-archive.ts';
import { partitionDirectoryKey } from '../../packages/adapters/src/partition-directory.ts';
import { Groups, KnownEnough as KE } from '@deal-table/contracts';
import { createCognitoIdentityResolver } from '../../apps/api/src/cognito-identity.ts';
import { createMailtmClient } from '../live-qa/mailtm.mjs';
import { partitionRecoveryStorage } from './partition-recovery.mjs';
import { verifySource } from './verify.mjs';
const execute = promisify(execFile); const api = 'https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com';
const bucket = 'known-enough-qa-artifacts-092954139775';
const invalid = code => { const error=new Error(code);error.safeCode=code;throw error; };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export function ownFixture(fixture, runId) {
  if (!fixture || fixture.runId !== runId || !uuid(runId) || !uuid(fixture.nonce) || !fixture.mailbox?.address?.startsWith('keqa-')
    || typeof fixture.password !== 'string' || fixture.password.length < 20 || (fixture.subject !== null && !uuid(fixture.subject))) return invalid('OWN_FIXTURE_INVALID');
  return fixture;
}
export function behaviorReport(state, phase, result) {
  const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=256?value:0;
  const phases=['fixtures','behavior','archive','disable','cleanup'];
  const safePhase=phases.includes(phase)?phase:'UNKNOWN';
  const safeResult=result==='BLOCKED'||result==='LIVE_'+safePhase.toUpperCase()+'_PASS'?result:'NOT_VERIFIED';
  return { result:safeResult,phase:safePhase,identities:count(state?.fixtures?.length),signup:count(state?.signup),
    confirmed:count(state?.confirmed),signedLogin:count(state?.signedLogin),apiChecks:count(state?.apiChecks),
    archived:count(state?.archived),selfDeleted:count(state?.selfDeleted),mailboxesRemoved:count(state?.mailboxesRemoved),
    syntheticAccountsDisabled:count(state?.disabled),staleCommitRejected:count(state?.staleCommitRejected),largeDrafts:count(state?.largeDrafts),archiveLostAckRecovered:count(state?.archiveLostAckRecovered),modelCalls:0 };
}

export function visibleGroup(page,groupId,expectedMembers){
  if(!page||!Array.isArray(page.groups))return invalid('LIVE_GROUP_LIST_INVALID');
  const groups=page.groups.map(item=>Groups.GroupSnapshot.parse(item));
  const group=groups.find(item=>item.id===groupId);
  if(expectedMembers===null){if(group)return invalid('LIVE_GROUP_VISIBILITY_LEAK');return null;}
  if(!group||group.members.length!==expectedMembers)return invalid('LIVE_GROUP_MEMBERSHIP_CHANGED');
  return group;
}
export function largeOwnedDrafts(groupVersion){
  return Array.from({length:32},(_,index)=>({id:'ops01-large-'+index,bodyHash:createHash('sha256').update('owned-large-'+index).digest('hex'),revision:1,groupVersion,
    frame:KE.PublicDecisionFrame.parse({schemaVersion:KE.KE_SCHEMA_VERSION,decisionId:'ops01-large-'+index,frameVersion:1,semanticVersion:1,contextToken:'c'.repeat(64),title:'Owned storage check',objective:'x'.repeat(2000),description:'x'.repeat(4000),participants:[{id:'owned-persona',displayName:'Owned persona',requiredForApproval:true}],requiredParticipantIds:['owned-persona'],variables:[],rules:[]}),clarificationQuestions:Array.from({length:12},()=> 'q'.repeat(500)),createdDecisionId:null}));
}
export async function jsonResponse(response) {
  if (!response.body) return {};
  const reader = response.body.getReader(); let length=0;const chunks=[];
  try { while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>100000)return invalid('RESPONSE_LIMIT');chunks.push(Buffer.from(part.value));} }
  finally{await reader.cancel();}
  return length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};
}
async function cognito(operation, body) {
  if(!['SignUp','ConfirmSignUp','InitiateAuth','RespondToAuthChallenge','DeleteUser','GetUser'].includes(operation))return invalid('AUTH_OPERATION_INVALID');
  const response=await globalThis.fetch('https://cognito-idp.us-east-1.amazonaws.com/',{method:'POST',redirect:'error',signal:globalThis.AbortSignal.timeout(10000),
    headers:{'content-type':'application/x-amz-json-1.1','x-amz-target':'AWSCognitoIdentityProviderService.'+operation},body:JSON.stringify(body)});
  const data=await jsonResponse(response);if(!response.ok){const name=String(data.__type??'').split('#').at(-1);const allowed=['InvalidParameterException','NotAuthorizedException','UserNotConfirmedException','CodeMismatchException','UsernameExistsException','UserNotFoundException','TooManyRequestsException'];return invalid('COGNITO_'+operation+'_'+(allowed.includes(name)?name:'UNCLASSIFIED'));}return data;
}
async function srp(config,fixture){
  const require=createRequire(new URL('../live-qa/package.json',import.meta.url));const {CognitoUserPool,CognitoUser,AuthenticationDetails}=require('amazon-cognito-identity-js');
  const pool=new CognitoUserPool({UserPoolId:config.userPoolId,ClientId:config.participantClientId});let calls=0;
  pool.client.request=(operation,body,callback)=>{if(++calls>4){callback(new Error('SRP_REQUEST_LIMIT'));return;}cognito(operation,body).then(data=>callback(null,data),callback);};
  const user=new CognitoUser({Username:fixture.mailbox.address,Pool:pool});
  return await new Promise((resolve,reject)=>{const timer=globalThis.setTimeout(()=>reject(new Error('SRP_TIMEOUT')),30000);user.authenticateUser(new AuthenticationDetails({Username:fixture.mailbox.address,Password:fixture.password}),{
    onSuccess:session=>{globalThis.clearTimeout(timer);resolve(session.getAccessToken().getJwtToken());},onFailure:()=>{globalThis.clearTimeout(timer);reject(new Error('SRP_LOGIN_FAILED'));}});});
}
export function callbackCode(raw,origin,state){
  const url=new URL(raw);
  if(url.origin!==origin||url.searchParams.get('state')!==state||!url.searchParams.get('code'))return invalid('PKCE_CALLBACK_INVALID');
  return url.searchParams.get('code');
}
async function pkce(config,fixture,browser){
  const verifier=randomBytes(32).toString('base64url');const state=randomBytes(24).toString('hex');const redirect=config.allowedOrigin+'/';
  const authorize=new URL(config.cognitoDomain+'/oauth2/authorize');authorize.search=new globalThis.URLSearchParams({client_id:config.participantClientId,response_type:'code',scope:'openid email',redirect_uri:redirect,state,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}).toString();
  const context=await browser.newContext();let page;let step='AUTHORIZE';
  try{
    await context.route(config.allowedOrigin+'/**',async route=>{const url=new URL(route.request().url());if(url.searchParams.get('state')!==state||!url.searchParams.get('code')){await route.abort();return;}await route.fulfill({status:200,contentType:'text/plain',body:'Owned test callback received.'});});
    page=await context.newPage();await page.goto(authorize.href,{timeout:30000});step='LOGIN_FIELDS';await page.locator('input[name="username"]:visible').fill(fixture.mailbox.address);await page.locator('input[name="password"]:visible').fill(fixture.password);
    step='SUBMIT';await page.locator('input[type="submit"]:visible,button[type="submit"]:visible').first().click();step='CALLBACK';await page.waitForURL(url=>url.origin===config.allowedOrigin&&url.searchParams.get('state')===state&&(url.searchParams.has('code')||url.searchParams.has('error')),{timeout:30000});const code=callbackCode(page.url(),config.allowedOrigin,state);
    step='TOKEN_EXCHANGE';const response=await globalThis.fetch(config.cognitoDomain+'/oauth2/token',{method:'POST',redirect:'error',signal:globalThis.AbortSignal.timeout(10000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new globalThis.URLSearchParams({grant_type:'authorization_code',client_id:config.participantClientId,code,redirect_uri:redirect,code_verifier:verifier})});
    const data=await jsonResponse(response);if(!response.ok||typeof data.access_token!=='string')return invalid('PKCE_EXCHANGE_FAILED');return data.access_token;
  }catch(error){if(page){try{const path=join(process.env.RUNNER_TEMP,'partition-cutover-private','signin-'+fixture.nonce+'-private.html');const html=await page.content();if(Buffer.byteLength(html)<500000){await writeFile(path,html,{mode:0o600});await aws('s3api','put-object','--bucket',bucket,'--key','ops01-owned/'+fixture.runId+'/signin-'+fixture.nonce+'-private.html','--body',path,'--server-side-encryption','AES256');}}catch{/* Diagnosis never overrides the login failure. */}}if(error.safeCode)throw error;return invalid('PKCE_'+step+'_FAILED');}finally{await context.close();}
}
async function aws(service,operation,...args){const {stdout}=await execute('aws',[service,operation,...args,'--region','us-east-1','--output','json','--no-cli-pager'],{timeout:20000,maxBuffer:131072});return stdout.trim()?JSON.parse(stdout):{};}
async function role(name){const identity=await aws('sts','get-caller-identity');if(identity.Account!=='092954139775'||!identity.Arn?.startsWith('arn:aws:sts::092954139775:assumed-role/'+name+'/'))return invalid('WORKLOAD_IDENTITY_INVALID');}
async function main(phase){
  const sourceSha=verifySource(process.env);if(!['fixtures','behavior','archive','disable','cleanup'].includes(phase))return invalid('PHASE_INVALID');
  const directory=join(process.env.RUNNER_TEMP,'partition-cutover-private');const statePath=join(directory,'owned-fixtures-private.json');
  const config=JSON.parse(await readFile(join(directory,'configuration-private.json'),'utf8'));const release=JSON.parse(await readFile(join(directory,'release-private.json'),'utf8'));const manifest=await readFile(join(directory,'manifest-private.json'));
  if(config.userPoolId!=='us-east-1_V9OMjd0zx'||config.account!=='092954139775'||config.region!=='us-east-1')return invalid('PRIMARY_IDENTITY_TARGET_INVALID');
  const resolveIdentity=createCognitoIdentityResolver(config);const mailbox=createMailtmClient();
  let state;try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  async function local(){await writeFile(statePath,JSON.stringify(state),{mode:0o600});}
  async function preserve(){await local();await aws('s3api','put-object','--bucket',bucket,'--key','ops01-owned/'+state.runId+'/state-private.json','--body',statePath,'--server-side-encryption','AES256');}
  async function signed(fixture,token){ownFixture(fixture,state.runId);const identity=await resolveIdentity('Bearer '+token);if(identity?.kind!=='participant'||identity.subject!==fixture.subject)return invalid('OWN_SIGNED_IDENTITY_MISMATCH');return identity;}
  async function request(fixture,path,method='GET',body,expected=200){await signed(fixture,fixture.accessToken);const response=await globalThis.fetch(api+path,{method,redirect:'error',signal:globalThis.AbortSignal.timeout(20000),headers:{authorization:'Bearer '+fixture.accessToken,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await jsonResponse(response);state.apiChecks++;if(response.status!==expected)return invalid('LIVE_API_'+response.status+'_'+(data.error?.code??'UNCLASSIFIED'));return data;}
  const managed=()=>createPartitionManagedDriver({manifestBytes:manifest,expected:{sourceSha:release.sourceSha,sourceRevision:release.sourceRevision,sourceHash:release.sourceHash,manifestHash:release.manifestHash},manifestVersion:release.manifestVersion,verifiedTarget:{account:'092954139775',region:'us-east-1'},cursorKey:Buffer.from(config.cursorKeyBase64,'base64')});
  async function status(fixture,value){await signed(fixture,fixture.accessToken);const repo=createPartitionedGroupRepository(managed().groups);await repo.transaction({accountSubjects:[fixture.subject]},snapshot=>{const account=snapshot.accounts.find(item=>item.subject===fixture.subject);if(!account)return invalid('OWN_ACCOUNT_MISSING');if(account.status!==value){account.status=value;account.version++;}});}
  try{
    if(phase==='fixtures'){
      await role('KnownEnoughGithubQaRelease');if(state)return invalid('FIXTURE_CREATION_ALREADY_RECORDED');
      state={sourceSha,runId:randomUUID(),fixtures:[],signup:0,confirmed:0,signedLogin:0,apiChecks:0,archived:0,selfDeleted:0,mailboxesRemoved:0,disabled:0};
      for(let index=0;index<2;index++)state.fixtures.push({runId:state.runId,nonce:randomUUID(),subject:null,password:randomBytes(20).toString('base64url')+'aA1!',mailbox:await mailbox.intent(state.runId),created:false});
      await local();await aws('s3api','put-object','--bucket',bucket,'--key','ops01-owned/'+state.runId+'/intent-private.json','--body',statePath,'--server-side-encryption','AES256','--if-none-match','*');
      const browser=await chromium.launch({headless:true});
      try{for(const fixture of state.fixtures){ownFixture(fixture,state.runId);fixture.mailbox=await mailbox.create(fixture.mailbox);await preserve();fixture.signupIntent=true;await preserve();
        const created=await cognito('SignUp',{ClientId:config.participantClientId,Username:fixture.mailbox.address,Password:fixture.password,UserAttributes:[{Name:'email',Value:fixture.mailbox.address}]});if(!uuid(created.UserSub))return invalid('SIGNUP_SUBJECT_INVALID');fixture.subject=created.UserSub;fixture.created=true;state.signup++;await preserve();
        let code;for(let count=0;count<3&&!code;count++)code=await mailbox.code(fixture.mailbox);if(!code)return invalid('VERIFICATION_MAIL_NOT_OBSERVED');
        await cognito('ConfirmSignUp',{ClientId:config.participantClientId,Username:fixture.mailbox.address,ConfirmationCode:code});state.confirmed++;await preserve();
        fixture.cleanupToken=await srp(config,fixture);await signed(fixture,fixture.cleanupToken);await preserve();
        fixture.accessToken=await pkce(config,fixture,browser);await signed(fixture,fixture.accessToken);state.signedLogin++;await preserve();
        const registered=await request(fixture,'/account/register','POST',{displayName:'OPS01 owned test'});if(registered.account?.status!=='PENDING')return invalid('REGISTRATION_ADMISSION_CHANGED');fixture.registered=true;await preserve();await request(fixture,'/groups','GET',undefined,403);
      }}finally{await browser.close();}
    }else{
      if(!state||state.sourceSha!==sourceSha||state.fixtures.length!==2)return invalid('FIXTURE_STATE_INVALID');state.fixtures.forEach(item=>ownFixture(item,state.runId));
      if(phase==='behavior'){
        await role('KnownEnoughGithubPartitionMigration');for(const fixture of state.fixtures)await status(fixture,'APPROVED');
        const groups=await Promise.all(state.fixtures.map((fixture,index)=>request(fixture,'/groups','POST',{name:'OPS01 owned group '+index,idempotencyKey:'ops01-'+fixture.nonce})));
        for(let index=0;index<2;index++){state.fixtures[index].groupId=groups[index].group.id;}await local();
        const [organizer,member]=state.fixtures;visibleGroup(await request(member,'/groups'),organizer.groupId,null);
        const invite=await request(organizer,'/groups/'+organizer.groupId+'/invitations','POST',{email:member.mailbox.address,replace:false});
        const accepted=await request(member,'/groups/accept','POST',{token:invite.token});if(accepted.group?.members.length!==2)return invalid('LIVE_MEMBERSHIP_NOT_RETAINED');
        visibleGroup(await request(member,'/groups'),organizer.groupId,2);
        const staleDriver=managed();const staleRepo=createPartitionedGroupRepository(staleDriver.groups);
        const staleAccount=await staleRepo.fence({accountSubjects:[organizer.subject,member.subject],groupId:organizer.groupId},()=>{});
        await status(member,'DISABLED');if(await staleDriver.groups.commit(staleAccount.mutations))return invalid('LIVE_STALE_ACCOUNT_COMMIT_ACCEPTED');state.staleCommitRejected=(state.staleCommitRejected??0)+1;
        await request(member,'/groups','GET',undefined,403);await status(member,'APPROVED');
        const current=visibleGroup(await request(organizer,'/groups'),organizer.groupId,2);const removed=current.members.find(item=>!item.isOrganizer);
        const staleMember=await staleRepo.fence({accountSubjects:[organizer.subject,member.subject],groupId:organizer.groupId},()=>{});await request(organizer,'/groups/'+organizer.groupId+'/remove','POST',{memberId:removed.id,version:current.version});visibleGroup(await request(member,'/groups'),organizer.groupId,null);await request(member,'/groups/accept','POST',{token:invite.token},404);if(await staleDriver.groups.commit(staleMember.mutations))return invalid('LIVE_STALE_MEMBER_COMMIT_ACCEPTED');state.staleCommitRejected++;
        const largeRepo=createPartitionedGroupRepository(managed().groups);await largeRepo.transaction({accountSubjects:[member.subject],groupId:member.groupId},snapshot=>{const group=snapshot.groups.find(item=>item.id===member.groupId);if(!group||group.organizer!==member.subject)return invalid('OWN_LARGE_GROUP_INVALID');group.drafts=largeOwnedDrafts(group.version);});state.largeDrafts=32;
        const largeSnapshot=await createPartitionedGroupRepository(managed().groups).transaction({accountSubjects:[member.subject],groupId:member.groupId},snapshot=>snapshot.groups.find(item=>item.id===member.groupId));if(!largeSnapshot||largeSnapshot.drafts.length!==32||Buffer.byteLength(JSON.stringify(largeSnapshot))<=300000)return invalid('LIVE_LARGE_GROUP_NOT_RECONSTRUCTED');
        const driver=managed();state.archives=[];
        for(const fixture of state.fixtures){const key=partitionGroupKey(fixture.groupId);const header=await driver.groups.read(key);if(header?.kind!=='GROUP'||header.value.organizer!==fixture.subject)return invalid('OWN_GROUP_ARCHIVE_MISMATCH');
          const entries=[{key,row:header}];for(const draftId of header.value.draftIds){const child={PK:key.PK,SK:'DRAFT#'+draftId};entries.push({key:child,row:await driver.groups.read(child)});}for(const invitation of header.value.invitations){const child=partitionDirectoryKey({type:'INVITATION',groupId:fixture.groupId,tokenHash:invitation.tokenHash,recipientHash:invitation.recipientHash,expiresAt:invitation.expiresAt});entries.push({key:child,row:await driver.groups.read(child)});}
          const plan=preparePartitionArchive(entries,fixture.groupId,sourceSha);const expected={sourceSha,groupId:fixture.groupId,sourceHeaderRevision:header.revision,sourceHash:plan.sourceHash,manifestHash:plan.manifestHash};
          await writeFile(join(directory,'archive-'+fixture.nonce+'-private.json'),plan.manifestBytes,{mode:0o600,flag:'wx'});state.archives.push({nonce:fixture.nonce,expected});
        }await local();
      }else if(phase==='archive'){
        await role('KnownEnoughGithubGroupArchive');if(state.archives?.length!==2)return invalid('ARCHIVE_PLANS_MISSING');
        for(const fixture of state.fixtures){await signed(fixture,fixture.accessToken);const archive=state.archives.find(item=>item.nonce===fixture.nonce);const bytes=await readFile(join(directory,'archive-'+fixture.nonce+'-private.json'));const authority={kind:'ORGANIZER',subject:fixture.subject};
          const ports=managed().archivePorts({manifestBytes:bytes,expected:archive.expected,authority,recovery:partitionRecoveryStorage()});const make=()=>createPartitionArchiveRunner(ports,bytes,archive.expected,authority);await make().prepare();let lost=false;const faultPorts={...ports,commit:async(request,context)=>{const committed=await ports.commit(request,context);if(committed){lost=true;throw new Error('OWN_ARCHIVE_ACK_DROPPED');}return committed;}};
          try{await createPartitionArchiveRunner(faultPorts,bytes,archive.expected,authority).archive();return invalid('LIVE_ARCHIVE_LOST_ACK_NOT_EXERCISED');}catch(error){if(!lost||error.code!=='ARCHIVE_COMMIT_UNKNOWN')throw error;}
          const reconstructed=await make().archive();if(reconstructed.state!=='ARCHIVED')return invalid('LIVE_ARCHIVE_LOST_ACK_NOT_RECOVERED');state.archiveLostAckRecovered=(state.archiveLostAckRecovered??0)+1;await make().archive();state.archived++;await local();
          visibleGroup(await request(fixture,'/groups'),fixture.groupId,null);
        }
      }else if(phase==='disable'){
        await role('KnownEnoughGithubPartitionMigration');for(const fixture of state.fixtures){if(fixture.registered&&fixture.accessToken){await status(fixture,'DISABLED');state.disabled++;await local();}}
      }else if(phase==='cleanup'){
        await role('KnownEnoughGithubQaRelease');for(const fixture of state.fixtures){if(fixture.created&&!fixture.deleted){if(!fixture.cleanupToken){fixture.cleanupToken=await srp(config,fixture);}await signed(fixture,fixture.cleanupToken);fixture.deleteIntent=true;await preserve();await cognito('DeleteUser',{AccessToken:fixture.cleanupToken});fixture.deleted=true;state.selfDeleted++;await preserve();}if(fixture.mailbox.id&&!fixture.mailboxRemoved&&(!fixture.signupIntent||fixture.deleted)){await mailbox.remove(fixture.mailbox);fixture.mailboxRemoved=true;state.mailboxesRemoved++;await preserve();}}if(state.fixtures.some(item=>item.signupIntent&&!item.deleted))return invalid('FIXTURE_SIGNUP_CLEANUP_UNRESOLVED');
      }
    }
    await local();console.log(JSON.stringify({sourceSha,...behaviorReport(state,phase,'LIVE_'+phase.toUpperCase()+'_PASS')}));
  }catch(error){if(state)await local();const observed=error.safeCode??error.code;const code=typeof observed==='string'&&/^[A-Za-z0-9_]{1,120}$/.test(observed)?observed:'UNCLASSIFIED';console.error(JSON.stringify({sourceSha,...behaviorReport(state,phase,'BLOCKED'),code}));process.exitCode=1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{await main(process.argv[2]);}catch{console.error(JSON.stringify({result:'LIVE_SETUP_NOT_VERIFIED'}));process.exitCode=1;}}
