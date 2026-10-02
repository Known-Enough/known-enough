import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
// @ts-expect-error Node-only live qualification boundary, with no cloud calls.
import { qualificationReport, REQUIRED_TESTS } from '../../scripts/live-qa/runner-core.mjs';
// @ts-expect-error CLI invocation injected below so it never invokes AWS.
import { invokeBroker } from '../../scripts/live-qa/runner.mjs';
// @ts-expect-error Playwright reporter receives synthetic events, no browser/provider calls.
import Reporter from '../../scripts/live-qa/sanitized-reporter.mjs';
// @ts-expect-error Read-only CLI requests injected below, unchanged shared inspector.
import { routingMatches, collectRouting, EXPECTED_ROUTING as expected, REQUIRED_ROUTES } from '../../scripts/live-qa/metadata.mjs';
import { renewSessions, type Session } from '../live/qa/helpers.ts';
const good = {runId: 'run-12345', sourceCommit:'a'.repeat(40), preflight:'PASS', fixtures:'PASS', cleanup:'CLEAN', privacy:'PASS', attempts:3, signupMessages:1,
  tests:REQUIRED_TESTS.map((title: string) => ({title,status:'passed'})), processExitCode:0,processSignal:null,reportStatus:'passed',globalErrors:0,failedTests:0};
