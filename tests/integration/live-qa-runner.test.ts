import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Page } from '@playwright/test';
import { trackOperation } from '../live/qa/helpers.ts';
// @ts-expect-error JavaScript runner boundary is exercised directly without AWS calls.
import { validateTarget, validateReceipt, validateWorkload, safeResults, qualificationReport, REQUIRED_TESTS, SAFE_OPERATION_STATUSES, operationStatus, transportFailureStatus } from '../../scripts/live-qa/runner-core.mjs';
const target={Account:'092954139775',Region:'us-east-1',SourceCommit:'a'.repeat(40),ApiUrl:'https://qabuild.execute-api.us-east-1.amazonaws.com',FrontendUrl:'https://main.qabuild.amplifyapp.com/',PoolId:'us-east-1_QaPool',ParticipantClientId:'pc',DisplayClientId:'dc',CognitoDomain:'https://known-enough-qa-092954139775.auth.us-east-1.amazoncognito.com',ApiFunction:'known-enough-qa-api',BrokerFunction:'known-enough-qa-fixtures',DecisionTable:'KnownEnoughQaDecisions',GroupTable:'KnownEnoughQaGroups',ControlTable:'KnownEnoughQaControl',MailboxBucket:'qa-mail',LoginSecret:'arn:aws:secretsmanager:us-east-1:092954139775:secret:known-enough/qa/run-login-secret',TestRoleArn:'arn:aws:iam::092954139775:role/KnownEnoughGithubQaTest',ReleaseRoleArn:'arn:aws:iam::092954139775:role/KnownEnoughGithubQaRelease',AmplifyAppId:'qaapp'};
const receipt={schemaVersion:1,sourceCommit:target.SourceCommit,targetApi:target.ApiUrl,targetFrontend:target.FrontendUrl,workflowRunId:'12',jobId:'34',artifacts:Object.fromEntries(['api','broker','web'].map(k=>[k,{sha256:'b'.repeat(64)}]))};
describe('LIVE02 runner preparation, no service simulation counted as live',()=>{
 test('rejects primary tables, personal profiles and untrusted target URLs',()=>{expect(validateTarget(target).GroupTable).toBe('KnownEnoughQaGroups');for(const change of [{PoolId:'us-east-1_V9OMjd0zx'},{ApiUrl:'https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com'},{GroupTable:'KnownEnoughGroupsStage'},{FrontendUrl:'https://attacker.invalid/'}])expect(()=>validateTarget({...target,...change})).toThrow();const identity={Account:target.Account,Arn:'arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubQaTest/run'};expect(()=>validateWorkload(identity,'A-personal')).toThrow();expect(()=>validateWorkload({...identity,Arn:'arn:aws:iam::092954139775:user/A'})).toThrow();expect(()=>validateWorkload(identity,undefined)).not.toThrow();});
 test('requires independent exact source and artifact receipt',()=>{expect(validateReceipt(target,receipt,target.SourceCommit)).toEqual(receipt);for(const r of [{...receipt,sourceCommit:'c'.repeat(40)},{...receipt,targetApi:'https://observed.invalid'},{...receipt,artifacts:{}},{...receipt,workflowRunId:'untrusted'}])expect(()=>validateReceipt(target,r,target.SourceCommit)).toThrow();});
 test('missing, duplicated, skipped or failed required tests cannot pass',()=>{const pass=REQUIRED_TESTS.map((title:string)=>({title,status:'passed'}));expect(safeResults(pass).every((r:{status:string})=>r.status==='PASS')).toBe(true);for(const tests of [pass.slice(1),[...pass,pass[0]],pass.map((t:{title:string})=>({...t,status:'skipped'})),pass.map((t:{title:string})=>({...t,status:'failed'}))])expect(safeResults(tests).every((r:{status:string})=>r.status==='PASS')).toBe(false);});
 test('whole qualification requires model signup privacy and clean cleanup',()=>{const good={processExitCode:0,processSignal:null,reportStatus:'passed',globalErrors:0,failedTests:0,runId:'run-12345',sourceCommit:target.SourceCommit,preflight:'PASS',fixtures:'PASS',tests:REQUIRED_TESTS.map((title:string)=>({title,status:'passed'})),attempts:4,signupMessages:1,privacy:'PASS',cleanup:'CLEAN'};expect(qualificationReport(good).status).toBe('PASS');for(const change of [{attempts:0},{signupMessages:0},{privacy:'BLOCKED'},{cleanup:'CLEANUP_FAILED'},{preflight:'BLOCKED'}])expect(qualificationReport({...good,...change}).status).toBe('BLOCKED_OR_FAILED');expect(JSON.stringify(qualificationReport({...good,password:'PRIVATE',errors:['SECRET'],tests:[{title:'PRIVATE_EMAIL',status:'failed'}]}))).not.toMatch(/PRIVATE|SECRET/);});
 test('absent setup produces a sanitized blocked report and makes no AWS request',()=>{const dir=mkdtempSync(resolve(tmpdir(),'ke-qa-uninstalled-'));try{const result=spawnSync(process.execPath,['scripts/live-qa/runner.mjs',dir+'/missing.json',dir+'/receipt.json','run-12345',dir+'/report.json'],{encoding:'utf8',env:{...process.env,AWS_PROFILE:'NEVER_USE_PERSONAL'}});expect(result.status).toBe(1);const report=JSON.parse(readFileSync(dir+'/report.json','utf8'));expect(report.status).toBe('BLOCKED_OR_FAILED');expect(report.counts.passed).toBe(0);expect(result.stdout).not.toMatch(/PRIVATE|NEVER_USE_PERSONAL|SECRET/);}finally{rmSync(dir,{recursive:true,force:true});}});
 test('reporter never publishes assertion errors, traces, attachments or private messages',async()=>{const dir=mkdtempSync(resolve(tmpdir(),'ke-qa-reporter-'));const before=process.env.QA_RESULTS_FILE;process.env.QA_RESULTS_FILE=dir+'/tests.json';try{
   // @ts-expect-error Reporter JavaScript deliberately accepts only title and status.
   const {default:Reporter}=await import('../../scripts/live-qa/sanitized-reporter.mjs');const reporter=new Reporter();reporter.onTestEnd({title:REQUIRED_TESTS[0],attachments:[{body:'PRIVATE'}]},{status:'failed',error:{message:'SECRET_TOKEN'},stdout:['PRIVATE_EMAIL']});reporter.onEnd({status:'failed'});expect(readFileSync(process.env.QA_RESULTS_FILE,'utf8')).not.toMatch(/PRIVATE|SECRET/);writeFileSync(dir+'/empty','');
 }finally{if(before===undefined)delete process.env.QA_RESULTS_FILE;else process.env.QA_RESULTS_FILE=before;rmSync(dir,{recursive:true,force:true});}});
});


