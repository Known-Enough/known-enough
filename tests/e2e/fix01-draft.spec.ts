import { expect,test } from '@playwright/test';
test.use({baseURL:'http://127.0.0.1:5175'});
for(const unknown of [false,true]) test(`draft503 gives honest cause and reload ${unknown?'keeps unknown call blocked':'releases one known request through server CAS'}`,async({page})=>{
 let key='';let drafts=0;let releases=0;let inventoryReady=false;let closed=false;
 const group={id:'garden',name:'FIX01 synthetic group',version:1,isOrganizer:true,members:[{id:'own-member',displayName:'Owner',isOrganizer:true}],drafts:[],pendingInvitations:0,decisions:[]};
 await page.addInitScript(()=>sessionStorage.setItem('known-enough-cognito-session',JSON.stringify({accessToken:'header.payload.signature',kind:'participant',expiresAt:Date.now()+900000})));
 await page.route('https://local-api.example.invalid/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'}});return;}
  let body:unknown={},status=200;
  if(path==='/account')body={account:{status:'APPROVED',displayName:'Owner',version:1}};
  else if(path==='/groups/garden')body={group};
  else if(path==='/groups/garden/draft-requests'){inventoryReady=true;body={requests:closed?[]:key?[{key}]:[]};}
  else if(path==='/groups/garden/drafts'){drafts++;key=request.postDataJSON().idempotencyKey;status=503;body={ok:false,error:{code:'RETRYABLE_SERVER_ERROR'},draftFailure:unknown?'REQUEST_UNKNOWN':'AI_UNAVAILABLE',message:'PRIVATE_SERVER_ERROR_CANARY'};}
  else if(path===`/groups/garden/draft-requests/${key}`)body={draftRequest:{state:unknown?'UNKNOWN':'NOT_SUBMITTED',canRelease:!unknown,revision:unknown?9:0}};
  else if(path===`/groups/garden/draft-requests/${key}/release`){releases++;closed=true;expect(request.postDataJSON()).toEqual({revision:0});body={draftRequest:{state:'CANCELLED',canRelease:true,revision:1}};}
  else status=404;
  await route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
 });
 await page.goto('/?group=garden');const start=page.getByRole('button',{name:'Start a decision',exact:true});await expect(start).toBeEnabled();await expect.poll(()=>inventoryReady).toBe(true);await start.click();
 await page.getByLabel('Tell me what you want to decide').fill('PUBLIC_TRANSIENT_OBJECTIVE');await page.getByRole('button',{name:'Continue with AI',exact:true}).click();
 await expect(page.getByText(unknown?'The outcome is not confirmed. Recover this same request before starting another.':'AI drafting is unavailable on this server. Recover the request before trying again later.',{exact:true})).toBeVisible();
 expect(await page.locator('body').innerText()).not.toMatch(/PRIVATE_SERVER_ERROR_CANARY|Check your account and organizer access/);
 expect(await page.evaluate(()=>sessionStorage.getItem('ke-draft-request:garden'))).toBe(key);
 expect(await page.evaluate(()=>JSON.stringify({...sessionStorage,...localStorage}))).not.toContain('PUBLIC_TRANSIENT_OBJECTIVE');
 await page.reload();await page.getByRole('button',{name:'Continue your draft',exact:true}).click();await expect(page.getByRole('button',{name:'Check progress',exact:true})).toBeVisible();expect(drafts).toBe(1);
 const release=page.getByRole('button',{name:'Close request and start again',exact:true});
 if(unknown){await expect(release).toHaveCount(0);await expect(page.getByText('We haven’t confirmed what happened.',{exact:false})).toBeVisible();expect(releases).toBe(0);}
 else{await expect(release).toBeEnabled();await release.click();await expect(page.getByText('The previous request is closed.',{exact:false})).toBeVisible();expect(await page.evaluate(()=>sessionStorage.getItem('ke-draft-request:garden'))).toBeNull();expect(releases).toBe(1);}
 expect(drafts).toBe(1);
});
