// Only the existing owned-fixture creator calls this opt-in live UI confirmation.
import { createMailtmClient } from '../live-qa/mailtm.mjs';
export async function confirmBrandedFixture(config,fixture,browser){
 const context=await browser.newContext();const page=await context.newPage();
 try{await page.goto(config.allowedOrigin);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Enter verification code'}).click();await page.getByLabel('Username',{exact:true}).fill(fixture.mailbox.address);
 const since=Math.max(fixture.mailbox.createdAt,Math.floor(Date.now()/1000)*1000);await page.getByRole('button',{name:'Resend code',exact:true}).click();await page.getByRole('status').filter({hasText:'new code'}).waitFor();
 const mail=createMailtmClient();let code;for(let attempt=0;attempt<3&&!code;attempt++)code=await mail.code({...fixture.mailbox,createdAt:since});if(!code)throw new Error('BRANDED_VERIFICATION_MAIL_NOT_OBSERVED');
 await page.getByLabel('Verification code').fill(code);await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('status').filter({hasText:'Email verified. Sign in to continue.'}).waitFor();
 if(await page.evaluate(()=>globalThis.sessionStorage.getItem('known-enough-cognito-session')))throw new Error('CONFIRMATION_AUTO_SESSION');
 }finally{await context.close();}
}
