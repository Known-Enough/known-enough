import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
// @ts-expect-error Use the broker's isolated pinned SDK instance, not the root workspace SDK.
import { DynamoDBClient } from '../../scripts/live-qa/node_modules/@aws-sdk/client-dynamodb/dist-cjs/index.js';
// @ts-expect-error Offline QA configuration is exercised at runtime.
import { draftConfiguration, configurationStatus } from '../../scripts/live-qa/configure.mjs';
// @ts-expect-error Offline QA templates are exercised at runtime.
import { renderTemplates } from '../../scripts/live-qa/template.mjs';
// @ts-expect-error Mailbox API has a bounded injected transport for verification.
import { createMailtmClient, mailtmVerificationCode, mailtmMessageStatus } from '../../scripts/live-qa/mailtm.mjs';
// @ts-expect-error Real Cognito trigger boundary is exercised with injected AWS responses.
import { customMessage } from '../../scripts/live-qa/broker.mjs';

const mailbox = {runId:'run-12345',id:'account-123',address:'synthetic@qa.example.org',password:'SYNTHETIC_PASSWORD_CANARY',token:'SYNTHETIC_TOKEN_CANARY',createdAt:Date.parse('2026-10-01T00:00:00Z')};
const message = {accountId:mailbox.id,to:[{address:mailbox.address}],from:{address:'no-reply@verificationemail.com'},createdAt:'2026-10-01T00:01:00Z',text:'Your verification code is 123456.'};
const response = (body: unknown, status=200) => new Response(status===204?null:JSON.stringify(body),{status});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});