test('failed signup phase survives the sanitized reporter and report without assertion values', async () => {
  const dir=mkdtempSync(resolve(tmpdir(),'ke-qa-phase-'));const before=process.env.QA_RESULTS_FILE;process.env.QA_RESULTS_FILE=dir+'/tests.json';
  try {
    // @ts-expect-error JavaScript reporter accepts only allowlisted phase/title/status.
    const {default:Reporter}=await import('../../scripts/live-qa/sanitized-reporter.mjs');const reporter=new Reporter();
    reporter.onStepEnd({title:REQUIRED_TESTS[0]}, {}, {title:'PRIVATE_EMAIL',error:{message:'PASSWORD'}});
    reporter.onStepEnd({title:REQUIRED_TESTS[0]}, {}, {title:'QA01_EMAIL',error:{message:'PRIVATE_EMAIL_PASSWORD'}});
    reporter.onTestEnd({title:REQUIRED_TESTS[0],annotations:[{type:'qa-mail-status',description:'MAIL_EMPTY'},{type:'qa-mail-status',description:'PRIVATE_EMAIL_PASSWORD'}]}, {status:'failed',error:{message:'SECRET'}});reporter.onEnd({status:'failed'});
    const raw=readFileSync(process.env.QA_RESULTS_FILE,'utf8');expect(raw).not.toMatch(/PRIVATE|PASSWORD|SECRET/);
    const report=qualificationReport({runId:'run-12345',tests:JSON.parse(raw).tests});expect(report.tests[0]).toMatchObject({status:'FAIL',phase:'QA01_EMAIL',mailStatus:'MAIL_EMPTY'});
    expect(safeResults([{title:REQUIRED_TESTS[0],status:'failed',phase:'PRIVATE_EMAIL',mailStatus:'PRIVATE_EMAIL'}])[0]).not.toHaveProperty('phase');
  } finally {if(before===undefined)delete process.env.QA_RESULTS_FILE;else process.env.QA_RESULTS_FILE=before;rmSync(dir,{recursive:true,force:true});}
});


