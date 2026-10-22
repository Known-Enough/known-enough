import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {waitForGroups, waitForDecisionReady} from '../e2e03/session-runner.mjs';

const run=process.argv[2];
if(!/^\d{8}T\d{6}Z$/.test(run||''))throw Error('RUN_ID_REQUIRED');
const out=path.resolve('docs/review-artifacts/E2E04/two-'+run);
const fixture=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.known-enough/e2e04-two',run,'fixture.json')));
const credential=JSON.parse(fs.readFileSync(process.env.E2E04_CREDENTIALS)).users[0];
const require=createRequire(path.resolve(process.env.E2E04_DEPENDENCIES,'package.json'));
const {chromium}=require('playwright');
function event(name,fields={}){const fd=fs.openSync(path.join(out,'events.jsonl'),'a',0o600);try{fs.writeSync(fd,JSON.stringify({utc:new Date().toISOString(),run,event:name,...fields})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
event('FINAL_READONLY_CAPTURE_STARTED',{actor:'U01',businessPostRequestsAllowed:false});
const browser=await chromium.launch({headless:true,executablePath:process.env.E2E04_CHROMIUM});
const evidence={startedAt:new Date().toISOString(),actor:'U01',businessWrites:0};
try{
 const context=await browser.newContext({viewport:{width:1365,height:1100},colorScheme:'light'});
 await context.route(/https:\/\/[^/]+\.execute-api\.us-east-1\.amazonaws\.com\//,async r=>{if(r.request().method()!=='GET'){event('UNEXPECTED_BUSINESS_WRITE_BLOCKED',{method:r.request().method()});await r.abort();}else await r.continue();});
 const p=await context.newPage();p.setDefaultTimeout(20000);
 await p.goto('https://known-enough.vercel.app/');await p.getByRole('button',{name:'Sign in',exact:true}).click();
 await p.locator('input[autocomplete=username]').fill(credential.username);await p.locator('input[autocomplete=current-password]').fill(credential.password);
 const ready=waitForGroups(p);ready.catch(()=>{});await p.getByRole('button',{name:'Sign in',exact:true}).last().click();await ready;
 await p.goto('https://known-enough.vercel.app/?group='+fixture.groupId+'&decision='+fixture.decisionId);
 await waitForDecisionReady(p,fixture.decisionId,fixture.title,45000);
 const session=await p.evaluate(()=>JSON.parse(sessionStorage.getItem('known-enough-cognito-session')));
 const response=await context.request.get('https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com/decisions/'+fixture.decisionId+'/me',{headers:{authorization:'Bearer '+session.accessToken}});
 if(!response.ok())throw Error('OWNER_READ_FAILED');const owner=await response.json();
 evidence.status=owner.publicSnapshot.status;evidence.approved=owner.publicSnapshot.approvedParticipantIds.length;evidence.required=owner.publicSnapshot.frame.requiredParticipantIds.length;
 if(evidence.status!=='AGREED'||evidence.approved!==2)throw Error('FINAL_AGREEMENT_MISMATCH');
 await p.locator('.ke-decision-header-menu summary').click();await p.getByRole('button',{name:'View outcome',exact:true}).last().click();await p.locator('#outcome-title').waitFor();
 const approvals=p.locator('.ke-outcome-approvals');if(await approvals.count()&&await approvals.getAttribute('open')===null)await approvals.locator('summary').click();
 evidence.choices=await p.locator('.ke-outcome-choices dd').allTextContents();
 await p.locator('.ke-outcome-dialog').screenshot({path:path.join(out,'screenshots/09-final-outcome-clear.png'),animations:'disabled',style:'.ke-outcome-private {visibility:hidden!important;}'});
 await p.getByRole('button',{name:'Back to decision',exact:true}).click();
 const history=p.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname===`/decisions/${fixture.decisionId}/chat/group`);history.catch(()=>{});
 await p.getByRole('button',{name:'Chat',exact:true}).click();await history;await p.locator('.ke-alexa-body[aria-busy=false]').waitFor();
 const incorrect=p.locator('.ke-alexa-message').filter({hasText:'No approvals have been made yet, and 2 are still needed.'});
 await incorrect.scrollIntoViewIfNeeded();await incorrect.screenshot({path:path.join(out,'screenshots/11-incorrect-reply-clear.png'),animations:'disabled'});evidence.incorrectReplyCaptured=true;
 await p.setViewportSize({width:390,height:720});
 await p.locator('.ke-alexa-message').last().scrollIntoViewIfNeeded();
 evidence.mobile={viewport:p.viewportSize(),horizontalOverflow:await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),messages:await p.locator('.ke-alexa-message').count(),closeVisible:await p.getByRole('button',{name:'Close chat',exact:true}).isVisible(),composerVisible:await p.locator('#alexa-question').isVisible()};
 await p.locator('.ke-alexa-chat').screenshot({path:path.join(out,'screenshots/10-mobile-chat.png'),animations:'disabled'});
 evidence.endedAt=new Date().toISOString();evidence.result='PASS';
 fs.writeFileSync(path.join(out,'final-readback.json'),JSON.stringify(evidence,null,2)+'\n');
 event('FINAL_READONLY_CAPTURE_COMPLETE',evidence);console.log(JSON.stringify(evidence));
}catch(e){event('FINAL_READONLY_CAPTURE_FAILED',{code:e.name,reason:String(e.message).split('\n')[0]});throw e;}
finally{await browser.close();}
