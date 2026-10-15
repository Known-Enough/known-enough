import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { createPartitionManagedDriver } from '../../packages/adapters/src/partition-managed.ts';
import { partitionRecoveryStorage } from '../operations/partition-recovery.mjs';
import { preparePartitionArchive,createPartitionArchiveRunner } from '../../packages/adapters/src/partition-archive.ts';
import { createPartitionedGroupRepository } from '../../packages/adapters/src/partitioned-group-repository.ts';
import { createCognitoIdentityResolver } from '../../apps/api/src/cognito-identity.ts';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ownFixture } from '../operations/partition-live-behavior.mjs';
import { ownedArchiveEntries,archiveFailureCode,archiveInputChecks,archiveExceptionMetadata,archivePolicyOutput } from './owned-archive.mjs';
const directory=join(process.env.RUNNER_TEMP,'partition-cutover-private');
const report={source:process.env.EXPECTED_SOURCE,utc:new Date().toISOString(),result:'NOT_EXECUTED',groupCreate:'NOT_EXECUTED',draft:'NOT_EXECUTED',providerCalls:'NOT_VERIFIED',unauthorized:'NOT_EXECUTED',reload:'NOT_EXECUTED'};
let browser;
try {
 const config=JSON.parse(await readFile(join(directory,'configuration-private.json'),'utf8'));
 const release=JSON.parse(await readFile(join(directory,'release-private.json'),'utf8'));
 const state=JSON.parse(await readFile(join(directory,'owned-fixtures-private.json'),'utf8'));
 const original=process.argv[2]==='archive-original';
 if(state.sourceSha!==(original?'6b6aa79070689caf17568fb59ee5dc3d677effe4':process.env.EXPECTED_SOURCE)||config.account!=='092954139775'||config.region!=='us-east-1'||config.allowedOrigin!=='https://main.d143q5ravxp5av.amplifyapp.com')throw new Error('OWN_TARGET_MISMATCH');
 const fixture=state.fixtures.find(item=>original?item.groupId:item.accessToken&&item.created&&!item.deleted);ownFixture(fixture,state.runId);
 if(original){
  if(state.sourceSha!=='6b6aa79070689caf17568fb59ee5dc3d677effe4'||state.fixtures.length!==2||state.fixtures.some(f=>!f.deleted||!f.mailboxRemoved)||process.env.GITHUB_ACTOR_ID!=='143764700')throw new Error('OWN_TARGET_MISMATCH');
  const result=await promisify(execFile)('aws',['sts','get-caller-identity','--region','us-east-1','--output','json','--no-cli-pager'],{timeout:20000});const identity=JSON.parse(result.stdout);
  if(identity.Account!=='092954139775'||!identity.Arn.startsWith('arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubGroupArchive/'))throw new Error('OWN_TARGET_MISMATCH');
 }else{
  const identity=await createCognitoIdentityResolver(config)('Bearer '+fixture.accessToken);
  if(identity?.kind!=='participant'||identity.subject!==fixture.subject)throw new Error('OWN_SIGNED_IDENTITY_MISMATCH');
 }
 const manifest=await readFile(join(directory,'manifest-private.json'));
 const managed=createPartitionManagedDriver({manifestBytes:manifest,expected:{sourceSha:release.sourceSha,sourceRevision:release.sourceRevision,sourceHash:release.sourceHash,manifestHash:release.manifestHash},manifestVersion:release.manifestVersion,verifiedTarget:{account:'092954139775',region:'us-east-1'},cursorKey:Buffer.from(config.cursorKeyBase64,'base64')});
 if(process.argv[2]==='archive'||original) {
  if(!fixture.groupId){report.result='NO_OWN_GROUP_TO_ARCHIVE';}
  else {
   report.archiveStage='READ_OWNED_ROWS';
   const {header,entries}=await ownedArchiveEntries(managed.groups,fixture.groupId,fixture.subject,state.fixtures.map(owned=>owned.subject));
   report.archiveInput=archiveInputChecks(header,entries);
   report.archiveStage='COMPILE_PLAN';
   const plan=preparePartitionArchive(entries,fixture.groupId,process.env.EXPECTED_SOURCE);
   const expected={sourceSha:process.env.EXPECTED_SOURCE,groupId:fixture.groupId,sourceHeaderRevision:header.revision,sourceHash:plan.sourceHash,manifestHash:plan.manifestHash};
   const authority=original?{kind:'OPERATOR',actorId:143764700}:{kind:'ORGANIZER',subject:fixture.subject};
   if(original){
    report.archiveStage='READ_OPERATOR_POLICY';
    const result=await promisify(execFile)('aws',['dynamodb','get-item','--table-name','KnownEnoughPartitions','--key',JSON.stringify({PK:{S:'OPERATIONS#ARCHIVE'},SK:{S:'STATE'}}),'--consistent-read','--region','us-east-1','--output','json','--no-cli-pager'],{timeout:20000});
    report.operatorPolicy=archivePolicyOutput(result.stdout);
   }
   report.archiveStage='BUILD_PORTS';
   const runner=createPartitionArchiveRunner(managed.archivePorts({manifestBytes:plan.manifestBytes,expected,authority,recovery:partitionRecoveryStorage()}),plan.manifestBytes,expected,authority);
   report.archiveStage='PREPARE_ARCHIVE';await runner.prepare();report.archiveStage='COMMIT_ARCHIVE';const result=await runner.archive();if(result.state!=='ARCHIVED')throw new Error('OWN_ARCHIVE_NOT_CONFIRMED');report.result='OWN_PROOF_GROUP_ARCHIVED';report.archivedGroups=1;
  }
 } else {
 for(const owned of state.fixtures){ownFixture(owned,state.runId);const signed=await createCognitoIdentityResolver(config)('Bearer '+owned.accessToken);if(signed?.kind!=='participant'||signed.subject!==owned.subject)throw new Error('OWN_SIGNED_IDENTITY_MISMATCH');}
 for(const owned of state.fixtures) await createPartitionedGroupRepository(managed.groups).transaction({accountSubjects:[owned.subject]},snapshot=>{
  const account=snapshot.accounts.find(item=>item.subject===owned.subject);
  if(!account||account.status!=='PENDING')throw new Error('OWN_PENDING_ACCOUNT_REQUIRED');account.status='APPROVED';account.version++;
 });
 browser=await chromium.launch();const context=await browser.newContext();
 await context.addInitScript(session=>globalThis.sessionStorage.setItem('known-enough-cognito-session',JSON.stringify(session)),{accessToken:fixture.accessToken,kind:'participant',expiresAt:Date.now()+300000});
 const page=await context.newPage();await page.goto(config.allowedOrigin,{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Create group',exact:true}).click();await page.getByLabel('New group name').fill('FIX01 owned draft check');
 const create=page.waitForResponse(r=>new URL(r.url()).pathname==='/groups'&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Create group',exact:true}).last().click();const groupResponse=await create;
 report.groupCreate={status:groupResponse.status()};
 const group=await groupResponse.json();if(groupResponse.status()!==200||!group.group?.id)throw new Error('OWN_GROUP_CREATE_FAILED');
 fixture.groupId=group.group.id;await writeFile(join(directory,'owned-fixtures-private.json'),JSON.stringify(state),{mode:0o600});
 const outsider=state.fixtures.find(item=>item.subject!==fixture.subject);if(!outsider)throw new Error('OWN_SECOND_ACCOUNT_REQUIRED');
 const denied=await globalThis.fetch('https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com/groups/'+fixture.groupId+'/drafts',{method:'POST',headers:{authorization:'Bearer '+outsider.accessToken,'content-type':'application/json'},body:JSON.stringify({objective:'Synthetic unauthorized objective',idempotencyKey:randomUUID()})});
 if(![403,404].includes(denied.status))throw new Error('UNAUTHORIZED_DRAFT_NOT_DENIED');report.unauthorized={status:denied.status};
 const unauth=await globalThis.fetch('https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com/groups/'+fixture.groupId+'/draft-requests');if(unauth.status!==401)throw new Error('UNAUTHENTICATED_RECOVERY_NOT_DENIED');report.unauthenticated=401;
 const signedRequest=async(person,path,body)=>{const response=await globalThis.fetch('https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+person.accessToken,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();if(response.status!==200)throw new Error('OWN_MEMBER_VISIBILITY_FAILED');return value;};
 const invitation=await signedRequest(fixture,'/groups/'+fixture.groupId+'/invitations',{email:outsider.mailbox.address,replace:false});
 const accepted=await signedRequest(outsider,'/groups/accept',{token:invitation.token});if(accepted.group?.members.length!==2||accepted.group?.isOrganizer!==false)throw new Error('OWN_MEMBER_VISIBILITY_FAILED');report.memberJoin='PASS';

 await page.getByRole('button',{name:'Start a decision',exact:true}).click();
 await page.getByLabel('Tell me what you want to decide').fill('Choose a synthetic garden workday. There are two public choices: activity is planting or watering; time is morning or afternoon. All named group members must approve. There are no extra public constraints, real availability, private needs, or unresolved public questions. Generate these two enum choices for review.');
 const draft=page.waitForResponse(r=>new URL(r.url()).pathname===`/groups/${fixture.groupId}/drafts`&&r.request().method()==='POST',{timeout:25000});
 await page.getByRole('button',{name:'Continue with AI',exact:true}).click();const draftResponse=await draft;
 const body=await draftResponse.json().catch(()=>({}));fixture.draftRequestKey=draftResponse.request().postDataJSON().idempotencyKey;await writeFile(join(directory,'owned-fixtures-private.json'),JSON.stringify(state),{mode:0o600});
 const code=typeof body.error?.code==='string'&&/^[A-Z_]{1,80}$/.test(body.error.code)?body.error.code:'UNCLASSIFIED';
 report.draft={status:draftResponse.status(),code,reference:typeof body.requestId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(body.requestId)?body.requestId:'UNAVAILABLE',observedAt:new Date().toISOString()};
 if(draftResponse.status()!==200||!body.draft?.id)throw new Error('PRIMARY_DRAFT_FAILED');
 fixture.draftId=body.draft.id;await writeFile(join(directory,'owned-fixtures-private.json'),JSON.stringify(state),{mode:0o600});
 if(body.draft.clarificationQuestions?.length)throw new Error('PUBLIC_CLARIFICATION_REQUIRED');
 await page.getByRole('heading',{name:'Your decision, ready to review.',exact:true}).waitFor();
 await page.getByLabel('I’ve reviewed these shared choices and who needs to approve.').check();
 const created=page.waitForResponse(r=>new URL(r.url()).pathname===`/groups/${fixture.groupId}/drafts/${fixture.draftId}/create`&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Create decision',exact:true}).click();const createdResponse=await created;const createdBody=await createdResponse.json();
 if(createdResponse.status()!==200||!createdBody.snapshot?.frame?.decisionId)throw new Error('PRIMARY_DECISION_CREATE_FAILED');
 fixture.decisionId=createdBody.snapshot.frame.decisionId;await writeFile(join(directory,'owned-fixtures-private.json'),JSON.stringify(state),{mode:0o600});report.decisionCreate={status:200};
 await page.reload();await page.waitForLoadState('networkidle');
 const restored=await globalThis.fetch('https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com/groups/'+fixture.groupId,{headers:{authorization:'Bearer '+fixture.accessToken}});const restoredBody=await restored.json();
 if(restored.status!==200||!restoredBody.group?.decisions?.some(item=>item.id===fixture.decisionId&&item.current))throw new Error('PRIMARY_DECISION_RELOAD_FAILED');
 if(await page.locator('body').innerText().then(text=>text.includes('Check your account and organizer access')))throw new Error('MISLEADING_ACCESS_COPY');
 const memberContext=await browser.newContext();await memberContext.addInitScript(session=>globalThis.sessionStorage.setItem('known-enough-cognito-session',JSON.stringify(session)),{accessToken:outsider.accessToken,kind:'participant',expiresAt:Date.now()+300000});
 const memberPage=await memberContext.newPage();await memberPage.goto(config.allowedOrigin+'/?group='+fixture.groupId,{waitUntil:'domcontentloaded'});await memberPage.getByRole('button',{name:'Open decision',exact:true}).click();await memberPage.getByRole('heading',{name:'Shared frame',exact:true}).waitFor();report.memberVisibility='PASS';await memberContext.close();
 report.reload='PASS';report.result='PRIMARY_PUBLIC_DRAFT_DECISION_PASS';
 await context.close();
 }
} catch(error) {
 if(process.argv[2]?.startsWith('archive'))Object.assign(report,archiveExceptionMetadata(error));
 if(process.argv[2]?.startsWith('archive')&&archiveFailureCode(error))report.archiveCode=archiveFailureCode(error);
 report.result='BLOCKED';report.error=['PRIMARY_DRAFT_FAILED','PUBLIC_CLARIFICATION_REQUIRED','PRIMARY_DECISION_CREATE_FAILED','PRIMARY_DECISION_RELOAD_FAILED','MISLEADING_ACCESS_COPY','OWN_SECOND_ACCOUNT_REQUIRED','UNAUTHORIZED_DRAFT_NOT_DENIED','UNAUTHENTICATED_RECOVERY_NOT_DENIED','OWN_TARGET_MISMATCH','OWN_SIGNED_IDENTITY_MISMATCH','OWN_PENDING_ACCOUNT_REQUIRED','OWN_GROUP_CREATE_FAILED','OWN_EMPTY_GROUP_REQUIRED','OWN_ARCHIVE_NOT_CONFIRMED','OWN_MEMBER_VISIBILITY_FAILED'].includes(error.message)?error.message:'OWN_REPRODUCTION_UNAVAILABLE';
} finally {
 await browser?.close();await writeFile(join(process.env.RUNNER_TEMP,process.argv[2]?.startsWith('archive')?'fix01-archive-report.json':'fix01-proof-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}

if(report.result==='BLOCKED')process.exitCode=1;