test('decision diagnostics keep only fixed phase/outcome tags and never response contents', async () => {
  const dir=mkdtempSync(resolve(tmpdir(),'ke-qa-decision-phase-'));const before=process.env.QA_RESULTS_FILE;process.env.QA_RESULTS_FILE=dir+'/tests.json';
  try {
    // @ts-expect-error Reporter accepts allowlisted static metadata only.
    const {default:Reporter}=await import('../../scripts/live-qa/sanitized-reporter.mjs');const reporter=new Reporter();
    reporter.onStepEnd({title:REQUIRED_TESTS[2]}, {}, {title:'QA03_DRAFT',error:{message:'PRIVATE_MODEL_OUTPUT'}});
    reporter.onTestEnd({title:REQUIRED_TESTS[2],annotations:[{type:'qa-operation-status',description:'HTTP_UNAVAILABLE'},{type:'qa-operation-status',description:'PRIVATE_TOKEN'}]}, {status:'failed',error:{message:'PRIVATE_MODEL_OUTPUT'}});reporter.onEnd({status:'failed'});
    const raw=readFileSync(process.env.QA_RESULTS_FILE,'utf8');expect(raw).not.toMatch(/PRIVATE/);
    const result=qualificationReport({runId:'run-12345',tests:JSON.parse(raw).tests});expect(result.tests[2]).toMatchObject({status:'FAIL',phase:'QA03_DRAFT',operationStatus:'HTTP_UNAVAILABLE'});
    expect(safeResults([{title:REQUIRED_TESTS[2],status:'failed',operationStatus:'PRIVATE_TOKEN'}])[2]).not.toHaveProperty('operationStatus');
  } finally {if(before===undefined)delete process.env.QA_RESULTS_FILE;else process.env.QA_RESULTS_FILE=before;rmSync(dir,{recursive:true,force:true});}
});

test('creation failure preserves a fixed substep and exact-request HTTP category only', async () => {
  const dir=mkdtempSync(resolve(tmpdir(),'ke-qa-create-phase-'));const before=process.env.QA_RESULTS_FILE;process.env.QA_RESULTS_FILE=dir+'/tests.json';
  try {
    // @ts-expect-error Reporter deliberately ignores raw Playwright error and attachment fields.
    const {default:Reporter}=await import('../../scripts/live-qa/sanitized-reporter.mjs');const reporter=new Reporter();
    reporter.onStepEnd({title:REQUIRED_TESTS[2]}, {}, {title:'PRIVATE_STEP',error:{message:'PRIVATE_TOKEN'}});
    reporter.onStepEnd({title:REQUIRED_TESTS[2]}, {}, {title:'QA03_CREATE_ID',error:{message:'PRIVATE_DECISION_ID'}});
    reporter.onTestEnd({title:REQUIRED_TESTS[2],annotations:[{type:'qa-operation-status',description:'HTTP_CONFLICT'},{type:'qa-operation-status',description:'PRIVATE_URL'}],attachments:[{body:'PRIVATE_BODY'}]}, {status:'failed',error:{message:'PRIVATE_ASSERTION'}});
    reporter.onEnd({status:'failed'});
    const raw=readFileSync(process.env.QA_RESULTS_FILE,'utf8');expect(raw).not.toMatch(/PRIVATE|TOKEN|BODY|URL|ASSERTION/);
    const result=qualificationReport({runId:'run-12345',tests:JSON.parse(raw).tests});
    expect(result.tests[2]).toMatchObject({status:'FAIL',phase:'QA03_CREATE_ID',operationStatus:'HTTP_CONFLICT'});
    expect(safeResults([{title:REQUIRED_TESTS[2],status:'failed',phase:'QA03_CREATE_PRIVATE',operationStatus:'PRIVATE_URL'}])[2]).toEqual({title:REQUIRED_TESTS[2],status:'FAIL'});
  } finally {if(before===undefined)delete process.env.QA_RESULTS_FILE;else process.env.QA_RESULTS_FILE=before;rmSync(dir,{recursive:true,force:true});}
});

