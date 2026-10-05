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

test('HTTP diagnostics accept only numeric protocol outcomes',()=>{expect(operationStatus(200)).toBe('HTTP_OK');expect(operationStatus(422)).toBe('HTTP_UNPROCESSABLE');for(const status of ['toString','PRIVATE_TOKEN',undefined,null,NaN,0,600])expect(operationStatus(status)).toBe('HTTP_OTHER_FAILURE');});

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
    expect(load.tests[0]).not.toHaveProperty('operationStatus');
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
