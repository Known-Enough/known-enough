import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPartitionAccountOperator } from '../../packages/adapters/src/partition-account-operator.ts';
import { createPartitionManagedDriver } from '../../packages/adapters/src/partition-managed.ts';
import { partitionDeploymentOptions } from '../../apps/api/src/partition-deployment.ts';
const execute=promisify(execFile);
export const ACCOUNT='092954139775',REGION='us-east-1',POOL='us-east-1_V9OMjd0zx',API_HASH='73e0bc7d5e75f04e73a5a916d3107fae337a3a3e935a9eb110e7c72b4c252339';
const codes=['AccessDenied','AccessDeniedException','UserNotFoundException','ExpiredTokenException','UnrecognizedClientException','ThrottlingException','TooManyRequestsException','WRONG_ACCOUNT','INVALID_CATALOG','CATALOG_LIMIT','CATALOG_CURSOR_REPEAT','IDENTITY_UNAVAILABLE','INVALID_SUBJECT','IDENTITY_CURSOR_REPEAT','IDENTITY_LIMIT','TARGET_MISMATCH'];
export class OperatorIOError extends Error{constructor(operation,code){super('OPERATOR_IO_UNAVAILABLE');this.name='OperatorIOError';this.operation=operation;this.code=codes.includes(code)?code:'AWS_OPERATION_UNAVAILABLE';}}
const operatorCodes=['PARTITION_INVALID','PARTITION_CAPACITY','PARTITION_CONFLICT','PARTITION_STALE','PARTITION_TIMEOUT','PARTITION_REQUEST_LIMIT','PARTITION_IDENTITY_CONFLICT','PARTITION_DEPLOYMENT_INVALID','PARTITION_STORAGE_UNAVAILABLE','INVALID_ARGUMENT','TARGET_MISMATCH','UNKNOWN_USERNAME','MISSING_IDENTITY','AMBIGUOUS_IDENTITY','IDENTITY_MISMATCH','UNVERIFIED_EMAIL','INACTIVE_PROVIDER','NOT_PENDING','STALE_ACCOUNT','CAPACITY','UNCONFIRMED_APPROVAL','PINNED_NODE_REQUIRED','PRIVATE_DIRECTORY_REQUIRED','PRIVATE_CACHE_REQUIRED','CHECKED_NATIVE_API_REQUIRED','AWS_DOWNLOAD_TARGET_REQUIRED','PRIVATE_PACKAGE_DOWNLOAD_FAILED','PRIVATE_PACKAGE_LIMIT','PRIVATE_PACKAGE_HASH_MISMATCH'];
export function sanitizeError(error){
 if(error instanceof OperatorIOError)return {operation:error.operation,code:error.code};
 for(let current=error,depth=0;current&&depth<5;current=current.cause,depth++){
  if(codes.includes(current.name)){const operation=String(current.message??'').match(/perform:?\s+(dynamodb:(?:GetItem|BatchGetItem|TransactGetItems|ConditionCheckItem|PutItem|Scan))\b/)?.[1];return {operation:operation??'NATIVE_IO',code:current.name};}
 }
 if(operatorCodes.includes(error?.code)||operatorCodes.includes(error?.message))return {operation:'NATIVE_OPERATOR',code:operatorCodes.includes(error?.code)?error.code:error.message};
 return {operation:'NATIVE_OPERATOR',code:'OPERATOR_UNAVAILABLE'};
}