describe('LIVE04 Mail.tm preparation without AWS writes or real messages',()=>{
  test('free configuration requires only the pinned commit and preserves disabled budgets',()=>{
    const draft=draftConfiguration({mailboxProvider:'mailtm'});
    expect(configurationStatus(draft).missing).toEqual(['sourceCommit']);
    const c=draftConfiguration({mailboxProvider:'mailtm',sourceCommit:'a'.repeat(40)});
    expect(configurationStatus(c)).toMatchObject({status:'READY_FOR_READ_ONLY_VALIDATION',authorizationEnabled:false,cloudWrites:false});
    expect(c.mailDomain).toBeNull();expect(c.hostedZoneId).toBeNull();expect(c.authorization.maxRunsPerDay).toBe(0);
    expect(()=>draftConfiguration({mailboxProvider:'mailtm',mailDomain:'qa.example.org'})).toThrow();
    expect(()=>draftConfiguration({mailboxProvider:'untrusted'})).toThrow();
    const templates=renderTemplates(c,{apiKey:'b'.repeat(64)+'/api.zip',brokerKey:'c'.repeat(64)+'/broker.zip'});
    expect(templates.mail).toBeNull();
    expect(templates.core.Resources.Pool.Properties.EmailConfiguration).toEqual({EmailSendingAccount:'COGNITO_DEFAULT'});
    expect(JSON.stringify(templates.core)).not.toMatch(/AWS::SES|AWS::Route53|s3:ListBucket|verification\/\*/);
    expect(templates.core.Resources.ApiFunction.Properties.Environment.Variables.KE14_MODEL_MODE).toBe('DISABLED');
    expect(templates.core.Resources.Broker.Properties.Environment.Variables.QA_MAIL_PROVIDER).toBe('mailtm');
    expect(readFileSync('scripts/live-qa/install.mjs','utf8')).toContain('MAILBOX_PROVIDER_MIGRATION_REQUIRED');
  });
  test('only an exact recipient, mailbox, sender and new unambiguous confirmation code is accepted',()=>{
    expect(mailtmVerificationCode(message,mailbox)).toBe('123456');
    expect(mailtmVerificationCode({...message,text:'',html:['Your verification code is <b>123456</b>.']},mailbox)).toBe('123456');
    for(const change of [{accountId:'other'},{to:[{address:'other@example.org'}]},{from:{address:'attacker@example.org'}},
      {createdAt:'2025-01-01T00:00:00Z'},{createdAt:'invalid'},{isDeleted:true},{text:'code: 123456'},
      {text:'Your verification code is 1234567'},{text:'verification code: 123456; verification code: 654321'}]) {
      expect(mailtmVerificationCode({...message,...change},mailbox)).toBeNull();
    }
  });
  test('discovers an active public domain and never accepts provider redirects or exposes diagnostics',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(response({'hydra:member':[{domain:'private.example.org',isActive:true,isPrivate:true},{domain:'mail.example.org',isActive:true,isPrivate:false}]}))
      .mockResolvedValueOnce(response({error:mailbox.password},429));
    const client=createMailtmClient(fetcher,async()=>{});
    expect(await client.domain()).toBe('mail.example.org');
    await expect(client.domain()).rejects.toThrow('MAILTM_REQUEST_FAILED');
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.mail.tm/domains');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({redirect:'error'});
  });
  test('a creation retry authenticates the recorded intent instead of adopting an unrelated inbox',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(response({},422)).mockResolvedValueOnce(response({id:mailbox.id,token:mailbox.token}))
      .mockResolvedValueOnce(response({id:mailbox.id,address:mailbox.address}));
    const client=createMailtmClient(fetcher,async()=>{});
    expect(await client.create(mailbox)).toMatchObject({id:mailbox.id,address:mailbox.address});
    const wrong=vi.fn().mockResolvedValueOnce(response({id:mailbox.id,address:mailbox.address})).mockResolvedValueOnce(response({id:mailbox.id,token:mailbox.token}))
      .mockResolvedValueOnce(response({id:mailbox.id,address:'foreign@example.org'}));
    await expect(createMailtmClient(wrong,async()=>{}).create(mailbox)).rejects.toThrow('MAILTM_OWNER_MISMATCH');
    expect(wrong.mock.calls.some(call=>call[1].method==='DELETE')).toBe(false);
  });
  test('retrieves the actual message through authenticated endpoints and propagates service failures',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(response({id:mailbox.id,token:mailbox.token}))
      .mockResolvedValueOnce(response({id:mailbox.id,address:mailbox.address}))
      .mockResolvedValueOnce(response({'hydra:member':[{id:'message-123',size:200}]}))
      .mockResolvedValueOnce(response(message));
    expect(await createMailtmClient(fetcher,async()=>{}).code(mailbox)).toBe('123456');
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe('https://api.mail.tm/messages/message-123');
    expect(fetcher.mock.calls.at(-1)?.[1].headers.Authorization).toBe('Bearer '+mailbox.token);
    const failed=vi.fn().mockRejectedValue(new Error(mailbox.password));
    await expect(createMailtmClient(failed,async()=>{}).code(mailbox)).rejects.toThrow('MAILTM_REQUEST_FAILED');
  });
  test('cleanup deletes only a verified owned inbox and fails on deletion errors',async()=>{
    const owned={id:mailbox.id,address:mailbox.address};
    const fetcher=vi.fn().mockResolvedValueOnce(response(owned)).mockResolvedValueOnce(response({id:mailbox.id,token:mailbox.token}))
      .mockResolvedValueOnce(response(owned)).mockResolvedValueOnce(response(null,204));
    await createMailtmClient(fetcher,async()=>{}).remove(mailbox);
    expect(fetcher.mock.calls.at(-1)).toMatchObject(['https://api.mail.tm/accounts/account-123',{method:'DELETE'}]);
    const deleted=vi.fn().mockResolvedValueOnce(response({},404));
    await createMailtmClient(deleted,async()=>{}).remove(mailbox);expect(deleted).toHaveBeenCalledTimes(1);
    const wrong=vi.fn().mockResolvedValueOnce(response({...owned,address:'foreign@example.org'}));
    await expect(createMailtmClient(wrong,async()=>{}).remove(mailbox)).rejects.toThrow('MAILTM_OWNER_MISMATCH');
    const failed=vi.fn().mockResolvedValueOnce(response(owned)).mockResolvedValueOnce(response({id:mailbox.id,token:mailbox.token}))
      .mockResolvedValueOnce(response(owned)).mockResolvedValueOnce(response({},503));
    await expect(createMailtmClient(failed,async()=>{}).remove(mailbox)).rejects.toThrow('MAILTM_REQUEST_FAILED');
  });
  test('default Cognito messages still reserve the exact run email budget and deny other recipients',async()=>{
    vi.stubEnv('QA_MAIL_PROVIDER','mailtm');vi.stubEnv('QA_CONTROL_TABLE','qa-control');
    const a={...JSON.parse(readFileSync('infra/live-qa/config.example.json','utf8')).authorization,approved:true,expiresAt:new Date(Date.now()+60000).toISOString(),maxRunsPerDay:4,maxAttemptsPerRun:200,maxTokensPerRun:250000,maxCostMicrosPerRun:250000,attemptCostMicros:1,retentionReviewed:true,invocationLoggingDisabled:true,maxSignupMessagesPerRun:2,maxSignupMessagesPerDay:4};
    const l={id:'run-12345',status:'ACTIVE',expiresAt:Date.now()+60000,users:[{actor:'signup',email:mailbox.address}]};
    const send=vi.spyOn(DynamoDBClient.prototype,'send').mockImplementation(async(...args: unknown[])=>{
      const command=args[0] as {input:{Key?:{PK:{S:string}}}};
      if(!command.input.Key)return {};
      const value=command.input.Key.PK.S==='AUTH'?a:command.input.Key.PK.S==='LEASE'?l:command.input.Key.PK.S==='TOTAL'?{runs:1,reservedTokens:0,reservedCostMicros:0,messages:0}:{};
      return {Item:{payload:{S:JSON.stringify(value)},version:{N:'1'}}};
    });
    const event={triggerSource:'CustomMessage_SignUp',userName:'qa-run-12345-signup',request:{userAttributes:{email:mailbox.address}},response:{}};
    expect(await customMessage(event)).toEqual(event);expect(event.response).toEqual({});
    expect(send.mock.calls.at(-1)?.[0].constructor.name).toBe('TransactWriteItemsCommand');
    await expect(customMessage({...event,request:{userAttributes:{email:'human@example.org'}}})).rejects.toThrow('QA_MESSAGE_DENIED');
    a.maxSignupMessagesPerRun=0;
    await expect(customMessage(event)).rejects.toThrow('QA_MESSAGE_BUDGET');
  });
});


