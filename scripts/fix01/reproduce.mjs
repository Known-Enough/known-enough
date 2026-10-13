import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { createPartitionManagedDriver } from '../../packages/adapters/src/partition-managed.ts';
import { partitionRecoveryStorage } from '../operations/partition-recovery.mjs';
import { preparePartitionArchive,createPartitionArchiveRunner } from '../../packages/adapters/src/partition-archive.ts';
import { createPartitionedGroupRepository,partitionGroupKey } from '../../packages/adapters/src/partitioned-group-repository.ts';
import { createCognitoIdentityResolver } from '../../apps/api/src/cognito-identity.ts';
import { ownFixture } from '../operations/partition-live-behavior.mjs';
const directory=join(process.env.RUNNER_TEMP,'partition-cutover-private');
const report={source:process.env.EXPECTED_SOURCE,utc:new Date().toISOString(),result:'NOT_EXECUTED',groupCreate:'NOT_EXECUTED',draft:'NOT_EXECUTED',providerCalls:0};
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
   if(header?.kind!=='GROUP'||header.value.organizer!==fixture.subject||header.value.draftIds.length||header.value.decisionIds.length||header.value.invitations.length)throw new Error('OWN_EMPTY_GROUP_REQUIRED');
   const plan=preparePartitionArchive([{key,row:header}],fixture.groupId,process.env.EXPECTED_SOURCE);
   const expected={sourceSha:process.env.EXPECTED_SOURCE,groupId:fixture.groupId,sourceHeaderRevision:header.revision,sourceHash:plan.sourceHash,manifestHash:plan.manifestHash};
   const authority={kind:'ORGANIZER',subject:fixture.subject};
   const runner=createPartitionArchiveRunner(managed.archivePorts({manifestBytes:plan.manifestBytes,expected,authority,recovery:partitionRecoveryStorage()}),plan.manifestBytes,expected,authority);
   await runner.prepare();const result=await runner.archive();if(result.state!=='ARCHIVED')throw new Error('OWN_ARCHIVE_NOT_CONFIRMED');report.result='OWN_BASELINE_GROUP_ARCHIVED';report.archivedGroups=1;
  }
 } else {
 await createPartitionedGroupRepository(managed.groups).transaction({accountSubjects:[fixture.subject]},snapshot=>{
  const account=snapshot.accounts.find(item=>item.subject===fixture.subject);
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
 await page.getByRole('button',{name:'Start a decision',exact:true}).click();
 await page.getByLabel('What should this group decide?').fill('Choose a synthetic garden workday: planting or watering, morning or afternoon.');
 const draft=page.waitForResponse(r=>new URL(r.url()).pathname===`/groups/${fixture.groupId}/drafts`&&r.request().method()==='POST',{timeout:25000});
 await page.getByRole('button',{name:'Draft a new decision',exact:true}).click();const draftResponse=await draft;
 const body=await draftResponse.json().catch(()=>({}));
 const code=typeof body.error?.code==='string'&&/^[A-Z_]{1,80}$/.test(body.error.code)?body.error.code:'UNCLASSIFIED';
 report.draft={status:draftResponse.status(),code,reference:typeof body.requestId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(body.requestId)?body.requestId:'UNAVAILABLE',observedAt:new Date().toISOString()};
 report.result=draftResponse.status()===200?'UNEXPECTED_BASELINE_SUCCESS':'PRIMARY_DRAFT_FAILURE_REPRODUCED';
 if(draftResponse.status()===200)report.providerCalls='NOT_VERIFIED';
 await context.close();
 }
} catch(error) {
 report.result='BLOCKED';report.error=['OWN_TARGET_MISMATCH','OWN_SIGNED_IDENTITY_MISMATCH','OWN_PENDING_ACCOUNT_REQUIRED','OWN_GROUP_CREATE_FAILED','OWN_EMPTY_GROUP_REQUIRED','OWN_ARCHIVE_NOT_CONFIRMED'].includes(error.message)?error.message:'OWN_REPRODUCTION_UNAVAILABLE';
} finally {
 await browser?.close();await writeFile(join(process.env.RUNNER_TEMP,process.argv[2]==='archive'?'fix01-archive-report.json':'fix01-reproduction-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
