import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { createPartitionManagedDriver } from '../../packages/adapters/src/partition-managed.ts';
import { partitionRecoveryStorage } from '../operations/partition-recovery.mjs';
import { preparePartitionArchive,createPartitionArchiveRunner } from '../../packages/adapters/src/partition-archive.ts';
import { createPartitionedGroupRepository,partitionGroupKey } from '../../packages/adapters/src/partitioned-group-repository.ts';
import { createCognitoIdentityResolver } from '../../apps/api/src/cognito-identity.ts';
import { partitionDirectoryKey } from '../../packages/adapters/src/partition-directory.ts';
import { randomUUID } from 'node:crypto';
import { ownFixture } from '../operations/partition-live-behavior.mjs';
const directory=join(process.env.RUNNER_TEMP,'partition-cutover-private');
const report={source:process.env.EXPECTED_SOURCE,utc:new Date().toISOString(),result:'NOT_EXECUTED',groupCreate:'NOT_EXECUTED',draft:'NOT_EXECUTED',providerCalls:'NOT_VERIFIED',unauthorized:'NOT_EXECUTED',reload:'NOT_EXECUTED'};
let browser;
try {
 const config=JSON.parse(await readFile(join(directory,'configuration-private.json'),'utf8'));
 const release=JSON.parse(await readFile(join(directory,'release-private.json'),'utf8'));
 const state=JSON.parse(await readFile(join(directory,'owned-fixtures-private.json'),'utf8'));
 if(state.sourceSha!==process.env.EXPECTED_SOURCE||config.account!=='092954139775'||config.region!=='us-east-1'||config.allowedOrigin!=='https://main.d143q5ravxp5av.amplifyapp.com')throw new Error('OWN_TARGET_MISMATCH');
 const fixture=state.fixtures.find(item=>item.accessToken&&item.created&&!item.deleted);ownFixture(fixture,state.runId);
 const identity=await createCognitoIdentityResolver(config)('Bearer '+fixture.accessToken);
 if(identity?.kind!=='participant'||identity.subject!==fixture.subject)throw new Error('OWN_SIGNED_IDENTITY_MISMATCH');
 const manifest=await readFile(join(directory,'manifest-private.json'));
 const managed=createPartitionManagedDriver({manifestBytes:manifest,expected:{sourceSha:release.sourceSha,sourceRevision:release.sourceRevision,sourceHash:release.sourceHash,manifestHash:release.manifestHash},manifestVersion:release.manifestVersion,verifiedTarget:{account:'092954139775',region:'us-east-1'},cursorKey:Buffer.from(config.cursorKeyBase64,'base64')});
 if(process.argv[2]==='archive') {
  if(!fixture.groupId){report.result='NO_OWN_GROUP_TO_ARCHIVE';}
  else {
   const key=partitionGroupKey(fixture.groupId),header=await managed.groups.read(key);
   if(header?.kind!=='GROUP'||header.value.organizer!==fixture.subject||header.value.invitations.length||header.value.draftIds.length>1||header.value.decisionIds.length>1)throw new Error('OWN_EMPTY_GROUP_REQUIRED');
   const entries=[{key,row:header}];
   for(const id of header.value.draftIds){const child={PK:key.PK,SK:'DRAFT#'+id};entries.push({key:child,row:await managed.groups.read(child)});}
   for(const id of header.value.decisionIds){const child={PK:key.PK,SK:'BINDING#'+id};entries.push({key:child,row:await managed.groups.read(child)});const directory=partitionDirectoryKey({type:'DECISION',groupId:fixture.groupId,decisionId:id});entries.push({key:directory,row:await managed.groups.read(directory)});}
   const plan=preparePartitionArchive(entries,fixture.groupId,process.env.EXPECTED_SOURCE);
   const expected={sourceSha:process.env.EXPECTED_SOURCE,groupId:fixture.groupId,sourceHeaderRevision:header.revision,sourceHash:plan.sourceHash,manifestHash:plan.manifestHash};
   const authority={kind:'ORGANIZER',subject:fixture.subject};
   const runner=createPartitionArchiveRunner(managed.archivePorts({manifestBytes:plan.manifestBytes,expected,authority,recovery:partitionRecoveryStorage()}),plan.manifestBytes,expected,authority);
   await runner.prepare();const result=await runner.archive();if(result.state!=='ARCHIVED')throw new Error('OWN_ARCHIVE_NOT_CONFIRMED');report.result='OWN_PROOF_GROUP_ARCHIVED';report.archivedGroups=1;
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
 await page.getByRole('button',{name:'Start a decision',exact:true}).click();
 await page.getByLabel('What should this group decide?').fill('Choose a synthetic garden workday. There are two public choices: activity is planting or watering; time is morning or afternoon. All named group members must approve. There are no extra public constraints, real availability, private needs, or unresolved public questions. Generate these two enum choices for review.');
 const draft=page.waitForResponse(r=>new URL(r.url()).pathname===`/groups/${fixture.groupId}/drafts`&&r.request().method()==='POST',{timeout:25000});
 await page.getByRole('button',{name:'Draft a new decision',exact:true}).click();const draftResponse=await draft;
 const body=await draftResponse.json().catch(()=>({}));fixture.draftRequestKey=draftResponse.request().postDataJSON().idempotencyKey;await writeFile(join(directory,'owned-fixtures-private.json'),JSON.stringify(state),{mode:0o600});
 const code=typeof body.error?.code==='string'&&/^[A-Z_]{1,80}$/.test(body.error.code)?body.error.code:'UNCLASSIFIED';
 report.draft={status:draftResponse.status(),code,reference:typeof body.requestId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(body.requestId)?body.requestId:'UNAVAILABLE',observedAt:new Date().toISOString()};
 if(draftResponse.status()!==200||!body.draft?.id)throw new Error('PRIMARY_DRAFT_FAILED');
 fixture.draftId=body.draft.id;await writeFile(join(directory,'owned-fixtures-private.json'),JSON.stringify(state),{mode:0o600});
 if(body.draft.clarificationQuestions?.length)throw new Error('PUBLIC_CLARIFICATION_REQUIRED');
 await page.getByRole('heading',{name:'Review the public draft',exact:true}).waitFor();
 await page.getByLabel('I reviewed this public draft and the required approvers').check();
 const created=page.waitForResponse(r=>new URL(r.url()).pathname===`/groups/${fixture.groupId}/drafts/${fixture.draftId}/create`&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Create decision for group review',exact:true}).click();const createdResponse=await created;const createdBody=await createdResponse.json();
 if(createdResponse.status()!==200||!createdBody.snapshot?.frame?.decisionId)throw new Error('PRIMARY_DECISION_CREATE_FAILED');
 fixture.decisionId=createdBody.snapshot.frame.decisionId;await writeFile(join(directory,'owned-fixtures-private.json'),JSON.stringify(state),{mode:0o600});report.decisionCreate={status:200};
 await page.reload();await page.waitForLoadState('networkidle');
 const restored=await globalThis.fetch('https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com/groups/'+fixture.groupId,{headers:{authorization:'Bearer '+fixture.accessToken}});const restoredBody=await restored.json();
 if(restored.status!==200||!restoredBody.group?.decisions?.some(item=>item.id===fixture.decisionId&&item.current))throw new Error('PRIMARY_DECISION_RELOAD_FAILED');
 if(await page.locator('body').innerText().then(text=>text.includes('Check your account and organizer access')))throw new Error('MISLEADING_ACCESS_COPY');
 report.reload='PASS';report.result='PRIMARY_PUBLIC_DRAFT_DECISION_PASS';
 await context.close();
 }
} catch(error) {
 report.result='BLOCKED';report.error=['PRIMARY_DRAFT_FAILED','PUBLIC_CLARIFICATION_REQUIRED','PRIMARY_DECISION_CREATE_FAILED','PRIMARY_DECISION_RELOAD_FAILED','MISLEADING_ACCESS_COPY','OWN_SECOND_ACCOUNT_REQUIRED','UNAUTHORIZED_DRAFT_NOT_DENIED','UNAUTHENTICATED_RECOVERY_NOT_DENIED','OWN_TARGET_MISMATCH','OWN_SIGNED_IDENTITY_MISMATCH','OWN_PENDING_ACCOUNT_REQUIRED','OWN_GROUP_CREATE_FAILED','OWN_EMPTY_GROUP_REQUIRED','OWN_ARCHIVE_NOT_CONFIRMED'].includes(error.message)?error.message:'OWN_REPRODUCTION_UNAVAILABLE';
} finally {
 await browser?.close();await writeFile(join(process.env.RUNNER_TEMP,process.argv[2]==='archive'?'fix01-archive-report.json':'fix01-proof-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}

if(report.result==='BLOCKED')process.exitCode=1;