test('mail diagnosis keeps strict sender/owner/recipient/date/code checks and exposes only fixed tags', async () => {
  expect(mailtmMessageStatus(message,mailbox)).toBe('MAIL_CODE_READY');
  for (const [change,status] of [
    [{accountId:'foreign'},'MAIL_OWNER_MISMATCH'],[{from:{address:'private@example.invalid'}},'MAIL_SENDER_MISMATCH'],
    [{to:[{address:'private@example.invalid'}]},'MAIL_RECIPIENT_MISMATCH'],[{createdAt:'2025-01-01'},'MAIL_OLD_MESSAGE'],
    [{text:'PRIVATE_BODY_PASSWORD'},'MAIL_CODE_UNRECOGNIZED'],[{text:'verification code: 123456; confirmation code: 654321'},'MAIL_CODE_AMBIGUOUS']
  ] as const) { expect(mailtmMessageStatus({...message,...change},mailbox)).toBe(status);expect(mailtmVerificationCode({...message,...change},mailbox)).toBeNull(); }
  const tags:string[]=[];const fetcher=vi.fn().mockResolvedValueOnce(response({id:mailbox.id,token:mailbox.token})).mockResolvedValueOnce(response({id:mailbox.id,address:mailbox.address})).mockResolvedValueOnce(response({'hydra:member':[]}));
  expect(await createMailtmClient(fetcher,async()=>{}).code(mailbox,(tag:string)=>tags.push(tag))).toBeNull();expect(tags).toEqual(['MAIL_EMPTY']);
});


test('provider account links identify only the already authenticated inbox; never follow or normalize arbitrary URLs', async () => {
  for (const accountId of [mailbox.id,'/accounts/'+mailbox.id,'https://api.mail.tm/accounts/'+mailbox.id])
    expect(mailtmVerificationCode({...message,accountId},mailbox)).toBe('123456');
  for (const accountId of [undefined,null,'/accounts/foreign','https://attacker.invalid/accounts/'+mailbox.id,
    'https://api.mail.tm/accounts/'+mailbox.id+'?other=1','/accounts/'+mailbox.id+'#other',
    '/accounts/foreign/../'+mailbox.id,'https://api.mail.tm@attacker.invalid/accounts/'+mailbox.id]) {
    expect(mailtmMessageStatus({...message,accountId},mailbox)).toBe('MAIL_OWNER_MISMATCH');
    expect(mailtmVerificationCode({...message,accountId},mailbox)).toBeNull();
  }
  const fetcher=vi.fn().mockResolvedValueOnce(response({id:mailbox.id,token:mailbox.token})).mockResolvedValueOnce(response({id:mailbox.id,address:mailbox.address}))
    .mockResolvedValueOnce(response({'hydra:member':[{id:'message-123',size:200}]})).mockResolvedValueOnce(response({...message,accountId:'/accounts/'+mailbox.id}));
  expect(await createMailtmClient(fetcher,async()=>{}).code(mailbox)).toBe('123456');
  expect(fetcher.mock.calls.map(call=>call[0])).toEqual(['https://api.mail.tm/token','https://api.mail.tm/me','https://api.mail.tm/messages?page=1','https://api.mail.tm/messages/message-123']);
});
