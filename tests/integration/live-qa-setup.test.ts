import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { qaHandler } from '../../scripts/live-qa/entry.ts';
import { budgetedTransport } from '../../scripts/live-qa/budget.mjs';
// @ts-expect-error Setup JavaScript is exercised at runtime by Vitest.
import { validateConfig, publicTarget, digest } from '../../scripts/live-qa/config.mjs';
// @ts-expect-error Setup JavaScript is exercised at runtime by Vitest.
import { renderTemplates } from '../../scripts/live-qa/template.mjs';
// @ts-expect-error Setup JavaScript is exercised at runtime by Vitest.
import { beginLease, cleanupPlan } from '../../scripts/live-qa/fixture-core.mjs';
// @ts-expect-error Setup JavaScript is exercised at runtime by Vitest.
import { installationPlan, mailboxGuard, verifyRuntime } from '../../scripts/live-qa/install.mjs';
// @ts-expect-error Setup JavaScript is exercised at runtime by Vitest.
import { preservationInput } from '../../scripts/live-qa/aws.mjs';
// @ts-expect-error Setup JavaScript is exercised at runtime by Vitest.
import { primaryPlan } from '../../scripts/live-qa/primary.mjs';
// @ts-expect-error Bundled broker JavaScript uses the real application, not test fixtures.
import { verificationCode } from '../../scripts/live-qa/broker.mjs';
const base=JSON.parse(readFileSync('infra/live-qa/config.example.json','utf8'));
const config={...base,sourceCommit:'a'.repeat(40),mailDomain:'qa.example.org',hostedZoneId:'Z123456789'};
const authorization={...base.authorization,approved:true,expiresAt:'2026-10-02T00:00:00Z',retentionReviewed:true,invocationLoggingDisabled:true,maxRunsPerDay:2,maxAttemptsPerRun:2,maxTokensPerRun:10000,maxCostMicrosPerRun:20000,attemptCostMicros:10000,maxSignupMessagesPerRun:2,maxSignupMessagesPerDay:4};
const now=Date.parse('2026-10-01T20:00:00Z');
const artifacts={api:{sha256:'b'.repeat(64)},broker:{sha256:'c'.repeat(64)}};
const manifest={sourceCommit:config.sourceCommit,artifacts};
describe('LIVE01 preparation, no AWS requests',()=>{
  test('rejects malformed events before opening a cloud transaction',async()=>{expect((await qaHandler({})).statusCode).toBe(503);});
  test('requires exact account, repository, subject and concrete approval fields',()=>{
    expect(validateConfig(config).authorization.approved).toBe(false);
    for(const change of [{account:'000000000000'},{region:'eu-west-1'},{oidcSubject:'repo:Known-Enough/known-enough:*'},{authorization:{...authorization,maxRunsPerDay:0}},{authorization:{...authorization,extra:true}}])expect(()=>validateConfig({...config,...change})).toThrow();
    expect(()=>installationPlan(config,{...manifest,sourceCommit:'d'.repeat(40)})).toThrow('SOURCE_COMMIT_MISMATCH');
  });
  test('renders separate QA storage and roles without primary authority',()=>{
    const {core,mail}=renderTemplates(config,{apiKey:artifacts.api.sha256+'/api.zip',brokerKey:artifacts.broker.sha256+'/broker.zip'});
    const text=JSON.stringify(core);
    expect(text).not.toMatch(/dynamodb:TransactWriteItems|dynamodb:TransactGetItems/);
    expect(text).not.toMatch(/KnownEnoughStage|known-enough-stage-api|us-east-1_V9OMjd0zx|d143q5ravxp5av/);
    expect(core.Resources.Groups.Properties.TableName).toBe('KnownEnoughQaGroups');
    expect(core.Resources.ApiFunction.Properties.Environment.Variables.KE14_MODEL_MODE).toBe('DISABLED');
    const runner=JSON.stringify(core.Resources.TestRole);
    expect(runner).not.toMatch(/UpdateFunction|AdminCreateUser|dynamodb:|bedrock:|s3:/);
    expect(runner).toContain(config.oidcSubject);
    expect(JSON.stringify(core.Resources.ReleaseRole.Properties.Policies)).not.toMatch(/UpdateFunctionConfiguration|cognito-idp:|iam:/);
    expect(mail.Resources.Mailbox.Properties.PublicAccessBlockConfiguration.BlockPublicPolicy).toBe(true);
    expect(core.Resources.Pool.Properties.EmailConfiguration.EmailSendingAccount).toBe('DEVELOPER');
    // Trigger roles must not reference the pool: otherwise Pool -> Trigger -> Role -> Pool is a cycle.
    expect(JSON.stringify(core.Resources.TriggerRole)).not.toContain('Pool');
  });
  test('preserves the complete supported Cognito update configuration',()=>{
    const snapshot={UserPoolId:'pool',LambdaConfig:{PreSignUp:'existing'},Policies:{PasswordPolicy:{MinimumLength:25}},DeletionProtection:'ACTIVE',ReadOnlyMetadata:'omit'};
    expect(preservationInput(snapshot,{UserPoolId:'',LambdaConfig:{},Policies:{},DeletionProtection:''})).toEqual({...snapshot,ReadOnlyMetadata:undefined});
  });
  test('blocks unrelated active mail rules, domains and existing MX records',()=>{
    const zone={HostedZone:{Name:'example.org.'}};
    expect(()=>mailboxGuard(config,{RuleSet:{Name:'human-production'}},zone,{},false)).toThrow();
    expect(()=>mailboxGuard({...config,mailDomain:'another.org'},{},zone,{},false)).toThrow();
    expect(()=>mailboxGuard(config,{},zone,{ResourceRecordSets:[{Type:'MX',Name:'qa.example.org.'}]},false)).toThrow();
    expect(()=>mailboxGuard(config,{},zone,{ResourceRecordSets:[]},false)).not.toThrow();
  });
  test('lease blocks expired approval, overlapping runs and incomplete cleanup',()=>{
    const lease=beginLease(null,'run-12345',authorization,now);
    expect(lease.expiresAt).toBe(now+45*60000);
    expect(beginLease(lease,'run-12345',authorization,now)).toEqual(lease);
    for(const prior of [lease,{...lease,status:'CLEANUP_FAILED'}])expect(()=>beginLease(prior,'run-67890',authorization,now)).toThrow();
    expect(()=>beginLease(null,'run-12345',{...authorization,approved:false},now)).toThrow();
  });
  test('cleanup cannot delete foreign aggregate data or unbound decisions',()=>{
    const lease={...beginLease(null,'run-12345',authorization,now),users:[{subject:'qa-owner'}]};
    const state={accounts:[{subject:'qa-owner'}],groups:[{id:'g',organizer:'qa-owner',members:['qa-owner'],decisions:[{id:'d'}]}]};
    expect(cleanupPlan(state,lease)).toEqual({decisions:['d'],groups:['g'],subjects:['qa-owner']});
    expect(()=>cleanupPlan({...state,accounts:[{subject:'human'}]},lease)).toThrow('UNOWNED_QA_STATE');
    expect(()=>cleanupPlan(state,{...lease,decisionIds:['foreign']})).toThrow('UNBOUND_DECISION');
    expect(()=>cleanupPlan({...state,groups:[{...state.groups[0],members:['human']}]},lease)).toThrow();
  });
  test('reserves provider attempts before sending and never sends on CAS failure',async()=>{
    const sends: unknown[]=[];const transactions: unknown[]=[];
    const db={send:async(command: GetItemCommand)=>{if(command.constructor.name==='GetItemCommand')return {Item:{payload:{S:JSON.stringify(command.input.Key?.PK?.S==='AUTH'?authorization:beginLease(null,'run-12345',authorization,now))},version:{N:'1'}}};transactions.push(command);throw new Error('CAS_LOST');}} as unknown as DynamoDBClient;
    const transport=budgetedTransport({send:async(command)=>{sends.push(command);throw new Error('UNEXPECTED_SEND');}},db,'KnownEnoughQaControl',()=>now);
    await expect(transport.send(new ConverseCommand({modelId:'amazon.nova-lite-v1:0',messages:[{role:'user',content:[{text:'fictional'}]}],inferenceConfig:{maxTokens:100}}),{abortSignal:new AbortController().signal})).rejects.toThrow('CAS_LOST');
    expect(sends).toHaveLength(0);expect(JSON.stringify(transactions)).toContain('ConditionCheck');expect(JSON.stringify(transactions)).toContain('LEASE');
  });
  test('validates independently expected deployed hashes and configuration',()=>{
    const target={Account:config.account,Region:config.region,SourceCommit:config.sourceCommit,GroupTable:'groups',DecisionTable:'decisions',ControlTable:'control',PoolId:'pool',ParticipantClientId:'pc',DisplayClientId:'dc'};
    const environment={NP_GROUP_TABLE_NAME:'groups',KE13B_TABLE_NAME:'decisions',QA_CONTROL_TABLE:'control',COGNITO_USER_POOL_ID:'pool',COGNITO_PARTICIPANT_CLIENT_ID:'pc',COGNITO_DISPLAY_CLIENT_ID:'dc',QA_SOURCE_COMMIT:config.sourceCommit,NP_GROUPS_ENABLED:'true'};
    const observed={api:{State:'Active',LastUpdateStatus:'Successful',CodeSha256:Buffer.from(artifacts.api.sha256,'hex').toString('base64'),Environment:{Variables:environment}},broker:{State:'Active',LastUpdateStatus:'Successful',CodeSha256:Buffer.from(artifacts.broker.sha256,'hex').toString('base64')}};
    expect(verifyRuntime(target,manifest,observed)).toBe(true);
    expect(()=>verifyRuntime(target,manifest,{...observed,api:{...observed.api,CodeSha256:'newly-observed-arbitrary'}})).toThrow();
    expect(()=>publicTarget({...target,password:'PRIVATE'})).toThrow('INCOMPLETE_INSTALLED_TARGET');
  });
  test('primary rollout remains behind NP00 hold and revision guards',()=>{
    expect(primaryPlan(config,{})).toEqual({enabled:false});
    const c={...config,primaryRollout:true,primaryExpectedRevision:'r'};
    expect(()=>primaryPlan(c,{RevisionId:'r',State:'Active',LastUpdateStatus:'Successful',Environment:{Variables:{KE14_MODEL_MODE:'BEDROCK'}}})).toThrow();
    expect(()=>primaryPlan(c,{RevisionId:'different'})).toThrow();
  });
  test('extracts actual recipient-bound plain, base64 and quoted-printable mail codes',()=>{
    const email='qa-run-12345-signup@qa.example.org';const body='QA verification code: 123456';
    for(const raw of [`To: ${email}\r\n\r\n${body}`,`To: ${email}\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body).toString('base64')}`,`To: ${email}\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nQA verification code=3A 123456`]){expect(verificationCode(raw,email)).toBe('123456');expect(verificationCode(raw,'human@example.org')).toBeNull();}
  });
  test('private manifest hashes are reproducible and no generated output is required in Git',()=>{
    const directory=mkdtempSync(resolve(tmpdir(),'live-qa-test-'));try{expect(digest('same-bytes')).toBe(digest(Buffer.from('same-bytes')));expect(readFileSync('scripts/live-qa/setup.sh','utf8')).toContain('git checkout --quiet --detach "$commit"');}finally{rmSync(directory,{recursive:true,force:true});}
  });
});
