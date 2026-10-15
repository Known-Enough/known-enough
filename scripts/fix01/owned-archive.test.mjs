import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { partitionSeedRows } from '../../packages/adapters/src/partitioned-group-repository.ts';
import { partitionDirectoryKey } from '../../packages/adapters/src/partition-directory.ts';
import { preparePartitionArchive } from '../../packages/adapters/src/partition-archive.ts';
import { ownedArchiveEntries,archiveFailureCode,archiveInputChecks,archiveExceptionMetadata,archivePolicyOutput } from './owned-archive.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
function storage(acceptedBy='member') {
 const group={id:'owned-group',name:'Owned garden',organizer:'organizer',version:2,members:['organizer','member'],drafts:[],decisions:[{id:'owned-decision',version:1}],invitations:[{tokenHash:hash('invitation'),recipientHash:hash('member'),expiresAt:1,acceptedBy}]};
 const accounts=group.members.map(subject=>({subject,emailHash:hash(subject),displayName:subject,status:'APPROVED',version:1}));
 const items=new Map();const key=k=>k.PK+'/'+k.SK;
 for(const row of partitionSeedRows({accounts,groups:[group]},{groupId:group.id,accountSubjects:group.members}))if(row.next.kind!=='ACCOUNT')items.set(key(row.key),row.next);
 for(const value of [{type:'DECISION',groupId:group.id,decisionId:'owned-decision'},{type:'INVITATION',groupId:group.id,...group.invitations[0]}]){
  delete value.acceptedBy;items.set(key(partitionDirectoryKey(value)),{schemaVersion:1,revision:1,kind:'DIRECTORY',value});
 }
 const reads=[];return {items,key,reads,groups:{read:async k=>{reads.push(k);return structuredClone(items.get(key(k)));}}};
}
test('owned second-member decision cleanup includes invitation and decision directories in a valid archive',async()=>{
 const s=storage();const {entries}=await ownedArchiveEntries(s.groups,'owned-group','organizer',['organizer','member']);
 const plan=preparePartitionArchive(entries,'owned-group','a'.repeat(40));
 assert.equal(plan.entries.length,4);assert.ok(plan.entries.some(item=>item.key.PK.startsWith('INVITATION#')));
 assert.ok(plan.entries.some(item=>item.key.PK.startsWith('DECISION#')));
});
test('foreign or unaccepted invitation prevents cleanup before reading child rows',async()=>{
 for(const recipient of ['foreign',null]){
  const s=storage(recipient);await assert.rejects(ownedArchiveEntries(s.groups,'owned-group','organizer',['organizer','member']),/OWN_EMPTY_GROUP_REQUIRED/);assert.equal(s.reads.length,1);
 }
});
test('missing immutable invitation record fails archive validation rather than omitting the claim',async()=>{
 const s=storage();for(const k of s.items.keys())if(k.startsWith('INVITATION#'))s.items.delete(k);
 const {entries}=await ownedArchiveEntries(s.groups,'owned-group','organizer',['organizer','member']);
 assert.throws(()=>preparePartitionArchive(entries,'owned-group','a'.repeat(40)),/ARCHIVE_INVALID/);
});
test('archive diagnostics retain only finite codes without arbitrary messages',()=>{
 assert.equal(archiveFailureCode({code:'ARCHIVE_STORAGE_UNAVAILABLE',message:'private'}),'ARCHIVE_STORAGE_UNAVAILABLE');
 assert.equal(archiveFailureCode({code:'private',message:'private'}),undefined);
});
test('archive input diagnostics expose structural booleans and count without contents',async()=>{
 const s=storage();const {header,entries}=await ownedArchiveEntries(s.groups,'owned-group','organizer',['organizer','member']);
 header.value.name='PRIVATE_GROUP_MARKER';
 const checks=archiveInputChecks(header,entries);assert.ok(!JSON.stringify(checks).includes('PRIVATE'));assert.equal(checks.groupValid,true);assert.equal(checks.directoriesMatch,true);
 for(const [key,value] of Object.entries(checks))assert.equal(typeof value,key==='entries'?'number':'boolean');
 entries.splice(entries.findIndex(e=>e.key.PK.startsWith('INVITATION#')),1);assert.equal(archiveInputChecks(header,entries).directoriesMatch,false);
});
test('exception diagnostics strip private paths/messages and retain only fixed source positions and AWS codes',()=>{
 const result=archiveExceptionMetadata({name:'TypeError',stderr:'An error occurred (AccessDeniedException): PRIVATE_SUBJECT',stack:'TypeError: PRIVATE_MESSAGE /prove.mjs:2:3\n at owned (/PRIVATE_HOME/scripts/fix01/prove.mjs:44:12)\n at foreign (/PRIVATE_HOME/secret.ts:9:4)'});
 assert.deepEqual(result,{exceptionName:'TypeError',awsCode:'AccessDeniedException',sourceFrames:[{file:'prove.mjs',line:44,column:12}]});assert.ok(!JSON.stringify(result).includes('PRIVATE'));
 assert.deepEqual(archiveExceptionMetadata({name:'PRIVATE',stderr:'(PRIVATE)'}),{});
});
test('empty successful policy lookup is absent, while malformed and noncanonical records stay invalid',()=>{
 for(const response of ['','\n','{}'])assert.equal(archivePolicyOutput(response).present,false);
 const policy={schemaVersion:1,revision:1,kind:'ARCHIVE_POLICY',enabled:true,actors:[143764700]};
 const item={PK:{S:'OPERATIONS#ARCHIVE'},SK:{S:'STATE'},revision:{N:'1'},payload:{S:JSON.stringify(policy)}};
 const flags=archivePolicyOutput(JSON.stringify({Item:item}));assert.ok(Object.values(flags).every(Boolean));
 const reordered={kind:policy.kind,...policy};item.payload.S=JSON.stringify(reordered);assert.equal(archivePolicyOutput(JSON.stringify({Item:item})).canonicalMatches,false);
 item.payload={};assert.equal(archivePolicyOutput(JSON.stringify({Item:item})).schemaValid,false);
 assert.throws(()=>archivePolicyOutput('not json'),SyntaxError);
});
