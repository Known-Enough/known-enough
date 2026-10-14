import { mkdir,chmod,readFile,writeFile,lstat,rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join,basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash,randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { approveSelected } from '../../packages/adapters/src/partition-account-operator.ts';
import { aws,verifyIdentity,operatorFromVerifiedPackage,sanitizeError,API_HASH } from './runtime.mjs';
const execute=promisify(execFile),root=join(homedir(),'.known-enough','access-users','private');let invocation,privateReady=false;
const codeFolder=basename(fileURLToPath(new URL('../../',import.meta.url)));const source=codeFolder.match(/^source-([a-f0-9]{40})$/)?.[1]??(/^[a-f0-9]{40}$/.test(process.env.EXPECTED_SOURCE??'')?process.env.EXPECTED_SOURCE:'UNKNOWN');
const audit={source,nativeApiSha256:API_HASH,utc:new Date().toISOString(),result:'NOT_EXECUTED',operation:'UNKNOWN',selected:0,approved:0,noops:0,failures:0,providerWrites:0,groupWrites:0};
try{
 const [action,...args]=process.argv.slice(2);const names=[];
 if(action==='list'){if(args.join('|')!=='--pending')throw new Error('INVALID_ARGUMENT');audit.operation='LIST_PENDING';}
 else if(action==='approve'){for(let index=0;index<args.length;index+=2){if(args[index]!=='--username'||!args[index+1])throw new Error('INVALID_ARGUMENT');names.push(args[index+1]);}if(!names.length||names.length>100||new Set(names).size!==names.length)throw new Error('INVALID_ARGUMENT');audit.operation='APPROVE_SELECTED';audit.selected=names.length;}
 else throw new Error('INVALID_ARGUMENT');
 if(process.version!=='v24.21.0')throw new Error('PINNED_NODE_REQUIRED');await verifyIdentity();
 await mkdir(root,{recursive:true,mode:0o700});if(!(await lstat(root)).isDirectory()||(await lstat(root)).isSymbolicLink())throw new Error('PRIVATE_DIRECTORY_REQUIRED');await chmod(root,0o700);privateReady=true;
 const primary=await aws('lambda','get-function',['--function-name','known-enough-stage-api']);const config=primary.Configuration;
 if(config?.FunctionArn!=='arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-api'||config.Handler!=='api.handler'||config.Role!=='arn:aws:iam::092954139775:role/KnownEnoughStageApiRole'||Buffer.from(config.CodeSha256??'','base64').toString('hex')!==API_HASH)throw new Error('CHECKED_NATIVE_API_REQUIRED');
 const archive=join(root,'api-'+API_HASH+'.zip');let bytes,missing=false;
 try{const stat=await lstat(archive);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw new Error('PRIVATE_CACHE_REQUIRED');bytes=await readFile(archive);}catch(error){if(error.code!=='ENOENT')throw error;missing=true;}if(missing){const url=new URL(primary.Code?.Location);if(url.protocol!=='https:'||!url.hostname.endsWith('.amazonaws.com')||url.username||url.password)throw new Error('AWS_DOWNLOAD_TARGET_REQUIRED');const response=await globalThis.fetch(url,{redirect:'error',signal:globalThis.AbortSignal.timeout(60000)});if(!response.ok)throw new Error('PRIVATE_PACKAGE_DOWNLOAD_FAILED');const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>50*1024*1024)throw new Error('PRIVATE_PACKAGE_LIMIT');chunks.push(Buffer.from(chunk));}bytes=Buffer.concat(chunks);if(createHash('sha256').update(bytes).digest('hex')!==API_HASH)throw new Error('PRIVATE_PACKAGE_HASH_MISMATCH');await writeFile(archive,bytes,{mode:0o600,flag:'wx'});}
 if(createHash('sha256').update(bytes).digest('hex')!==API_HASH)throw new Error('PRIVATE_PACKAGE_HASH_MISMATCH');
 invocation=join(root,'command-'+randomUUID());await mkdir(invocation,{mode:0o700});
 await execute('python3',['-c',"import zipfile,pathlib,sys,os; z=zipfile.ZipFile(sys.argv[1]); p=pathlib.Path(sys.argv[2]); names=['configuration-private.json','manifest-private.json','release-private.json']; allowed=['api.mjs']+names+['lifecycle-private.json','jobs-private.json']; assert len(z.namelist())==len(set(z.namelist())) and set(z.namelist())<=set(allowed) and set(names)<=set(z.namelist()); assert all(z.getinfo(n).file_size<=1048576 for n in names); [( (p/n).write_bytes(z.read(n)),os.chmod(p/n,0o600)) for n in names]",archive,invocation],{timeout:15000,maxBuffer:10000});
 const operator=await operatorFromVerifiedPackage(invocation);
 if(action==='list'){const result=await operator.listPending();audit.result=result.result;audit.pending=result.pending.length;audit.accountKeysObserved=result.accountKeysObserved;console.log(JSON.stringify(result,null,2));}
 else{const result=await approveSelected(operator,names,error=>{audit.error=sanitizeError(error);});audit.result=result.result;audit.approved=result.outcomes.filter(item=>item.result==='APPROVED').length;audit.noops=result.outcomes.filter(item=>item.result==='ALREADY_APPROVED').length;audit.failures=result.outcomes.length-audit.approved-audit.noops;console.log(JSON.stringify(result,null,2));if(audit.failures)process.exitCode=1;}
}catch(error){audit.result='BLOCKED';audit.error=sanitizeError(error);console.error(JSON.stringify({result:'BLOCKED',...audit.error}));process.exitCode=1;
}finally{if(invocation)await rm(invocation,{recursive:true,force:true});if(privateReady&&audit.operation!=='UNKNOWN'){await mkdir(root,{recursive:true,mode:0o700});await writeFile(join(root,'audit-'+new Date().toISOString().replaceAll(':','-')+'-'+randomUUID()+'.json'),JSON.stringify(audit,null,2),{mode:0o600,flag:'wx'});}}