test('browser operation observer matches only the exact POST and detaches after success/failure', async () => {
  const page=new EventEmitter();const statuses:string[]=[];const url='https://qa.invalid/groups/private-group/drafts';
  const request=(path:string,method='POST',errorText?:string)=>({url:()=>path,method:()=>method,failure:()=>errorText===undefined?null:{errorText}});
  const response=(path:string,status:number,method='POST')=>({request:()=>request(path,method),status:()=>status,json:()=>{throw new Error('NEVER_READ_PRIVATE_BODY');}});
  await trackOperation(page as unknown as Page,url,async()=>{
    page.emit('response',response(url+'?private=value',503));page.emit('response',response(url,401,'GET'));expect(statuses).toEqual(['HTTP_PENDING']);
    page.emit('response',response(url,503));
  },status=>statuses.push(status));
  expect(statuses).toEqual(['HTTP_PENDING','HTTP_UNAVAILABLE']);expect(page.listenerCount('response')).toBe(0);expect(page.listenerCount('requestfailed')).toBe(0);
  await expect(trackOperation(page as unknown as Page,url,async()=>{page.emit('requestfailed',request(url,'POST','net::ERR_CONNECTION_RESET'));throw new Error('PRIVATE_ERROR');},status=>statuses.push(status))).rejects.toThrow('PRIVATE_ERROR');
  expect(statuses.slice(-2)).toEqual(['HTTP_PENDING','HTTP_CONNECTION_FAILED']);expect(page.listenerCount('response')).toBe(0);expect(page.listenerCount('requestfailed')).toBe(0);
});

test('HTTP diagnostics accept only numeric protocol outcomes',()=>{expect(operationStatus(200)).toBe('HTTP_OK');expect(operationStatus(422)).toBe('HTTP_UNPROCESSABLE');expect(operationStatus(500)).toBe('HTTP_SERVER_ERROR');expect(operationStatus(502)).toBe('HTTP_BAD_GATEWAY');for(const status of ['toString','PRIVATE_TOKEN',undefined,null,NaN,0,600])expect(operationStatus(status)).toBe('HTTP_OTHER_FAILURE');});

test('transport diagnostics expose only allowlisted failure categories',()=>{
  expect(transportFailureStatus('net::ERR_TIMED_OUT')).toBe('HTTP_REQUEST_TIMEOUT');
  expect(transportFailureStatus('net::ERR_CONNECTION_RESET')).toBe('HTTP_CONNECTION_FAILED');
  expect(transportFailureStatus('net::ERR_NAME_NOT_RESOLVED')).toBe('HTTP_DNS_FAILED');
  expect(transportFailureStatus('PRIVATE_TOKEN or private URL')).toBe('HTTP_TRANSPORT_FAILED');
  expect(SAFE_OPERATION_STATUSES).not.toContain('PRIVATE_TOKEN');
});

