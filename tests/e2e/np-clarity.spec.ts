import { loadSharedDecision } from '../live/qa/helpers.ts';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { test, expect, type BrowserContext } from '@playwright/test';
import { npApi } from '../evaluations/np-api.ts';
import { clarificationTransport } from '../evaluations/assessment-model.ts';
import { freshGroup } from '../evaluations/np-lifecycle.ts';
// These cases own one fixed-port server; keep its setup and teardown in one worker.
test.describe.configure({ mode: 'default' });
let server: ChildProcess;
const url = 'http://127.0.0.1:5183/';
test.beforeAll(async () => {
  server = spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', '--port', '5183', '--strictPort', '--host', '127.0.0.1'], { cwd: 'apps/web', stdio: 'ignore',
    env: { ...process.env, VITE_COGNITO_REGION: 'us-east-1', VITE_COGNITO_USER_POOL_ID: 'us-east-1_npFixture', VITE_COGNITO_DOMAIN: 'https://fixture.auth.us-east-1.amazoncognito.com',
      VITE_COGNITO_PARTICIPANT_CLIENT_ID: 'participant-client', VITE_COGNITO_DISPLAY_CLIENT_ID: 'display-client', VITE_API_BASE_URL: 'https://api.example.test' } });
  for (let attempt = 0; attempt < 40; attempt++) { try { if ((await fetch(url)).ok) return; } catch { /* startup */ } await new Promise(resolve => setTimeout(resolve, 250)); }
  throw new Error('Clarity server unavailable');
});
test.afterAll(() => server?.kill());
async function connect(context: BrowserContext, api: Awaited<ReturnType<typeof npApi>>, who: string) {
  await context.addInitScript(session => sessionStorage.setItem('known-enough-cognito-session', JSON.stringify(session)), { accessToken: api.bearer(who), kind: 'participant', expiresAt: Date.now() + 900000 });
  await context.route('https://api.example.test/**', async route => {
    const request = route.request(); if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' } }); return; }
    const headers = await request.allHeaders(); const response = await fetch(api.base + URL.parse(request.url())!.pathname, { method: request.method(), headers: { authorization: headers.authorization!, 'content-type': 'application/json' }, ...(request.postData() ? { body: request.postData()! } : {}) });
    await route.fulfill({ status: response.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await response.text() });
  });
}
test('mobile keyboard entry, pending/disabled copy and private questions preserve clear next actions without overflow', async ({ browser }) => {
  const api = await npApi(); const contexts: BrowserContext[] = [];
  try {
    const login = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }); contexts.push(login);
    const entry = await login.newPage(); await entry.goto(url);
    await expect(entry.getByRole('heading', { name: 'Decide together.' })).toBeVisible();
    for (let tab = 0; tab < 8 && !await entry.getByRole('button', { name: 'Create account', exact: true }).evaluate(node => node === document.activeElement); tab++) await entry.keyboard.press('Tab'); await expect(entry.getByRole('button', { name: 'Create account', exact: true })).toBeFocused();
    await entry.getByText('Privacy and preview limits', { exact: true }).click();
    await expect(entry.getByText('Known Enough and its authorized AI process your private inputs.', { exact: false })).toBeVisible();
    expect(await entry.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await entry.screenshot({ path: '/tmp/np03-mobile-signin.png', fullPage: true });
    await login.close();
    const pending = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(pending); await connect(pending, api, 'newbie');
    await api.call('newbie', '/account/register', { displayName: 'New Person' }); const pendingPage = await pending.newPage(); await pendingPage.goto(url);
    await expect(pendingPage.getByText('Your account is waiting for approval.', { exact: false })).toBeVisible();
    await expect(pendingPage.getByRole('button', { name: 'Create group', exact: true })).toHaveCount(0);
    await pending.close();
    const h = await freshGroup(api); await h.ready(); await h.generate();
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }); contexts.push(mobile); await connect(mobile, api, 'iris');
    const page = await mobile.newPage(); await page.goto(url + '?decision=' + h.decisionId);
    await expect(page.getByRole('heading', { name: 'Private negotiation question' })).toBeVisible();
    await expect(page.getByText('Permission for this adjustment does not disclose your conditions or approve a final proposal.', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('body').innerText()).not.toMatch(/NP_PRIVATE_RAW_CANARY|schema|contextToken|semanticVersion|controlVersion|owner route/);
    await page.screenshot({ path: '/tmp/np03-mobile-private.png', fullPage: true });
    const other = await browser.newContext(); contexts.push(other); await connect(other, api, 'omar'); const otherPage = await other.newPage(); await otherPage.goto(url + '?decision=' + h.decisionId);
    await expect(otherPage.getByRole('heading', { name: 'Shared frame', exact: true })).toBeVisible();
    await expect(otherPage.getByRole('heading', { name: 'Private negotiation question' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Decline this adjustment' }).click();
    await expect(page.getByRole('heading', { name: 'Private negotiation question' })).toHaveCount(0);
    expect(await otherPage.locator('body').innerText()).not.toContain('NP_PRIVATE_RAW_CANARY');
    await api.disable('iris'); await page.getByRole('button', { name: 'Refresh decision' }).click();
    await expect(page.getByText('Your access is disabled.', { exact: false })).toBeVisible();
  } finally { await Promise.all(contexts.map(context => context.close())); await api.close(); }
});
test('only the owner sees an exact disclosure preview; declining keeps proposal approval independent', async ({ browser }) => {
  const api = await npApi(); const contexts: BrowserContext[] = [];
  try {
    const h = await freshGroup(api); await h.ready(); await h.generate();
    const question = (await h.owner('iris')).pendingQuestions[0]!;
    await h.command('iris', 'ANSWER_NEGOTIATION', { questionId: question.questionId, constraintVersion: question.constraintVersion, requestIdentity: question.requestIdentity, answer: 'ALLOW' });
    await h.generate(); const publicView = await h.publicView(); const proposal = publicView.currentProposal!;
    const own = await h.owner('iris'); const text = 'I can use Studio if we finish on time.';
    await api.application.requestDisclosure({ kind: 'service', subject: 'synthetic-disclosure-worker', roomIds: [h.decisionId] }, {
      permissionId: 'np-disclosure', permissionVersion: 1, decisionId: h.decisionId, contextToken: publicView.contextToken,
      semanticVersion: publicView.semanticVersion, ownerParticipantId: own.ownerParticipantId, proposalId: proposal.proposalId,
      proposalVersion: proposal.facts.proposalVersion, audienceParticipantIds: publicView.frame.requiredParticipantIds,
      status: 'PENDING', expiresAt: new Date(Date.now() + 600000).toISOString(), kind: 'EXACT_TEXT', text, textHash: createHash('sha256').update(text).digest('hex') });
    for (const who of ['iris', 'omar']) {
      const context = await browser.newContext(); contexts.push(context); await connect(context, api, who); const page = await context.newPage();
      await page.goto(url + '?decision=' + h.decisionId);
      if (who === 'iris') {
        await expect(page.getByRole('heading', { name: 'Review this exact disclosure' })).toBeVisible();
        await expect(page.getByText(text, { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Decline this disclosure' }).click();
        await page.getByLabel('I reviewed the shared outcome and my private part of this exact proposal.').check();
        await page.getByRole('button', { name: 'Approve this exact proposal' }).click();
      } else {
        await expect(page.getByRole('heading', { name: 'Your disclosure choices' })).toHaveCount(0);
        expect(await page.locator('body').innerText()).not.toContain(text);
      }
    }
    expect((await h.owner('iris')).ownApproval).not.toBeNull();
    expect(JSON.stringify(await h.publicView())).not.toContain(text);
  } finally { await Promise.all(contexts.map(context => context.close())); await api.close(); }
});
test('public draft takes keyboard focus; malformed responses show a safe retry message without provider payloads', async ({ browser }) => {
  const api = await npApi(); const context = await browser.newContext();
  try {
    await connect(context, api, 'iris'); await api.call('iris', '/account/register', { displayName: 'Iris' }); await api.approve('iris');
    await api.groups.create({ kind: 'participant', subject: 'iris' }, { name: 'Small club', idempotencyKey: 'small' });
    const page = await context.newPage(); await page.goto(url); await page.getByRole('button', { name: /^Open group / }).first().click();
    await page.getByRole('button', { name: 'Start a decision' }).click();
  await page.getByLabel('Tell me what you want to decide').fill('Choose a gallery meetup.'); await page.getByRole('button', { name: 'Continue with AI', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your decision, ready to review.' })).toBeFocused();
    await page.getByRole('checkbox', { name: 'I’ve reviewed these shared choices and who needs to approve.' }).check();
    await page.getByText('Adjust the wording', { exact: true }).click(); await page.getByLabel('Decision title', { exact: true }).fill('Changed title');
    await expect(page.getByRole('checkbox', { name: 'I’ve reviewed these shared choices and who needs to approve.' })).not.toBeChecked();
    await page.route('https://api.example.test/groups/**/drafts', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: 'PRIVATE_PROVIDER_PAYLOAD invalid json' }));
    await page.getByRole('button', { name: 'Back to my idea', exact: true }).click();
    await page.getByRole('button', { name: 'Continue with AI', exact: true }).click();
    await expect(page.getByText('The action could not be completed. Refresh its current state before trying again.', { exact: false })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain('PRIVATE_PROVIDER_PAYLOAD');
  } finally { await context.close(); await api.close(); }
});

test('delayed draft save clears premature review before creation can proceed', async ({ browser }) => {
  const api = await npApi(); const context = await browser.newContext();
  try {
    await connect(context, api, 'iris'); await api.call('iris', '/account/register', { displayName: 'Iris' }); await api.approve('iris');
    await api.groups.create({ kind: 'participant', subject: 'iris' }, { name: 'Small club', idempotencyKey: 'small' });
    const page = await context.newPage(); await page.goto(url); await page.getByRole('button', { name: /^Open group / }).first().click();
    await page.getByRole('button', { name: 'Start a decision' }).click();
  await page.getByLabel('Tell me what you want to decide').fill('Choose a fictional gallery meetup.');
    await page.getByRole('button', { name: 'Continue with AI', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your decision, ready to review.' })).toBeVisible();
    const reviewed = page.getByRole('checkbox', { name: 'I’ve reviewed these shared choices and who needs to approve.' });
    const create = page.getByRole('button', { name: 'Create decision' });
    const unsaved = page.getByText('You changed the wording. Save it first, then confirm your review.', { exact: true });
    await reviewed.check(); await page.getByText('Adjust the wording', { exact: true }).click(); await page.getByLabel('Decision title', { exact: true }).fill('Edited gallery meetup');
    await expect(unsaved).toBeVisible(); await expect(reviewed).not.toBeChecked(); await expect(create).toBeDisabled();
    let markSaveStarted!: () => void; let releaseSave!: () => void;
    const saveStarted = new Promise<void>(resolve => { markSaveStarted = resolve; });
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    await page.route('https://api.example.test/groups/*/drafts/*', async route => {
      if (route.request().method() === 'POST') { markSaveStarted(); await saveGate; }
      await route.fallback();
    });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await saveStarted;
    try { await expect(reviewed).toBeDisabled(); await expect(create).toBeDisabled(); } finally { releaseSave(); }
    await expect(reviewed).not.toBeChecked(); await expect(create).toBeDisabled();
    await expect(unsaved).toHaveCount(0); // The saved revision has now replaced the dirty draft.
    await expect(page.getByRole('dialog')).toHaveAttribute('open', '');
    await reviewed.check(); await expect(create).toBeEnabled();
  } finally { await context.close(); await api.close(); }
});

test('unanswered public questions survive saving and explicit answers create a reviewed new draft', async ({ browser }) => {
  const api = await npApi(clarificationTransport()); const context = await browser.newContext();
  try {
    await connect(context, api, 'iris'); await api.call('iris', '/account/register', { displayName: 'Iris' }); await api.approve('iris');
    await api.groups.create({ kind: 'participant', subject: 'iris' }, { name: 'Small club', idempotencyKey: 'small' });
    const page = await context.newPage(); await page.goto(url); await page.getByRole('button', { name: /^Open group / }).first().click();
    await page.getByRole('button', { name: 'Start a decision' }).click();
  await page.getByLabel('Tell me what you want to decide').fill('Choose a gallery meetup.');
    await page.getByRole('button', { name: 'Continue with AI', exact: true }).click();
    const question = page.getByText('Should this meetup be indoors or outdoors?', { exact: true });
    await expect(question).toBeVisible();
    const create = page.getByRole('button', { name: 'Create decision', exact: true });
    await expect(create).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Let AI update the draft', exact: true })).toBeDisabled();
    await page.getByLabel('Should this meetup be indoors or outdoors?', { exact: true }).fill('Indoors only.');
    await page.getByRole('button', { name: 'Let AI update the draft', exact: true }).click();
    await expect(question).toHaveCount(0); await expect(create).toBeDisabled();
    await page.getByRole('checkbox', { name: 'I’ve reviewed these shared choices and who needs to approve.' }).check();
    await expect(create).toBeEnabled(); await create.click();
    await expect(page.getByRole('heading', { name: 'Shared frame', exact: true })).toBeVisible();
  } finally { await context.close(); await api.close(); }
});

test('failed account refresh clears prior approved groups and recipient links', async ({browser}) => {
  const api=await npApi();const context=await browser.newContext();
  try {
    await connect(context,api,'iris');await api.call('iris','/account/register',{displayName:'Iris'});await api.approve('iris');
    await api.groups.create({kind:'participant',subject:'iris'},{name:'Fictional club',idempotencyKey:'club'});
    const page=await context.newPage();await page.goto(url);await expect(page.getByRole('heading',{name:'Decision groups',exact:true})).toBeVisible();
    await page.getByRole('button',{name:/^Open group /}).first().click();await expect(page.getByRole('heading',{name:'Invitations',exact:true})).toBeVisible();
    await page.getByLabel('Recipient email', {exact:true}).fill('fictional-recipient@example.invalid');
    await page.getByRole('button',{name:'Create invitation link',exact:true}).click();await expect(page.getByLabel('Invitation link',{exact:true})).toBeVisible();
    await page.route('https://api.example.test/account',route=>route.fulfill({status:500,body:'PRIVATE_FAILURE',headers:{'access-control-allow-origin':'*'}}));
    await page.getByRole('button',{name:'Refresh group'}).click();await expect(page.getByRole('heading',{name:'We couldn’t load your account',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Create group',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Fictional club',exact:true})).toHaveCount(0);
    await expect(page.getByLabel('Invitation link',{exact:true})).toHaveCount(0);expect(await page.locator('body').innerText()).not.toMatch(/PRIVATE_FAILURE|fictional-recipient/);
  }finally{await context.close();await api.close();}
});
test('a late approved refresh cannot overwrite a newer disabled account', async ({browser})=>{
  const api=await npApi();const context=await browser.newContext();
  try{
    await connect(context,api,'iris');await api.call('iris','/account/register',{displayName:'Iris'});await api.approve('iris');
    const page=await context.newPage();await page.goto(url);await expect(page.getByRole('heading',{name:'Decision groups',exact:true})).toBeVisible();
    let release!:()=>void;let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});const wait=new Promise<void>(resolve=>{release=resolve;});let requests=0;
    await page.route('https://api.example.test/account',async route=>{
      const response=await api.call('iris','/account');const body=await response.text();
      if(++requests===1){entered();await wait;}
      await route.fulfill({status:response.status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body}).catch(()=>{});
    });
    await page.getByRole('button',{name:/^Refresh (?:account and groups|group)$/}).click();await started;
    await expect(page.getByRole('button',{name:'Create group',exact:true})).toBeDisabled();await api.disable('iris');
    await page.getByRole('button',{name:/^Refresh (?:account and groups|group)$/}).click();await expect(page.getByText('Your access is disabled.',{exact:false})).toBeVisible();
    release();await page.waitForLoadState('networkidle');await expect(page.getByText('Your access is disabled.',{exact:false})).toBeVisible();
    await expect(page.getByRole('button',{name:'Create group',exact:true})).toHaveCount(0);
  }finally{await context.close();await api.close();}
});

test('shared load helper awaits a held signed owner read before returning', async ({browser}) => {
 const api=await npApi();const context=await browser.newContext();let release=()=>{};
 try {
  const h=await freshGroup(api);await connect(context,api,'iris');const page=await context.newPage();await page.goto(url);
  let reached=false;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`https://api.example.test/decisions/${h.decisionId}/me`,async route=>{reached=true;await held;await route.fallback();});
  let finished=false;const statuses:string[]=[];
  const loading=loadSharedDecision(page,'https://api.example.test',h.decisionId,status=>statuses.push(status)).then(()=>{finished=true;});
  await expect.poll(()=>reached).toBe(true);
  await expect(page.getByRole('button',{name:'Refresh decision',exact:true})).toBeDisabled();expect(finished).toBe(false);
  release();await loading;expect(finished).toBe(true);expect(statuses).toContain('HTTP_OK');
  await expect(page.getByLabel('I reviewed this frame version, its options and public rules.')).toBeVisible();
 } finally {release();await context.close();await api.close();}
});

for (const lookupFailure of [false, true]) test(`follow-up answer proceeds after ${lookupFailure ? 'failed saved-request check is retried without losing input' : 'a successful saved-request check'}`, async ({ browser }) => {
  const api = await npApi(clarificationTransport()), context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let failedCheck = false, draftCalls = 0; const objectives: string[] = [];
  try {
    await connect(context, api, 'iris'); await api.call('iris', '/account/register', { displayName: 'Iris' }); await api.approve('iris');
    await api.groups.create({ kind: 'participant', subject: 'iris' }, { name: 'Small club', idempotencyKey: 'small' });
    await context.route('https://api.example.test/groups/*/draft-requests', async route => {
      if (route.request().method() === 'GET' && draftCalls > 0 && lookupFailure && !failedCheck) {
        failedCheck = true; await route.fulfill({ status: 503, json: { error: { code: 'RETRYABLE_SERVER_ERROR' } }, headers: { 'access-control-allow-origin': '*' } }); return;
      }
      await route.fallback();
    });
    await context.route('https://api.example.test/groups/*/drafts', async route => {
      if (route.request().method() === 'POST') { draftCalls++; objectives.push(route.request().postDataJSON().objective); }
      await route.fallback();
    });
    const page = await context.newPage(); await page.goto(url); await page.getByRole('button', { name: /^Open group / }).first().click();
    await page.getByRole('button', { name: 'Start a decision', exact: true }).click();
    await page.getByLabel('Tell me what you want to decide').fill('Choose a gallery meetup.');
    await page.getByRole('button', { name: 'Continue with AI', exact: true }).click();
    const answer = page.getByLabel('Should this meetup be indoors or outdoors?', { exact: true });
    const proceed = page.getByRole('button', { name: 'Let AI update the draft', exact: true });
    await expect(answer).toBeVisible(); await expect(proceed).toBeDisabled();
    await answer.fill('Indoors only.');
    if (lookupFailure) {
      await expect(proceed).toBeDisabled();
      await expect(page.getByText('We could not check your previous requests.', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: 'Check saved requests again', exact: true }).click();
      await expect(answer).toHaveValue('Indoors only.');
    }
    await expect(proceed).toBeEnabled(); expect(draftCalls).toBe(1);
    await proceed.click(); await expect(page.getByRole('heading', { name: 'Your decision, ready to review.' })).toBeVisible();
    expect(draftCalls).toBe(2); expect(objectives[1]).toContain('Answer: Indoors only.');
    const create = page.getByRole('button', { name: 'Create decision', exact: true }); await expect(create).toBeDisabled();
    await expect(page.getByText('Required: resolve all follow-up questions', { exact: false })).toBeVisible();
    await page.getByRole('checkbox', { name: 'I’ve reviewed these shared choices and who needs to approve.' }).check();
    await expect(create).toBeEnabled(); await create.click(); await expect(page.getByRole('heading', { name: 'Shared frame', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); await api.close(); }
});

test('an expired follow-up request closes without losing the saved draft or typed answer, then creates after explicit review', async ({browser}) => {
 const api=await npApi(clarificationTransport()),context=await browser.newContext();let submissions=0,key='';
 try {
  await connect(context,api,'iris');await api.call('iris','/account/register',{displayName:'Iris'});await api.approve('iris');await api.groups.create({kind:'participant',subject:'iris'},{name:'Recovery club',idempotencyKey:'recovery'});
  await context.route('https://api.example.test/groups/*/drafts',async route=>{
   if(route.request().method()==='POST'&&++submissions===2){key=route.request().postDataJSON().idempotencyKey;await route.fulfill({status:503,json:{error:{code:'RETRYABLE_SERVER_ERROR'},draftFailure:'REQUEST_PENDING'},headers:{'access-control-allow-origin':'*'}});return;}await route.fallback();
  });
  await context.route('https://api.example.test/groups/*/draft-requests/**',async route=>{
   if(!new URL(route.request().url()).pathname.includes(key)||!key){await route.fallback();return;}
   const releasing=route.request().method()==='POST';if(releasing)expect(route.request().postDataJSON()).toEqual({revision:3});
   await route.fulfill({json:{draftRequest:{state:releasing?'CANCELLED':'FAILED',progress:releasing?'STOPPED':'EXPIRED',canRelease:true,revision:releasing?4:3}},headers:{'access-control-allow-origin':'*'}});
  });
  const page=await context.newPage();await page.goto(url);await page.getByRole('button',{name:/^Open group /}).first().click();await page.getByRole('button',{name:'Start a decision',exact:true}).click();
  await page.getByLabel('Tell me what you want to decide').fill('Choose a gallery meetup.');await page.getByRole('button',{name:'Continue with AI',exact:true}).click();
  const answer=page.getByLabel('Should this meetup be indoors or outdoors?',{exact:true});await answer.fill('Indoors only.');await page.getByRole('button',{name:'Let AI update the draft',exact:true}).click();
  await page.getByRole('button',{name:'Check progress',exact:true}).click();await expect(page.getByText('This request expired before AI started. Close it to return to your saved draft.',{exact:true})).toBeVisible();await expect(answer).toBeDisabled();
  await page.getByRole('button',{name:'Close unfinished request',exact:true}).click();await expect(answer).toHaveValue('Indoors only.');await expect(answer).toBeEditable();
  await page.getByRole('button',{name:'Let AI update the draft',exact:true}).click();await expect(page.getByRole('heading',{name:'Your decision, ready to review.'})).toBeVisible();
  const create=page.getByRole('button',{name:'Create decision',exact:true});await expect(create).toBeDisabled();await page.getByRole('checkbox',{name:'I’ve reviewed these shared choices and who needs to approve.'}).check();await create.click();await expect(page.getByRole('heading',{name:'Shared frame',exact:true})).toBeVisible();expect(submissions).toBe(3);
 }finally{await context.close();await api.close();}
});
