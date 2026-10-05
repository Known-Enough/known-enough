import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { KnownEnough as KE } from '@deal-table/contracts';
// @ts-expect-error Runtime boundary validation is covered by LIVE02 runner tests.
import { validateTarget, operationStatus, transportFailureStatus, SAFE_REASONING_OUTCOMES } from '../../../scripts/live-qa/runner-core.mjs';
// @ts-expect-error CLI broker uses temporary workload credentials; no personal profiles.
import { invokeBroker } from '../../../scripts/live-qa/runner.mjs';
export type Actor={actor:string;username:string;email:string;password:string};
export const data=()=>({target:validateTarget(JSON.parse(readFileSync(process.env.QA_TARGET_FILE!,'utf8'))),login:JSON.parse(readFileSync(process.env.QA_LOGIN_FILE!,'utf8')) as {runId:string;users:Actor[]}});
export const fixture=(action:string,extra:Record<string,string>={})=>invokeBroker(data().target,process.env.QA_RUN_ID!,action,extra);
export async function login(browser:Browser,actor:string,options:{mobile?:boolean;display?:boolean}={}){const {target,login}=data();const user=login.users.find(item=>item.actor===actor);if(!user)throw new Error('QA_ACTOR_NOT_AVAILABLE');const context=await browser.newContext({viewport:options.mobile?{width:390,height:844}:{width:1280,height:900},reducedMotion:'reduce'});const page=await context.newPage();let challenge=false,exchange=false;page.on('request',r=>{if(r.url().startsWith(target.CognitoDomain+'/oauth2/authorize'))challenge=new URL(r.url()).searchParams.get('code_challenge_method')==='S256';if(r.url()===target.CognitoDomain+'/oauth2/token')exchange=!!new URLSearchParams(r.postData()??'').get('code_verifier');});await page.goto(target.FrontendUrl);await page.getByRole('button',{name:options.display?'Shared display sign-in':'Sign in or register',exact:true}).click();await expect(page).toHaveURL(new RegExp('^'+target.CognitoDomain.replaceAll('.','\\.')));await page.locator('input[name="username"]:visible').fill(user.username);await page.locator('input[name="password"]:visible').fill(user.password);await page.locator('input[type="submit"]:visible, button[type="submit"]:visible').first().click();await expect(page).toHaveURL(new RegExp('^'+target.FrontendUrl.replaceAll('.','\\.')));await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();expect(challenge&&exchange).toBe(true);return {context,page,user};}
export type Session=Awaited<ReturnType<typeof login>>;
export async function bearer(page:Page){const value=await page.evaluate(()=>{const s=JSON.parse(sessionStorage.getItem('known-enough-cognito-session')??'null');return typeof s?.accessToken==='string'?s.accessToken:null;});if(!value)throw new Error('REAL_SESSION_MISSING');return value as string;}
export async function request(session:Session,path:string,body?:unknown){return session.context.request.fetch(data().target.ApiUrl+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+await bearer(session.page),'content-type':'application/json'},...(body===undefined?{}:{data:body})});}
export async function checked(session:Session,path:string,body?:unknown):Promise<Record<string,unknown>>{const response=await request(session,path,body);if(!response.ok())throw new Error('QA_APPLICATION_OPERATION_FAILED');return await response.json() as Record<string,unknown>;}
export async function register(session:Session,admit=true){await session.page.getByLabel('Your display name').fill(session.user.actor);await session.page.getByRole('button',{name:'Request access',exact:true}).click();await expect(session.page.getByText('Access request pending.',{exact:false})).toBeVisible();if(admit){fixture('approve',{actor:session.user.actor});await session.page.getByRole('button',{name:'Refresh account and groups'}).click();await expect(session.page.getByRole('button',{name:'Create group',exact:true})).toBeVisible();}}
export async function owner(session:Session,id:string){return KE.OwnerDecisionSnapshot.parse(await (await request(session,`/decisions/${id}/me`)).json());}
export async function publicView(session:Session,id:string){return KE.PublicDecisionSnapshot.parse(await (await request(session,`/decisions/${id}/public`)).json());}
export async function envelope(session:Session,id:string,type:string,payload:unknown){const own=await owner(session,id);const requestId=randomUUID();return {schemaVersion:2,decisionId:id,requestId,idempotencyKey:requestId,type,expected:{contextToken:own.publicSnapshot.contextToken,semanticVersion:own.publicSnapshot.semanticVersion,controlVersion:own.controlVersion,ownerVersion:own.ownerVersion},payload};}
export async function command(session:Session,id:string,type:string,payload:unknown){return checked(session,`/decisions/${id}/commands`,await envelope(session,id,type,payload));}
export async function open(session:Session,id:string){await session.page.reload();const input=session.page.getByLabel('Decision ID from your invitation');await input.fill(id);await session.page.getByRole('button',{name:'Load shared decision'}).click();}
export async function close(sessions:Session[]){await Promise.all(sessions.map(s=>s.context.close()));}
export type {BrowserContext};