test('nested frame failure keeps the first failed safe child rather than the later failing parent and strips private values', async () => {
  const dir=mkdtempSync(resolve(tmpdir(),'ke-qa-nested-frame-'));const before=process.env.QA_RESULTS_FILE;process.env.QA_RESULTS_FILE=dir+'/tests.json';
  try {
    // @ts-expect-error Reporter accepts fixed diagnostic tags only.
    const {default:Reporter}=await import('../../scripts/live-qa/sanitized-reporter.mjs');const reporter=new Reporter();
    const t={title:REQUIRED_TESTS[2],annotations:[{type:'qa-operation-status',description:'HTTP_CONFLICT'}]};
    reporter.onStepEnd(t,{}, {title:'PRIVATE_VALUE',error:{message:'SECRET'}});
    reporter.onStepEnd(t,{}, {title:'QA03_FRAME_CONFIRM',error:{message:'PRIVATE_REQUEST_BODY'}});
    reporter.onStepEnd(t,{}, {title:'QA03_FRAME',error:{message:'PRIVATE_PARENT'}});
    reporter.onTestEnd(t,{status:'failed'});reporter.onEnd({status:'failed'});
    const raw=readFileSync(process.env.QA_RESULTS_FILE,'utf8');expect(raw).not.toMatch(/PRIVATE|SECRET/);
    const report=qualificationReport({runId:'run-12345',tests:JSON.parse(raw).tests});
    expect(report.tests[2]).toMatchObject({status:'FAIL',phase:'QA03_FRAME_CONFIRM',operationStatus:'HTTP_CONFLICT'});
    const owner=new Reporter();owner.onStepEnd(t,{}, {title:'QA03_OWNER_CONFIRM',error:{message:'PRIVATE_OWNER'}});owner.onStepEnd(t,{}, {title:'QA03_OWNER',error:{message:'PRIVATE_PARENT'}});owner.onTestEnd(t,{status:'failed'});expect(owner.tests[0]).toMatchObject({phase:'QA03_OWNER_CONFIRM',operationStatus:'HTTP_CONFLICT'});
    const load=new Reporter();load.onStepEnd(t,{}, {title:'QA03_FRAME_LOAD',error:{message:'PRIVATE_LOAD'}});load.onTestEnd(t,{status:'failed'});
    expect(load.tests[0]).toHaveProperty('operationStatus','HTTP_CONFLICT');
  } finally {if(before===undefined)delete process.env.QA_RESULTS_FILE;else process.env.QA_RESULTS_FILE=before;rmSync(dir,{recursive:true,force:true});}
});

test('negotiation diagnostics retain fixed failed substeps without private details', async () => {
  // @ts-expect-error JavaScript reporter accepts fixed diagnostic tags only.
  const {default:Reporter}=await import('../../scripts/live-qa/sanitized-reporter.mjs');
  const reporter=new Reporter(); const title={title:REQUIRED_TESTS[3],annotations:[]};
  reporter.onStepEnd(title,{}, {title:'QA04_PROPOSAL_READ',error:{message:'PRIVATE_PROPOSAL_PAYLOAD'}});
  reporter.onStepEnd(title,{}, {title:'QA04_QUESTION_PRIVACY',error:{message:'PRIVATE_OWNER_DATA'}});
  reporter.onTestEnd(title,{status:'failed'});
  expect(safeResults(reporter.tests)[3]).toEqual({title:REQUIRED_TESTS[3],status:'FAIL',phase:'QA04_PROPOSAL_READ'});
  expect(JSON.stringify(reporter.tests)).not.toContain('PRIVATE');
  expect(safeResults([{title:REQUIRED_TESTS[3],status:'failed',phase:'QA04_PRIVATE_VALUE'}])[3]).not.toHaveProperty('phase');
});

