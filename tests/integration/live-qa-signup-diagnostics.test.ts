import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';
// @ts-expect-error JavaScript observer is tested at its actual event boundary.
import { signupProviderCode, trackSignupRequest } from '../../scripts/live-qa/signup-diagnostics.mjs';

const endpoint='https://cognito-idp.us-east-1.amazonaws.com/';
const request=(action='SignUp',url=endpoint,method='POST')=>({method:()=>method,url:()=>url,headers:()=>({'x-amz-target':'AWSCognitoIdentityProviderService.'+action}),failure:()=>({errorText:'net::ERR_NAME_NOT_RESOLVED PRIVATE_EMAIL_TOKEN'}),postData:()=>{throw new Error('REQUEST_BODY_MUST_NOT_BE_READ');}});
const response=(r=request(),status=400,body='{"__type":"InvalidLambdaResponseException","message":"PRIVATE_EMAIL_PASSWORD_TOKEN"}',header?:string)=>({request:()=>r,status:()=>status,headers:()=>header?{'x-amzn-errortype':header}:{},body:async()=>Buffer.from(body)});

test('registration diagnostic keeps exact enumerated provider code and omits all response detail',()=>{
  expect(signupProviderCode(400,undefined,Buffer.from('{"__type":"vendor#UserLambdaValidationException","message":"PRIVATE"}'))).toBe('UserLambdaValidationException');
  expect(signupProviderCode(400,'InvalidPasswordException:PRIVATE',Buffer.from('PRIVATE'))).toBe('InvalidPasswordException');
  expect(signupProviderCode(200,'PRIVATE',Buffer.from('PRIVATE'))).toBe('COGNITO_ACCEPTED');
  for(const raw of ['PRIVATE_EMAIL','UnknownException','x'.repeat(161)])expect(signupProviderCode(400,raw,undefined)).toBe('COGNITO_UNKNOWN_ERROR');
  for(const raw of ['not-json','[]','null','{"message":"PRIVATE"}', '{"__type":"PRIVATE"}'])expect(signupProviderCode(400,undefined,Buffer.from(raw))).toBe('COGNITO_UNKNOWN_ERROR');
  expect(signupProviderCode(400,undefined,Buffer.from('{"__type":"InvalidPasswordException","extra":"'+'x'.repeat(16384)+'"}'))).toBe('COGNITO_UNKNOWN_ERROR');
});

test('observer records the existing Cognito signup failure, ignores unrelated traffic and never reads request bodies',async()=>{
  const page=new EventEmitter();const seen:string[][]=[];let clicks=0;
  await trackSignupRequest(page,'SignUp',async()=>{
    clicks++;
    for(const r of [request('ConfirmSignUp'),request('SignUp','https://attacker.invalid/'),request('SignUp',endpoint,'GET'),request('PrivateAction')])page.emit('response',response(r));
    page.emit('response',response());
    page.emit('response',response(request(),200));
  },(status:string,code:string)=>seen.push([status,code]));
  expect(clicks).toBe(1);expect(seen).toEqual([['HTTP_PENDING','COGNITO_NO_RESPONSE'],['HTTP_BAD_REQUEST','InvalidLambdaResponseException']]);
  expect(page.listenerCount('response')).toBe(0);expect(page.listenerCount('requestfailed')).toBe(0);expect(JSON.stringify(seen)).not.toMatch(/PRIVATE|attacker/);
});

test('confirmation observes its own response and awaits only the existing body even after the browser assertion fails',async()=>{
  const page=new EventEmitter();const seen:string[][]=[];
  await expect(trackSignupRequest(page,'ConfirmSignUp',async()=>{
    page.emit('response',response(request('SignUp'),200));
    page.emit('response',response(request('ConfirmSignUp'),400,'{"__type":"CodeMismatchException","message":"PRIVATE"}'));
    throw new Error('PRIVATE_BROWSER_ASSERTION');
  },(s:string,c:string)=>seen.push([s,c]))).rejects.toThrow('PRIVATE_BROWSER_ASSERTION');
  expect(seen.at(-1)).toEqual(['HTTP_BAD_REQUEST','CodeMismatchException']);expect(JSON.stringify(seen)).not.toContain('PRIVATE');
  expect(page.eventNames()).toEqual([]);
});

test('transport and unreadable response preserve fixed failure categories and clean observers',async()=>{
  const page=new EventEmitter();let seen:string[][]=[];
  await trackSignupRequest(page,'SignUp',async()=>page.emit('requestfailed',request()),(s:string,c:string)=>seen.push([s,c]));
  expect(seen.at(-1)).toEqual(['HTTP_TRANSPORT_FAILED','COGNITO_NO_RESPONSE']);
  seen=[];
  await trackSignupRequest(page,'SignUp',async()=>page.emit('response',{...response(request(),503),body:async()=>{throw new Error('PRIVATE');}}),(s:string,c:string)=>seen.push([s,c]));
  expect(seen.at(-1)).toEqual(['HTTP_UNAVAILABLE','COGNITO_UNKNOWN_ERROR']);expect(page.eventNames()).toEqual([]);
});

test('unknown action rejects before observation or work and missing response remains unknown',async()=>{
  const page=new EventEmitter();let calls=0;const seen:string[][]=[];
  await expect(trackSignupRequest(page,'DeleteUser',async()=>calls++,(s:string,c:string)=>seen.push([s,c]))).rejects.toThrow('SIGNUP_DIAGNOSTIC_ACTION_INVALID');
  expect(calls).toBe(0);expect(page.eventNames()).toEqual([]);
  await trackSignupRequest(page,'SignUp',async()=>calls++,(s:string,c:string)=>seen.push([s,c]));
  expect(seen).toEqual([['HTTP_PENDING','COGNITO_NO_RESPONSE']]);expect(calls).toBe(1);
});
