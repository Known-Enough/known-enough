import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { expect, it } from 'vitest';
const schema=JSON.parse(readFileSync('tests/evaluations/aws-cli-input-keys.json','utf8')) as {operations:Record<string,{members:string[];required:string[]}>};
it('every literal installer/control-plane CLI input uses official field names, including Amplify lowercase inputs',()=>{
  const files=['aws','install','primary','recovery','release','metadata','runner'];let checks=0;
  for(const file of files){const source=ts.createSourceFile(file,readFileSync('scripts/live-qa/'+file+'.mjs','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['aws','command'].includes(node.expression.text)&&node.arguments.length>=2
      &&ts.isStringLiteral(node.arguments[0]!)&&ts.isStringLiteral(node.arguments[1]!)){
      const key=node.arguments[0]!.text+':'+node.arguments[1]!.text;const fields=schema.operations[key];expect(fields,key).toBeDefined();const input=node.arguments[2];
      if(input&&ts.isObjectLiteralExpression(input)){const keys=input.properties.filter(property=>!ts.isSpreadAssignment(property)).map(property=>property.name&&ts.isIdentifier(property.name)?property.name.text:property.name&&ts.isStringLiteral(property.name)?property.name.text:null);
        for(const field of keys)expect(fields!.members,key+':'+field).toContain(field);checks++;
        if(!input.properties.some(ts.isSpreadAssignment))for(const required of fields!.required)expect(keys,key+':'+required).toContain(required);
      }
    }ts.forEachChild(node,visit);};visit(source);
  }expect(checks).toBeGreaterThan(60);
  expect(schema.operations['amplify:create-deployment']!.required).toEqual(['appId','branchName']);
});
it.each(['prior-pin','same-pin','atomic-failure'])('resume preserves original config and journals across %s',mode=>{
  const folder=mkdtempSync(tmpdir()+'/qa-resume-');try{
    const helper=readFileSync('scripts/live-qa/resume.sh','utf8').split("config=$(python3 - \"$commit\" <<'PY'\n")[1]?.split("\nPY\n)")[0];expect(helper).toBeDefined();
    const config=JSON.parse(readFileSync('infra/live-qa/config.example.json','utf8'));Object.assign(config,{sourceCommit:'348afae8270eb739a89ab974c85a89e1526f06d9',mailboxProvider:'mailtm',primaryRollout:true});
    config.authorization={...config.authorization,approved:true,expiresAt:'2026-10-09T03:16:41.171626Z'};
    const result=spawnSync('python3',['-c',`
import json,sys,subprocess,datetime as dates,os
from pathlib import Path
root=Path(sys.argv[1]);mode=sys.argv[2];original=json.loads(sys.argv[3]);helper=sys.argv[4]
path=root/'known-enough-free-qa.fixture'/'config.json';path.parent.mkdir();path.write_text(json.dumps(original));before=path.read_bytes()
Path.home=classmethod(lambda cls:root)
class Clock(dates.datetime):
 @classmethod
 def now(cls,tz=None):return cls(2026,10,2,tzinfo=tz)
dates.datetime=Clock
pin='a'*40 if mode=='same-pin' else original['sourceCommit']
journal=root/'known-enough-live-qa-state'/pin/'package'/'primary-private-journal.json';journal.parent.mkdir(parents=True);journal.write_text('{"pending":{"operation":"CODE"}}');saved=journal.read_bytes()
if mode=='atomic-failure':journal.unlink()
calls=[]
def cloud(*args,**kwargs):
 calls.append(args);return json.dumps({'LastUpdateStatus':'Successful','RevisionId':'fresh','Environment':{'Variables':{'KE14_MODEL_MODE':'DISABLED','KE14_PAID_CALLS_APPROVED':'false'}}})
subprocess.check_output=cloud
if mode=='atomic-failure':
 def fail(*args):raise OSError('synthetic fsync failure')
 os.fsync=fail
sys.argv=['resume','a'*40]
try:exec(helper)
except SystemExit as error:
 assert mode=='prior-pin' and str(error)=='EXISTING_PRIMARY_RECOVERY_PIN_REQUIRED';assert not calls and path.read_bytes()==before
except OSError:
 assert mode=='atomic-failure' and path.read_bytes()==before
else:
 assert mode=='same-pin';current=json.loads(path.read_text());assert current['authorization']==original['authorization'];assert current['sourceCommit']=='a'*40
if mode!='atomic-failure':assert journal.read_bytes()==saved
`,folder,mode,JSON.stringify(config),helper!],{encoding:'utf8'});
    expect(result.status,result.stderr).toBe(0);
  }finally{rmSync(folder,{recursive:true,force:true});}
});