test('reasoning diagnostics keep only fixed outcomes without model payloads',async()=>{
  // @ts-expect-error JavaScript reporter validates fixed tags only.
  const {default:Reporter}=await import('../../scripts/live-qa/sanitized-reporter.mjs');
  const reporter=new Reporter();const title={title:REQUIRED_TESTS[3],annotations:[{type:'qa-reasoning-outcome',description:'NEEDS_PERMISSION'},{type:'qa-reasoning-outcome',description:'PRIVATE_MODEL_PAYLOAD'},{type:'qa-operation-status',description:'HTTP_OK'}]};
  reporter.onStepEnd(title,{}, {title:'QA04_QUESTION',error:{message:'PRIVATE_SERVER_RESPONSE'}});reporter.onTestEnd(title,{status:'failed'});
  expect(safeResults(reporter.tests)[3]).toEqual({title:REQUIRED_TESTS[3],status:'FAIL',phase:'QA04_QUESTION',operationStatus:'HTTP_OK',reasoningOutcome:'NEEDS_PERMISSION'});
  expect(JSON.stringify(reporter.tests)).not.toContain('PRIVATE');
  expect(safeResults([{title:REQUIRED_TESTS[3],status:'failed',reasoningOutcome:'PRIVATE'}])[3]).not.toHaveProperty('reasoningOutcome');
});

test('frame count diagnostics expose fixed categories without participant data',async()=>{
  // @ts-expect-error JavaScript reporter accepts fixed diagnostic tags only.
  const {default:Reporter}=await import('../../scripts/live-qa/sanitized-reporter.mjs');
  const reporter=new Reporter();const title={title:REQUIRED_TESTS[2],annotations:[{type:'qa-frame-status',description:'FRAME_COUNT_MISSING'},{type:'qa-frame-status',description:'PRIVATE_PARTICIPANT_ID'}]};
  reporter.onStepEnd(title,{}, {title:'QA03_FRAME_READ',error:{message:'PRIVATE_CONFIRMATION'}});reporter.onTestEnd(title,{status:'failed'});
  expect(safeResults(reporter.tests)[2]).toEqual({title:REQUIRED_TESTS[2],status:'FAIL',phase:'QA03_FRAME_READ',frameStatus:'FRAME_COUNT_MISSING'});
  expect(JSON.stringify(reporter.tests)).not.toContain('PRIVATE');
  expect(safeResults([{title:REQUIRED_TESTS[2],status:'failed',frameStatus:'PRIVATE'}])[2]).not.toHaveProperty('frameStatus');
});

test('missing usage readback stays unknown through qualification and combined reporting',async()=>{
  // @ts-expect-error Combined JavaScript report validates sanitized values.
  const {completeReport}=await import('../../scripts/live-qa/report.mjs');
  const unknown=qualificationReport({runId:'run-12345',sourceCommit:target.SourceCommit,tests:REQUIRED_TESTS.map((title:string)=>({title,status:'passed'})),preflight:'PASS',fixtures:'PASS',privacy:'PASS',cleanup:'CLEAN'});
  expect(unknown.counts).toMatchObject({modelAttempts:null,signupMessages:null});expect(unknown.status).toBe('BLOCKED_OR_FAILED');
  const combined=completeReport({qa:unknown},{sourceCommit:target.SourceCommit});
  expect(combined.qaCounts).toMatchObject({modelAttempts:null,signupMessages:null});
  for(const value of [0,4]){
    const observed=qualificationReport({runId:'run-12345',attempts:value,signupMessages:value});
    expect(observed.counts).toMatchObject({modelAttempts:value,signupMessages:value});
    expect(completeReport({qa:observed},{sourceCommit:target.SourceCommit}).qaCounts).toMatchObject({modelAttempts:value,signupMessages:value});
  }
  expect(qualificationReport({runId:'run-12345',attempts:-1,signupMessages:'PRIVATE'}).counts).toMatchObject({modelAttempts:null,signupMessages:null});
});

