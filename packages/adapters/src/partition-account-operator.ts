import { createHmac } from 'node:crypto';
import { checkPartitionRow,partitionAccountKey,type PartitionTransport,type PartitionRow } from './partitioned-group-repository.ts';
import { partitionDirectoryKey } from './partition-directory.ts';
export type OperatorIdentity={subject:string;username:string;email:string;verified:boolean;enabled:boolean};
export type OperatorCode='INVALID_ARGUMENT'|'TARGET_MISMATCH'|'UNKNOWN_USERNAME'|'MISSING_IDENTITY'|'AMBIGUOUS_IDENTITY'|'IDENTITY_MISMATCH'|'UNVERIFIED_EMAIL'|'INACTIVE_PROVIDER'|'NOT_PENDING'|'STALE_ACCOUNT'|'CAPACITY'|'UNCONFIRMED_APPROVAL';
export class AccountOperatorError extends Error{constructor(readonly code:OperatorCode){super(code);this.name='AccountOperatorError';}}
const fail=(code:OperatorCode):never=>{throw new AccountOperatorError(code);};
const subject=(value:string)=>/^[A-Za-z0-9_-]{1,80}$/.test(value)?value:fail('IDENTITY_MISMATCH');
const username=(value:string)=>value.length>0&&value.length<=128&&[...value].every(character=>character.charCodeAt(0)>32&&character.charCodeAt(0)!==127)?value:fail('INVALID_ARGUMENT');
export interface AccountOperatorPorts{
 target:{account:string;region:string}; emailKey:string; groups:PartitionTransport;
 /** Complete paginated key-only account catalog; never aggregate or payload scans. */
 catalog:()=>AsyncIterable<string[]>;
 byUsername:(username:string)=>Promise<OperatorIdentity|null>;
 bySubject:(subject:string)=>Promise<OperatorIdentity[]>;
}
type AccountRow=Extract<PartitionRow,{kind:'ACCOUNT'}>;
/** Server/operator only. IAM authenticates the operator; no participant HTTP endpoint exists. */
export function createPartitionAccountOperator(ports:AccountOperatorPorts){
 if(ports.target.account!=='092954139775'||ports.target.region!=='us-east-1'||ports.emailKey.length<32)fail('TARGET_MISMATCH');
 const digest=(email:string)=>createHmac('sha256',ports.emailKey).update(email.trim().toLowerCase()).digest('hex');
 const read=async(id:string):Promise<AccountRow|null>=>{const key=partitionAccountKey(subject(id)),raw=await ports.groups.read(key);if(raw===null)return null;const row=checkPartitionRow(raw,key);if(row.kind!=='ACCOUNT')return fail('IDENTITY_MISMATCH');return row;};
 async function ownIdentity(row:AccountRow){
  const stored=row.value.profile?.loginUsername;
  let identity:OperatorIdentity|null;
  if(stored)identity=await ports.byUsername(username(stored));
  else{const choices=await ports.bySubject(row.value.subject);if(choices.length>1)fail('AMBIGUOUS_IDENTITY');identity=choices[0]??null;}
  if(!identity)return fail('MISSING_IDENTITY');
  if(identity.subject!==row.value.subject||digest(identity.email)!==row.value.emailHash)return fail('IDENTITY_MISMATCH');
  username(identity.username);subject(identity.subject);
  const key=partitionDirectoryKey({type:'EMAIL',emailHash:row.value.emailHash}),raw=await ports.groups.read(key);
  const directory=raw===null?null:checkPartitionRow(raw,key);
  if(directory?.kind!=='DIRECTORY'||directory.value.type!=='EMAIL'||directory.value.subject!==identity.subject)return fail('IDENTITY_MISMATCH');
  return {identity,directory};
 }
 return {
  async listPending(){
   const seen=new Set<string>(),pending:{username:string;displayName:string;status:'PENDING';requestedAt:null;eligible:boolean;observedAt:string}[]=[];
   for await(const page of ports.catalog()){
    if(!Array.isArray(page)||page.length>1000)fail('CAPACITY');
    for(const id of page){subject(id);if(seen.has(id))fail('IDENTITY_MISMATCH');seen.add(id);if(seen.size>10000)fail('CAPACITY');const row=await read(id);if(!row||row.value.status!=='PENDING')continue;
     const {identity}=await ownIdentity(row);pending.push({username:identity.username,displayName:row.value.displayName,status:'PENDING',requestedAt:null,eligible:identity.verified&&identity.enabled,observedAt:new Date().toISOString()});
    }
   }
   return {result:'PENDING_LIST_COMPLETE' as const,pending,accountKeysObserved:seen.size,observedAt:new Date().toISOString()};
  },
  async approve(exactUsername:string){
   username(exactUsername);const provider=await ports.byUsername(exactUsername);
   if(!provider||provider.username!==exactUsername)return fail('UNKNOWN_USERNAME');
   const row=await read(provider.subject);if(!row)return fail('UNKNOWN_USERNAME');
   const {identity,directory}=await ownIdentity(row);
   if(identity.username!==exactUsername)fail('IDENTITY_MISMATCH');
   if(!identity.verified)fail('UNVERIFIED_EMAIL');if(!identity.enabled)fail('INACTIVE_PROVIDER');
   if(row.value.status==='APPROVED')return {result:'ALREADY_APPROVED' as const,version:row.value.version,dataWrites:0};
   if(row.value.status!=='PENDING')return fail('NOT_PENDING');
   if(row.revision>=Number.MAX_SAFE_INTEGER||row.value.version>=Number.MAX_SAFE_INTEGER)fail('CAPACITY');
   const next=structuredClone(row);next.revision++;next.value.version++;next.value.status='APPROVED';
   // The managed transport joins source, activation and migration-journal fences.
   // Preserve every private profile field and guard the immutable email-ownership record.
   const committed=await ports.groups.commit([{key:partitionAccountKey(row.value.subject),expected:row.revision,next},
    {key:partitionDirectoryKey(directory.value),expected:directory.revision,next:null}]);
   if(!committed)fail('STALE_ACCOUNT');
   const fresh=await read(row.value.subject);
   if(!fresh||JSON.stringify(fresh)!==JSON.stringify(next))return fail('UNCONFIRMED_APPROVAL');
   return {result:'APPROVED' as const,version:fresh.value.version,dataWrites:1};
  },
 };
}
export async function approveSelected(operator:ReturnType<typeof createPartitionAccountOperator>,names:string[],onOperationalError:(error:unknown)=>void=()=>{}){
 if(names.length<1||names.length>100||new Set(names).size!==names.length)fail('INVALID_ARGUMENT');
 const outcomes:({username:string;result:string;version?:number;dataWrites?:number})[]=[];
 for(const [index,name] of names.entries()){try{outcomes.push({username:name,...await operator.approve(name)});}catch(error){if(error instanceof AccountOperatorError)outcomes.push({username:name,result:error.code,dataWrites:0});else{try{onOperationalError(error);}catch{/* Reporting cannot erase confirmed earlier outcomes. */}outcomes.push({username:name,result:'OPERATION_UNAVAILABLE',dataWrites:0});outcomes.push(...names.slice(index+1).map(username=>({username,result:'SKIPPED_DEPENDENCY',dataWrites:0})));break;}}}
 return {result:outcomes.every(item=>['APPROVED','ALREADY_APPROVED'].includes(item.result))?'APPROVALS_COMPLETE':'APPROVALS_PARTIAL',outcomes};
}
