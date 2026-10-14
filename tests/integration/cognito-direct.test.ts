import { describe,it,expect,vi,beforeEach } from 'vitest';
import type { CognitoUserSession,IAuthenticationCallback } from 'amazon-cognito-identity-js';
const fake=vi.hoisted(()=>({callbacks:null as IAuthenticationCallback|null,storage:null as {getItem:(key:string)=>string|null}|null,verifyAlias:true,calls:0,refreshed:null as unknown}));
vi.mock('amazon-cognito-identity-js',()=>({AuthenticationDetails:class{},CognitoUserPool:class{constructor(options:{Storage:typeof fake.storage}){fake.storage=options.Storage;}},CognitoUser:class{
 authenticateUser(_details:unknown,callbacks:IAuthenticationCallback){fake.calls++;fake.callbacks=callbacks;}
 confirmRegistration(_code:string,alias:boolean,callback:(error:null)=>void){fake.verifyAlias=alias;callback(null);}
 resendConfirmationCode(callback:(error:null)=>void){callback(null);}
 forgotPassword(callbacks:{inputVerificationCode:()=>void}){callbacks.inputVerificationCode();}
 confirmPassword(_code:string,_password:string,callbacks:{onSuccess:()=>void}){callbacks.onSuccess();}
 refreshSession(_token:unknown,callback:(error:null,session:unknown)=>void){callback(null,fake.refreshed);}
 signOut(){}
}}));
import { createDirectCognito,directFailure,directSession } from '../../apps/web/src/cognito-direct';
const config={region:'us-east-1',userPoolId:'us-east-1_test',participantClientId:'participant',displayClientId:'display',domain:'https://test.example.invalid',apiBaseUrl:'https://api.example.invalid'};
const session=(overrides:Record<string,unknown>={}):CognitoUserSession=>({getRefreshToken:()=>({getToken:()=> 'RAM_ONLY_REFRESH'}),getAccessToken:()=>({getJwtToken:()=> 'mock-access',decodePayload:()=>({token_use:'access',client_id:'participant',iss:'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',exp:Math.floor(Date.now()/1000)+3600,...overrides})})}) as unknown as CognitoUserSession;
beforeEach(()=>{fake.calls=0;fake.callbacks=null;});
describe('supported vendor SRP session boundary',()=>{
 it('normalizes access metadata only and rejects ID, foreign-client/issuer and expired tokens',()=>{
  expect(directSession(config,session())).toMatchObject({accessToken:'mock-access',kind:'participant',method:'SRP'});
  for(const claims of [{token_use:'id'},{client_id:'display'},{iss:'other'},{exp:0},{exp:'9999999999'}])expect(()=>directSession(config,session(claims))).toThrow('UNAVAILABLE');
 });
 it('does not enumerate or return provider/private error messages',()=>{
  for(const name of ['NotAuthorizedException','UserNotFoundException'])expect(directFailure({name,message:'PRIVATE'}).message).toBe('INVALID_CREDENTIALS');
  expect(directFailure({name:'Other',message:'PRIVATE'}).message).toBe('UNAVAILABLE');
 });
 it('uses SDK RAM storage and makes one vendor request, then supports explicit verification without stealing aliases',async()=>{
  const client=createDirectCognito(config);const pending=client.login('test-user','PRIVATE_PASSWORD');expect(fake.calls).toBe(1);expect(fake.storage!.getItem('anything')).toBeNull();fake.callbacks!.onSuccess(session());
  expect((await pending).kind).toBe('SESSION');expect(client.canRefresh()).toBe(true);client.signOut();expect(client.canRefresh()).toBe(false);
  await client.verify('test-user','PRIVATE_CODE');expect(fake.verifyAlias).toBe(false);await client.reset('test-user');await client.finishReset('test-user','PRIVATE_CODE','PRIVATE_PASSWORD');
 });
 it('rejects a late success after cancellation and does not revive its session',async()=>{
  const client=createDirectCognito(config),pending=client.login('user','secret');const rejected=expect(pending).rejects.toThrow('UNAVAILABLE');client.signOut();fake.callbacks!.onSuccess(session());await rejected;expect(client.canRefresh()).toBe(false);
 });
 it('distinguishes confirmation and reset challenges, with safe required-password attributes',async()=>{
  const client=createDirectCognito(config);let pending=client.login('user','secret');fake.callbacks!.onFailure({name:'UserNotConfirmedException',message:'PRIVATE'});expect(await pending).toEqual({kind:'VERIFY'});
  pending=client.login('user','secret');fake.callbacks!.onFailure({name:'PasswordResetRequiredException',message:'PRIVATE'});expect(await pending).toEqual({kind:'RESET'});
  pending=client.login('user','secret');fake.callbacks!.newPasswordRequired!({},['userAttributes.email']);expect(await pending).toEqual({kind:'NEW_PASSWORD',attributes:['email']});
 });
 it('refreshes through the vendor session and rejects refresh after sign-out',async()=>{
  const client=createDirectCognito(config),pending=client.login('user','secret');fake.callbacks!.onSuccess(session());await pending;fake.refreshed=session();expect((await client.refresh()).method).toBe('SRP');client.signOut();await expect(client.refresh()).rejects.toThrow('UNAVAILABLE');
 });
 it('rejects unsupported private challenge attributes instead of asking the browser to supply them',async()=>{
  const client=createDirectCognito(config),pending=client.login('user','secret');const rejected=expect(pending).rejects.toThrow('UNSUPPORTED');fake.callbacks!.newPasswordRequired!({},['custom:authorization']);await rejected;
 });

});
