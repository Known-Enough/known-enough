import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { ownFixture } from '../operations/partition-live-behavior.mjs';
const execute=promisify(execFile),root=join(process.env.RUNNER_TEMP,'partition-cutover-private');
const report={utc:new Date().toISOString(),source:process.env.EXPECTED_SOURCE,result:'NOT_EXECUTED',stage:'START',checks:[],modelCalls:0};
try{
 const state=JSON.parse(await readFile(join(root,'owned-fixtures-private.json')));if(state.sourceSha!==process.env.EXPECTED_SOURCE||state.fixtures.length!==2)throw new Error('OWN_SOURCE_REQUIRED');for(const fixture of state.fixtures)ownFixture(fixture,state.runId);const [owner,pending]=state.fixtures;
 const cli=async(action,...args)=>{const result=await execute(process.execPath,['--no-warnings','--experimental-transform-types','scripts/fix04/access-users.mjs',action,...args],{timeout:240000,maxBuffer:2*1024*1024});await writeFile(join(root,'fix04-'+action+'-private.json'),result.stdout,{mode:0o600});return JSON.parse(result.stdout);};
 report.stage='FULL_PENDING_LIST';const listed=await cli('list','--pending');if(listed.result!=='PENDING_LIST_COMPLETE'||[owner,pending].some(fixture=>!listed.pending.some(row=>row.username===fixture.mailbox.address&&row.status==='PENDING'&&row.eligible)))throw new Error('OWN_PENDING_LIST_FAILED');report.checks.push({operation:'ALL_PAGE_PENDING_LIST',result:'PASS',pending:listed.pending.length,accountKeysObserved:listed.accountKeysObserved});
 report.stage='EXACT_APPROVE';const approval=await cli('approve','--username',owner.mailbox.address);if(approval.result!=='APPROVALS_COMPLETE'||approval.outcomes.length!==1||approval.outcomes[0].result!=='APPROVED'||approval.outcomes[0].dataWrites!==1)throw new Error('EXACT_APPROVAL_FAILED');
 const api=async(fixture,path)=>{const response=await globalThis.fetch('https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com'+path,{headers:{authorization:'Bearer '+fixture.accessToken}});return {status:response.status,body:await response.json()};};
 const own=await api(owner,'/account'),other=await api(pending,'/account');if(own.status!==200||own.body.account.status!=='APPROVED'||other.status!==200||other.body.account.status!=='PENDING')throw new Error('ADMISSION_READBACK_FAILED');const groups=await api(owner,'/groups');if(groups.status!==200||groups.body.groups.length!==0||(await api(pending,'/groups')).status!==403)throw new Error('MEMBERSHIP_OR_PENDING_GUARD_FAILED');report.checks.push({operation:'ONE_APPROVED_OTHER_PENDING_NO_MEMBERSHIP',result:'PASS'});
 report.stage='IDEMPOTENT_APPROVE';const repeated=await cli('approve','--username',owner.mailbox.address);if(repeated.outcomes[0]?.result!=='ALREADY_APPROVED'||repeated.outcomes[0]?.dataWrites!==0)throw new Error('IDEMPOTENCE_FAILED');report.checks.push({operation:'ALREADY_APPROVED_ZERO_MUTATIONS',result:'PASS'});report.result='NATIVE_ACCESS_COMMANDS_LIVE_PASS';
}catch(error){report.result='BLOCKED';report.error=/^[A-Z0-9_]{1,80}$/.test(error.message)?error.message:'OPERATOR_PROOF_UNAVAILABLE';}finally{await writeFile(join(process.env.RUNNER_TEMP,'fix04-proof-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
if(report.result==='BLOCKED')process.exitCode=1;