export async function aws(service,operation,args=[]){try{const result=await execute('aws',[service,operation,...args,'--region',REGION,'--endpoint-url',`https://${service}.${REGION}.amazonaws.com`,'--output','json','--no-cli-pager','--no-paginate'],{timeout:20000,maxBuffer:2*1024*1024,env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_REGION:REGION,AWS_DEFAULT_REGION:REGION}});return JSON.parse(result.stdout);}catch(error){const code=String(error.stderr??'').match(/\(([^)]+)\) when calling/)?.[1];throw new OperatorIOError(service+':'+operation,code);}}
export async function verifyIdentity(){const identity=await aws('sts','get-caller-identity');if(identity.Account!==ACCOUNT)throw new OperatorIOError('sts:GetCallerIdentity','WRONG_ACCOUNT');return identity;}
export async function* accountCatalog(invoke=aws){
 let cursor;const cursors=new Set();let total=0;
 for(let page=0;page<100;page++){
  const data=await invoke('dynamodb','scan',['--table-name','KnownEnoughPartitions','--projection-expression','PK,SK','--select','SPECIFIC_ATTRIBUTES','--consistent-read','--filter-expression','begins_with(PK, :account) AND SK = :state','--expression-attribute-values',JSON.stringify({':account':{S:'ACCOUNT#'},':state':{S:'STATE'}}),'--limit','1000',...(cursor?['--exclusive-start-key',JSON.stringify(cursor)]:[])]);
  if(!Array.isArray(data.Items)||data.Items.length>1000)throw new OperatorIOError('dynamodb:Scan','INVALID_CATALOG');
  const subjects=data.Items.map(item=>{if(Object.keys(item).sort().join('|')!=='PK|SK'||!/^ACCOUNT#[A-Za-z0-9_-]{1,80}$/.test(item.PK?.S??'')||item.SK?.S!=='STATE')throw new OperatorIOError('dynamodb:Scan','INVALID_CATALOG');return item.PK.S.slice(8);});
  total+=subjects.length;if(total>10000)throw new OperatorIOError('dynamodb:Scan','CATALOG_LIMIT');yield subjects;
  if(!data.LastEvaluatedKey||!Object.keys(data.LastEvaluatedKey).length)return;
  cursor=data.LastEvaluatedKey;const encoded=JSON.stringify(cursor);if(cursors.has(encoded))throw new OperatorIOError('dynamodb:Scan','CATALOG_CURSOR_REPEAT');cursors.add(encoded);
 }
 throw new OperatorIOError('dynamodb:Scan','CATALOG_LIMIT');
}
function identity(data){const attrs=Object.fromEntries((data.UserAttributes??data.Attributes??[]).map(item=>[item.Name,item.Value]));if(!/^[A-Za-z0-9_-]{1,80}$/.test(attrs.sub??'')||typeof data.Username!=='string'||typeof attrs.email!=='string')throw new OperatorIOError('cognito-idp:identity-read','IDENTITY_UNAVAILABLE');return {subject:attrs.sub,username:data.Username,email:attrs.email,verified:attrs.email_verified==='true',enabled:data.Enabled===true};}
export async function providerByUsername(username){try{return identity(await aws('cognito-idp','admin-get-user',['--user-pool-id',POOL,'--username='+username]));}catch(error){if(error instanceof OperatorIOError&&error.code==='UserNotFoundException')return null;throw error;}}
export async function providerBySubject(subject){if(!/^[A-Za-z0-9_-]{1,80}$/.test(subject))throw new OperatorIOError('cognito-idp:list-users','INVALID_SUBJECT');let token;const results=[],seen=new Set();for(let page=0;page<10;page++){const data=await aws('cognito-idp','list-users',['--user-pool-id',POOL,'--filter',`sub = "${subject}"`,'--limit','60',...(token?['--pagination-token',token]:[])]);if(!Array.isArray(data.Users))throw new OperatorIOError('cognito-idp:list-users','IDENTITY_UNAVAILABLE');results.push(...data.Users.map(identity));if(!data.PaginationToken)return results;token=data.PaginationToken;if(seen.has(token))throw new OperatorIOError('cognito-idp:list-users','IDENTITY_CURSOR_REPEAT');seen.add(token);}throw new OperatorIOError('cognito-idp:list-users','IDENTITY_LIMIT');}
export async function operatorFromVerifiedPackage(directory){
 const configBytes=await readFile(join(directory,'configuration-private.json')),manifestBytes=await readFile(join(directory,'manifest-private.json')),release=JSON.parse(await readFile(join(directory,'release-private.json')));
 const config=JSON.parse(configBytes);if(config.userPoolId!==POOL||config.allowedOrigin!=='https://main.d143q5ravxp5av.amplifyapp.com')throw new OperatorIOError('NATIVE_CONFIG','TARGET_MISMATCH');
 const options=partitionDeploymentOptions(configBytes,manifestBytes,release);
 const managed=createPartitionManagedDriver({...options.managed,verifiedTarget:{account:ACCOUNT,region:REGION}});
 return createPartitionAccountOperator({target:{account:ACCOUNT,region:REGION},emailKey:config.emailKey,groups:managed.groups,catalog:accountCatalog,byUsername:providerByUsername,bySubject:providerBySubject});
}