/** Renew only through real hosted PKCE login at serial test boundaries. */
export async function renewSessions(sessions: Session[], people: Session[], authenticate: (prior: Session) => Promise<Session>) {
  const latest = new Map(sessions.map(session => [session.user.actor, session]));
  for (const prior of latest.values()) {
    const renewed = await authenticate(prior);
    const index = people.findIndex(session => session.user.actor === prior.user.actor);
    if (index >= 0) people[index] = renewed;
    for (let at = sessions.length - 1; at >= 0; at--) if (sessions[at]!.user.actor === prior.user.actor) {
      await sessions[at]!.context.close(); sessions.splice(at, 1);
    }
    sessions.push(renewed);
  }
}

/** Observe only this existing POST; never read its body, token, URL into a report or retry it. */
export async function trackOperation(page: Page, url: string, run: () => Promise<void>, record: (status: string) => void) {
  record('HTTP_PENDING');
  const matches = (request: import('@playwright/test').Request) => request.method() === 'POST' && request.url() === url;
  const response = (value: import('@playwright/test').Response) => { if (matches(value.request())) record(operationStatus(value.status())); };
  const failed = (value: import('@playwright/test').Request) => { if (matches(value)) record(transportFailureStatus(value.failure()?.errorText)); };
  page.on('response', response); page.on('requestfailed', failed);
  try { await run(); } finally { page.off('response', response); page.off('requestfailed', failed); }
}

/** A browser click completes before the server mutation; serialize shared version updates. */
export async function confirmFrameReview(page: Page, commandUrl: string, record: (status: string) => void) {
  await trackOperation(page, commandUrl, async () => {
    await page.getByRole('button', { name: 'Confirm shared frame' }).click();
    await expect(page.getByRole('button', { name: 'Confirm shared frame' })).toHaveCount(0);
  }, record);
}

/** Await the existing bounded reasoning response; a browser click does not await model work. */
export async function exploreProposals(page: Page, reasoningUrl: string, record: (status: string) => void, outcome?: (status: string) => void) {
  await trackOperation(page, reasoningUrl, async () => {
    const [response] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'POST' && response.url() === reasoningUrl, { timeout: 180000 }),
      page.getByRole('button', { name: 'Explore proposals' }).click(),
    ]);
    // Only an enumerated semantic outcome can leave the response; never persist its body.
    if (outcome && response.ok()) {
      const value: unknown = await response.json();
      if (value && typeof value === 'object' && 'outcome' in value && SAFE_REASONING_OUTCOMES.includes(value.outcome)) outcome(String(value.outcome));
    }
  }, record);
}

/** Read a new group only after its committed server snapshot is rendered. */
export async function createGroup(page: Page, name: string) {
  await page.getByLabel('New group name').fill(name);
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