test('unmapped valid HTTP protocol statuses stay exact and private input cannot become a tag',()=>{
 for(const status of [301,304,307,308,405,418,599]){expect(operationStatus(status)).toBe(`HTTP_STATUS_${status}`);expect(SAFE_OPERATION_STATUSES).toContain(operationStatus(status));}
 for(const status of ['304','PRIVATE_TOKEN',1000,NaN,null])expect(operationStatus(status)).toBe('HTTP_OTHER_FAILURE');
});

test('keeps exact draft edit subphase and safe HTTP status while rejecting private errors',async()=>{
 // @ts-expect-error Standalone sanitized reporter.
 const {default:Reporter}=await import('../../scripts/live-qa/sanitized-reporter.mjs');
 for(const phase of ['QA03_EDIT_DRAFT','QA03_EDIT_INVALIDATION','QA03_EDIT_SAVE','QA03_EDIT_COMMIT','QA03_EDIT_REVIEW']){
  const reporter=new Reporter();const t={title:REQUIRED_TESTS[2],annotations:[{type:'qa-operation-status',description:'HTTP_STATUS_429'}]};
  reporter.onStepEnd(t,{}, {title:phase,error:{message:'PRIVATE_EDIT_ERROR'}});reporter.onStepEnd(t,{}, {title:'QA03_EDIT',error:{message:'PRIVATE_PARENT'}});reporter.onTestEnd(t,{status:'failed'});
  expect(reporter.tests[0]).toMatchObject({phase});if(['QA03_EDIT_DRAFT','QA03_EDIT_SAVE','QA03_EDIT_COMMIT'].includes(phase))expect(reporter.tests[0]).toHaveProperty('operationStatus','HTTP_STATUS_429');else expect(reporter.tests[0]).not.toHaveProperty('operationStatus');expect(JSON.stringify(reporter.tests)).not.toContain('PRIVATE');
 }
});

test('catalog counts survive both report boundaries while malformed/private fields stay unknown',async()=>{
 // @ts-expect-error Standalone sanitized reporter.
 const {default:Reporter}=await import('../../scripts/live-qa/sanitized-reporter.mjs');
 const counts={tested:2,valid:0,invalid:1,needsPermission:1,needsClarification:0};
 for(const [description,expected] of [[JSON.stringify(counts),counts],[JSON.stringify({...counts,secret:'PRIVATE'}),null],['PRIVATE_NOT_JSON',null]] as const){
  const reporter=new Reporter();reporter.onTestEnd({title:REQUIRED_TESTS[3],annotations:[{type:'qa-catalog-counts',description}]},{status:'failed'});
  const report=qualificationReport({runId:'run-12345',tests:reporter.tests});expect(report.tests[3].catalogCounts).toEqual(expected);expect(JSON.stringify(report)).not.toContain('PRIVATE');
 }
});


test('signup failure codes and HTTP status survive reporter and qualification without provider messages',async()=>{
  // @ts-expect-error Fixed JavaScript reporter boundary.
  const {default:Reporter}=await import('../../scripts/live-qa/sanitized-reporter.mjs');
  for(const phase of ['QA01_SIGNUP','QA01_EMAIL_CONFIRM']){
    const reporter=new Reporter();const t={title:REQUIRED_TESTS[0],annotations:[{type:'qa-operation-status',description:'HTTP_BAD_REQUEST'},{type:'qa-signup-provider-code',description:'InvalidLambdaResponseException'},{type:'qa-signup-provider-code',description:'PRIVATE_TOKEN'}]};
    reporter.onStepEnd(t,{}, {title:phase,error:{message:'PRIVATE_EMAIL'}});reporter.onTestEnd(t,{status:'failed',error:{message:'PRIVATE_PASSWORD'}});
    const value=safeResults(reporter.tests)[0];expect(value).toMatchObject({phase,operationStatus:'HTTP_BAD_REQUEST',signupProviderCode:'InvalidLambdaResponseException',status:'FAIL'});expect(JSON.stringify(value)).not.toContain('PRIVATE');
  }
  expect(safeResults([{title:REQUIRED_TESTS[0],status:'failed',phase:'QA01_EMAIL_READ',signupProviderCode:'InvalidLambdaResponseException'}])[0]).not.toHaveProperty('signupProviderCode');
  expect(safeResults([{title:REQUIRED_TESTS[0],status:'failed',phase:'QA01_SIGNUP',signupProviderCode:'PRIVATE'}])[0]).not.toHaveProperty('signupProviderCode');
});

