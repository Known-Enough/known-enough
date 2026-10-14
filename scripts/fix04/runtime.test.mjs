import test from 'node:test';
import assert from 'node:assert/strict';
import { accountCatalog,sanitizeError,OperatorIOError } from './runtime.mjs';
test('key-only catalog follows every page and cannot request private payloads or silently truncate',async()=>{
 const calls=[];const pages=[{Items:[{PK:{S:'ACCOUNT#first'},SK:{S:'STATE'}}],LastEvaluatedKey:{PK:{S:'GROUP#last'},SK:{S:'STATE'}}},{Items:[{PK:{S:'ACCOUNT#second'},SK:{S:'STATE'}}]}];
 const received=[];for await(const page of accountCatalog(async(...args)=>{calls.push(args);return pages.shift();}))received.push(...page);
 assert.deepEqual(received,['first','second']);assert.equal(calls.length,2);assert.equal(calls[0][0],'dynamodb');assert.equal(calls[0][1],'scan');const args=calls[0][2];assert.equal(args[args.indexOf('--projection-expression')+1],'PK,SK');assert.equal(args[args.indexOf('--select')+1],'SPECIFIC_ATTRIBUTES');assert.ok(args.includes('--consistent-read'));assert.ok(calls[1][2].includes('--exclusive-start-key'));assert.ok(!JSON.stringify(calls).includes('payload'));
});
test('repeated pagination, extra payload fields, wrong namespace and provider failure fail closed',async()=>{
 for(const data of [{Items:[{PK:{S:'GROUP#other'},SK:{S:'STATE'}}]},{Items:[{PK:{S:'ACCOUNT#first'},SK:{S:'STATE'},payload:{S:'PRIVATE_CANARY'}}]}])await assert.rejects(async()=>{for await(const page of accountCatalog(async()=>data))assert.ok(page);});
 await assert.rejects(async()=>{for await(const page of accountCatalog(async()=>({Items:[],LastEvaluatedKey:{PK:{S:'ACCOUNT#first'},SK:{S:'STATE'}}})))assert.ok(page);});
 const failure=new OperatorIOError('dynamodb:Scan','AccessDeniedException');await assert.rejects(async()=>{for await(const page of accountCatalog(async()=>{throw failure;}))assert.ok(page);},error=>error===failure);
});
test('sanitized failures cannot contain raw usernames, URLs, provider messages or arbitrary code strings',()=>{
 const privateError=new Error('PRIVATE_CANARY');privateError.code='PRIVATE_CANARY';assert.deepEqual(sanitizeError(privateError),{operation:'NATIVE_OPERATOR',code:'OPERATOR_UNAVAILABLE'});assert.deepEqual(sanitizeError(new OperatorIOError('dynamodb:Scan','AccessDeniedException')),{operation:'dynamodb:Scan',code:'AccessDeniedException'});
});
test('native SDK denial preserves only the exact allowed operation and code through its cause',()=>{
 const denied=new Error('PRIVATE_ACCOUNT_CANARY not authorized to perform: dynamodb:ConditionCheckItem on PRIVATE_RESOURCE_CANARY');denied.name='AccessDeniedException';const wrapper=new Error('PARTITION_STORAGE_UNAVAILABLE',{cause:denied});assert.deepEqual(sanitizeError(wrapper),{operation:'dynamodb:ConditionCheckItem',code:'AccessDeniedException'});assert.ok(!JSON.stringify(sanitizeError(wrapper)).includes('PRIVATE_'));
});