it.each([{processExitCode:1},{processExitCode:null},{processSignal:'SIGTERM'},{reportStatus:'failed'},{reportStatus:'timedout'},
  {globalErrors:1},{globalErrors:undefined},{failedTests:1},{reportStatus:undefined}])('global/process failures cannot pass seven green journeys: %s', change => {
  expect(qualificationReport(good).status).toBe('PASS'); expect(qualificationReport({...good,...change}).status).toBe('BLOCKED_OR_FAILED');
});
it('records static global failure counts and completion without publishing private errors', () => {
  const directory=mkdtempSync(resolve(tmpdir(),'qa-global-'));const previous=process.env.QA_RESULTS_FILE;
  process.env.QA_RESULTS_FILE=directory+'/result.json';
  try { const reporter=new Reporter(); for(const title of REQUIRED_TESTS)reporter.onTestEnd({title},{status:'passed'});
    reporter.onError({message:'PRIVATE_TOKEN secret'});reporter.onTestEnd({title:'PRIVATE extra test'},{status:'failed',error:'PRIVATE'});
    reporter.onEnd({status:'failed',error:'PRIVATE'});const output=readFileSync(process.env.QA_RESULTS_FILE,'utf8');expect(output).not.toMatch(/PRIVATE|secret/);
    const result=JSON.parse(output);expect(result).toMatchObject({status:'failed',globalErrors:1,failedTests:1});
    expect(qualificationReport({...good,reportStatus:result.status,globalErrors:result.globalErrors,failedTests:result.failedTests}).status).toBe('BLOCKED_OR_FAILED');
  } finally {if(previous===undefined)delete process.env.QA_RESULTS_FILE;else process.env.QA_RESULTS_FILE=previous;rmSync(directory,{recursive:true,force:true});}
});
it('missing completion and malformed test data remain blocked', () => {
  expect(qualificationReport({...good,tests:{}}).status).toBe('BLOCKED_OR_FAILED');
  expect(qualificationReport({...good,tests:[null,...good.tests.slice(1)]}).status).toBe('BLOCKED_OR_FAILED');
});
it('broker socket/process deadlines cover the 180-second Lambda with no automatic retry', () => {
  const execute=vi.fn((_name:string,args:string[],options:{timeout:number;env:Record<string,string>}) => {
    expect(args).toContain('--cli-read-timeout');expect(args[args.indexOf('--cli-read-timeout')+1]).toBe('210');expect(options.timeout).toBe(225000);
    expect(options.env.AWS_MAX_ATTEMPTS).toBe('1');writeFileSync(args[args.indexOf('--output')-1]!,JSON.stringify({status:'PASS'}));return {status:0,stdout:'{}'};
  });expect(invokeBroker({BrokerFunction:'known-enough-qa-fixtures'},good.runId,'stats',{},execute).status).toBe('PASS');expect(execute).toHaveBeenCalledTimes(1);
  expect(()=>invokeBroker({BrokerFunction:'known-enough-qa-fixtures'},good.runId,'stats',{},()=>({status:null,signal:'SIGTERM',stdout:'PRIVATE'}))).toThrow('QA_BROKER_UNAVAILABLE');
});
function routing() {
  return {apiId:'u94iyvt6p9',routes:[...REQUIRED_ROUTES,...['OPTIONS /account','OPTIONS /account/register','OPTIONS /groups','OPTIONS /groups/{proxy+}','OPTIONS /decisions','OPTIONS /decisions/{proxy+}']].map((RouteKey:string)=>({RouteKey,Target:'integrations/'+expected.integrationId,AuthorizationType:RouteKey.startsWith('OPTIONS ')?'NONE':'JWT',...(RouteKey.startsWith('OPTIONS ')?{}:{AuthorizerId:expected.authorizerId})})),
    authorizers:[{AuthorizerId:expected.authorizerId,AuthorizerType:'JWT',IdentitySource:['$request.header.Authorization'],JwtConfiguration:{Issuer:expected.issuer,Audience:expected.audiences}}],
    integrations:[{IntegrationId:expected.integrationId,IntegrationType:'AWS_PROXY',IntegrationMethod:'POST',PayloadFormatVersion:'2.0',ConnectionType:'INTERNET',IntegrationUri:expected.functionArn}]};
}
it('routing proves fixed authorizer, issuer/audiences, integration and every protected route',()=>{
  expect(routingMatches(routing())).toBe(true);
  const changes=[(r:ReturnType<typeof routing>)=>{r.routes[0]!.AuthorizerId='wrong';},(r:ReturnType<typeof routing>)=>{r.routes[0]!.Target='integrations/wrong';},
    (r:ReturnType<typeof routing>)=>{r.authorizers[0]!.JwtConfiguration.Issuer='https://wrong.invalid';},(r:ReturnType<typeof routing>)=>{r.authorizers[0]!.JwtConfiguration.Audience=['wrong'];},
    (r:ReturnType<typeof routing>)=>{r.integrations[0]!.IntegrationUri='arn:aws:lambda:us-east-1:092954139775:function:foreign';},(r:ReturnType<typeof routing>)=>{r.integrations[0]!.PayloadFormatVersion='1.0';},
    (r:ReturnType<typeof routing>)=>{r.routes.pop();},(r:ReturnType<typeof routing>)=>{r.routes.push(r.routes[0]!);}];
  for(const change of changes){const r=routing();change(r);expect(routingMatches(r)).toBe(false);}
  const call=vi.fn((_service:string,operation:string,input:object)=>{expect(input).toEqual({ApiId:'u94iyvt6p9'});return {Items:operation==='get-routes'?routing().routes:operation==='get-authorizers'?routing().authorizers:routing().integrations};});
  expect(routingMatches(collectRouting(call))).toBe(true);expect(call).toHaveBeenCalledTimes(3);
});
it('API, harness, live config and qualification workflow source all trigger the trusted upstream build',()=>{
  const workflow=readFileSync('.github/workflows/deploy-amplify-staging.yml','utf8');
  for(const path of ['apps/api/**','scripts/live-qa/**','tests/live/qa/**','infra/live-qa/**','playwright.live-qa.config.ts','.github/workflows/live-qa-release-and-check.yml'])expect(workflow).toContain("'"+path+"'");
  expect(readFileSync('.github/workflows/live-qa-release-and-check.yml','utf8')).toContain("workflows: ['Deploy Known Enough staging to AWS Amplify']");
});
it('test boundaries replace all old sessions via authentication and keep denied actors subject to server checks',async()=>{
  const session=(actor:string)=>({user:{actor},context:{close:vi.fn(async()=>{})}} as unknown as Session);
  const old=session('iris'),denied=session('disabled'),fresh=session('iris');const sessions=[old,denied,fresh],people=[old];
  const authenticate=vi.fn(async(prior:Session)=>session(prior.user.actor));await renewSessions(sessions,people,authenticate);
  expect(authenticate).toHaveBeenCalledTimes(2);expect(sessions).toHaveLength(2);expect(people[0]).not.toBe(old);expect(people[0]).toBe(sessions.find(s=>s.user.actor==='iris'));
  expect(old.context.close).toHaveBeenCalled();expect(fresh.context.close).toHaveBeenCalled();expect(denied.context.close).toHaveBeenCalled();
  const source=readFileSync('tests/live/qa/journey.spec.ts','utf8');expect(source).toContain('test.beforeEach');expect(source).toContain('await renewSessions');
  expect(source).toContain('claims.exp*1000-Date.now()+2000');expect(source).toContain('request(fresh,');
});
