import test from 'node:test';
import assert from 'node:assert/strict';
import { GetItemCommand } from '@aws-sdk/client-dynamodb';
import { archiveDirectoryReadProof } from './partition-service-check.mjs';
const nonce='12345678-1234-1234-1234-123456789abc';
test('real directory read capabilities use only owned absent keys and consistent reads without any write or participant identity',async()=>{
 const commands=[];const result=await archiveDirectoryReadProof(async (command,options)=>{assert.ok(command instanceof GetItemCommand);assert.ok(options.abortSignal instanceof globalThis.AbortSignal);commands.push(command.input);return {};},nonce);
 assert.equal(result.result,'ARCHIVE_DIRECTORY_ACCESS_PASS');assert.equal(result.mutations,0);assert.equal(commands.length,3);
 assert.ok(commands.every(item=>item.TableName==='KnownEnoughPartitions'&&item.ConsistentRead===true));
 assert.ok(commands[1].Key.PK.S.startsWith('INVITATION#'));assert.ok(commands[2].Key.PK.S.startsWith('DECISION#'));
 assert.ok(!JSON.stringify(result).includes(nonce));
});
test('a directory denial is distinct from an allowed header and cannot be hidden by a successful broad profile probe',async()=>{
 let calls=0;const result=await archiveDirectoryReadProof(async()=>{calls++;if(calls>1)throw Object.assign(new Error('PRIVATE_PROVIDER_MESSAGE'),{name:'AccessDeniedException'});return {};},nonce);
 assert.equal(result.result,'ARCHIVE_DIRECTORY_ACCESS_INCOMPLETE');assert.equal(result.reports[0].result,'READ_ALLOWED');
 assert.equal(result.reports[1].code,'AccessDeniedException');assert.equal(result.requests,3);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('unexpected data collisions fail the probe without publishing contents; invalid own nonce makes no request',async()=>{
 const result=await archiveDirectoryReadProof(async()=>({Item:{payload:{S:'PRIVATE_CANARY'}}}),nonce);assert.equal(result.result,'ARCHIVE_DIRECTORY_ACCESS_INCOMPLETE');assert.ok(!JSON.stringify(result).includes('PRIVATE_CANARY'));
 let calls=0;await assert.rejects(archiveDirectoryReadProof(async()=>{calls++;return {};},'NOT_A_NONCE'));assert.equal(calls,0);
});