test('bounded signup selection cannot run paid journeys or promote partial evidence to whole-release PASS',async()=>{
  // @ts-expect-error Exact runner selection boundary.
  const {qualificationSelection}=await import('../../scripts/live-qa/runner-core.mjs');
  expect(qualificationSelection()).toEqual([]);expect(qualificationSelection('signup')).toEqual(['--grep','(^| )QA01 signup and managed login$']);expect(()=>qualificationSelection('.*')).toThrow('QA_JOURNEY_SCOPE_INVALID');
  const good={runId:'run-12345',runScope:'SIGNUP_ONLY',processExitCode:0,processSignal:null,reportStatus:'passed',globalErrors:0,failedTests:0,preflight:'PASS',fixtures:'PASS',tests:[{title:REQUIRED_TESTS[0],status:'passed'}],attempts:0,signupMessages:1,privacy:'PASS',cleanup:'CLEAN'};
  expect(qualificationReport(good)).toMatchObject({runScope:'SIGNUP_ONLY',diagnosticStatus:'PASS',status:'BLOCKED_OR_FAILED',counts:{passed:1,blocked:6,modelAttempts:0}});
  for(const change of [{attempts:1},{signupMessages:0},{cleanup:'FAILED'},{privacy:'UNKNOWN'},{preflight:'BLOCKED'},{processExitCode:1},{tests:REQUIRED_TESTS.map((title:string)=>({title,status:'passed'}))}])expect(qualificationReport({...good,...change}).diagnosticStatus).toBe('BLOCKED_OR_FAILED');
  expect(qualificationReport({...good,attempts:4,tests:REQUIRED_TESTS.map((title:string)=>({title,status:'passed'}))}).status).toBe('BLOCKED_OR_FAILED');
});


test('signup-only selection discovers exactly QA01 using the real Playwright CLI without executing fixtures',async()=>{
  // @ts-expect-error JavaScript selection is applied to actual fully qualified titles.
  const {qualificationSelection}=await import('../../scripts/live-qa/runner-core.mjs');
  const listed=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config=playwright.live-qa.config.ts','--list','--reporter=json',...qualificationSelection('signup')],{encoding:'utf8',timeout:30000,env:{...process.env,QA_RESULTS_FILE:''}});
  expect(listed.status).toBe(0);
  const report=JSON.parse(listed.stdout);
  const titles=(suites:Array<{specs?:Array<{title:string}>;suites?:unknown[]}>):string[]=>suites.flatMap(suite=>[...(suite.specs??[]).map(spec=>spec.title),...titles((suite.suites??[]) as typeof suites)]);
  expect(report.errors).toEqual([]);expect(titles(report.suites)).toEqual([REQUIRED_TESTS[0]]);
});


test('missing registration entry is reported before a submitted Cognito operation without stale provider annotations',async()=>{
  // @ts-expect-error Fixed reporter boundary handles the real entry-phase failure.
  const {default:Reporter}=await import('../../scripts/live-qa/sanitized-reporter.mjs');
  const reporter=new Reporter();const t={title:REQUIRED_TESTS[0],annotations:[{type:'qa-operation-status',description:'HTTP_BAD_REQUEST'},{type:'qa-signup-provider-code',description:'InvalidPasswordException'}]};
  reporter.onStepEnd(t,{}, {title:'QA01_REGISTRATION_ENTRY',error:{message:'PRIVATE_ENTRY_DETAIL'}});reporter.onTestEnd(t,{status:'failed'});
  expect(safeResults(reporter.tests)[0]).toEqual({title:REQUIRED_TESTS[0],phase:'QA01_REGISTRATION_ENTRY',status:'FAIL'});
});
