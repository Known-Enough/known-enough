import { partitionGroupKey,PartitionRowSchema,partitionDynamoWrites } from '../../packages/adapters/src/partitioned-group-repository.ts';
import { partitionDirectoryKey } from '../../packages/adapters/src/partition-directory.ts';
import { Groups } from '@deal-table/contracts';
import { isDeepStrictEqual } from 'node:util';

export async function ownedArchiveEntries(groups, groupId, organizer, subjects) {
 const key=partitionGroupKey(groupId),header=await groups.read(key);
 if(header?.kind!=='GROUP'||header.value.organizer!==organizer
  ||header.value.invitations.some(invite=>!subjects.includes(invite.acceptedBy))
  ||header.value.members.some(subject=>!subjects.includes(subject))
  ||header.value.draftIds.length>1||header.value.decisionIds.length>1)throw new Error('OWN_EMPTY_GROUP_REQUIRED');
 const entries=[{key,row:header}];
 for(const id of header.value.draftIds){const child={PK:key.PK,SK:'DRAFT#'+id};entries.push({key:child,row:await groups.read(child)});}
 for(const id of header.value.decisionIds){
  const child={PK:key.PK,SK:'BINDING#'+id};entries.push({key:child,row:await groups.read(child)});
  const directory=partitionDirectoryKey({type:'DECISION',groupId,decisionId:id});entries.push({key:directory,row:await groups.read(directory)});
 }
 for(const invitation of header.value.invitations){
  const directory=partitionDirectoryKey({type:'INVITATION',tokenHash:invitation.tokenHash});
  entries.push({key:directory,row:await groups.read(directory)});
 }
 return {header,entries};
}

export function archiveFailureCode(error) {
 const codes=new Set(['ARCHIVE_INVALID','ARCHIVE_CAPACITY','ARCHIVE_SOURCE_CHANGED','ARCHIVE_AUTHORITY_DENIED',
  'ARCHIVE_TARGET_INACTIVE','ARCHIVE_RECOVERY_INVALID','ARCHIVE_JOURNAL_INVALID','ARCHIVE_CONFLICT',
  'ARCHIVE_COMMIT_UNKNOWN','ARCHIVE_TIMEOUT','ARCHIVE_REQUEST_LIMIT','ARCHIVE_STORAGE_UNAVAILABLE']);
 return codes.has(error?.code)?error.code:undefined;
}

export function archiveInputChecks(header,entries) {
 const {draftIds,decisionIds,...metadata}=header.value;
 const drafts=entries.filter(e=>e.row?.kind==='DRAFT').map(e=>e.row.value);
 const decisions=entries.filter(e=>e.row?.kind==='BINDING').map(e=>e.row.value);
 const claims=[...metadata.invitations.map(invite=>({type:'INVITATION',groupId:metadata.id,tokenHash:invite.tokenHash,recipientHash:invite.recipientHash,expiresAt:invite.expiresAt})),...decisions.map(d=>({type:'DECISION',groupId:metadata.id,decisionId:d.id}))];
 return {entries:entries.length,rowsValid:entries.every(e=>PartitionRowSchema.safeParse(e.row).success),
  keysValid:entries.every(e=>{try{partitionDynamoWrites('KnownEnoughPartitions',[{key:e.key,expected:e.row.revision-1,next:e.row}]);return true;}catch{return false;}}),
  groupValid:Groups.Group.safeParse({...metadata,drafts,decisions}).success,
  childrenComplete:drafts.length===draftIds.length&&decisions.length===decisionIds.length,
  draftVersionsValid:drafts.every(d=>d.groupVersion<=metadata.version&&(!d.createdDecisionId||decisionIds.includes(d.createdDecisionId))),
  directoriesMatch:claims.every(claim=>{const key=partitionDirectoryKey(claim);const row=entries.find(e=>isDeepStrictEqual(e.key,key))?.row;return isDeepStrictEqual(row,{schemaVersion:1,revision:1,kind:'DIRECTORY',value:claim});})};
}
