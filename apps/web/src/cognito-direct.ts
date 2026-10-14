import { AuthenticationDetails, CognitoUser, CognitoUserPool, type CognitoUserSession, type IAuthenticationCallback } from 'amazon-cognito-identity-js';
import type { CognitoBrowserConfig, CognitoSession } from './cognito-session';
export type DirectResult = { kind:'SESSION'; session:CognitoSession } | { kind:'VERIFY'|'RESET'|'NEW_PASSWORD'|'MFA'; attributes?:string[] };
export class DirectAuthFailure extends Error {
  constructor(readonly code:'INVALID_CREDENTIALS'|'VERIFY'|'RESET'|'INVALID_CODE'|'INVALID_PASSWORD'|'UNAVAILABLE'|'UNSUPPORTED') { super(code); }
}
export function directFailure(error:unknown):DirectAuthFailure {
  const name=error&&typeof error==='object'&&'name' in error?String(error.name):'';
  return new DirectAuthFailure(name==='UserNotConfirmedException'?'VERIFY':name==='PasswordResetRequiredException'?'RESET'
    :['NotAuthorizedException','UserNotFoundException'].includes(name)?'INVALID_CREDENTIALS':['CodeMismatchException','ExpiredCodeException'].includes(name)?'INVALID_CODE'
    :name==='InvalidPasswordException'?'INVALID_PASSWORD':'UNAVAILABLE');
}
export function directSession(config:CognitoBrowserConfig, session:CognitoUserSession):CognitoSession {
  const token=session.getAccessToken(), claims=token.decodePayload();
  // Metadata guard only. API verifies the JWT signature and its own admission/identity; no ID token or browser identity is used.
  if(claims.token_use!=='access'||claims.client_id!==config.participantClientId||claims.iss!==`https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`
    ||!Number.isSafeInteger(claims.exp)||claims.exp*1000<=Date.now()+5000||!token.getJwtToken())throw new DirectAuthFailure('UNAVAILABLE');
  return {accessToken:token.getJwtToken(),expiresAt:claims.exp*1000,kind:'participant',method:'SRP'};
}
export function createDirectCognito(config:CognitoBrowserConfig) {
  const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);},clear:()=>values.clear()};
  const pool=new CognitoUserPool({UserPoolId:config.userPoolId,ClientId:config.participantClientId,Storage:storage});
  let user:CognitoUser|null=null, raw:CognitoUserSession|null=null, mfa:'SMS_MFA'|'SOFTWARE_TOKEN_MFA'='SMS_MFA',generation=0;
  const select=(name:string)=>{if(!name.trim()||name.length>128)throw new DirectAuthFailure('INVALID_CREDENTIALS');user=new CognitoUser({Username:name.trim(),Pool:pool,Storage:storage});return user;};
  function authenticate(call:(callbacks:IAuthenticationCallback)=>void):Promise<DirectResult>{const epoch=generation;
    return new Promise((resolve,reject)=>{const callbacks:IAuthenticationCallback={
      onSuccess:session=>{if(epoch!==generation)return reject(new DirectAuthFailure('UNAVAILABLE'));try{const normalized=directSession(config,session);raw=session;resolve({kind:'SESSION',session:normalized});}catch{reject(new DirectAuthFailure('UNAVAILABLE'));}},
      onFailure:error=>{if(epoch!==generation)return reject(new DirectAuthFailure('UNAVAILABLE'));const failure=directFailure(error);if(failure.code==='VERIFY'||failure.code==='RESET')resolve({kind:failure.code});else reject(failure);},
      newPasswordRequired:(_attrs,required)=>{if(epoch!==generation)return reject(new DirectAuthFailure('UNAVAILABLE'));const names=Array.isArray(required)?required.map(String).map(name=>name.replace(/^userAttributes\./,'')):[];if(names.some(name=>!['email','name','phone_number'].includes(name)))reject(new DirectAuthFailure('UNSUPPORTED'));else resolve({kind:'NEW_PASSWORD',attributes:names});},
      mfaRequired:()=>{if(epoch!==generation)return reject(new DirectAuthFailure('UNAVAILABLE'));mfa='SMS_MFA';resolve({kind:'MFA'});},totpRequired:()=>{if(epoch!==generation)return reject(new DirectAuthFailure('UNAVAILABLE'));mfa='SOFTWARE_TOKEN_MFA';resolve({kind:'MFA'});},
      customChallenge:()=>reject(new DirectAuthFailure('UNSUPPORTED')),selectMFAType:()=>reject(new DirectAuthFailure('UNSUPPORTED')),mfaSetup:()=>reject(new DirectAuthFailure('UNSUPPORTED'))};
      try{call(callbacks);}catch(error){reject(directFailure(error));}
    });
  }
  return {
    login:(name:string,password:string)=>{generation++;values.clear();raw=null;const selected=select(name);return authenticate(callbacks=>selected.authenticateUser(new AuthenticationDetails({Username:name.trim(),Password:password}),callbacks));},
    answer:(code:string,password:string,attributes:Record<string,string>={})=>{if(!user)throw new DirectAuthFailure('UNAVAILABLE');return authenticate(callbacks=>password?user!.completeNewPasswordChallenge(password,attributes,callbacks):user!.sendMFACode(code,callbacks,mfa));},
    verify:(name:string,code:string)=>new Promise<void>((resolve,reject)=>select(name).confirmRegistration(code,false,error=>error?reject(directFailure(error)):resolve())),
    resend:(name:string)=>new Promise<void>((resolve,reject)=>select(name).resendConfirmationCode(error=>error?reject(directFailure(error)):resolve())),
    reset:(name:string)=>new Promise<void>((resolve,reject)=>select(name).forgotPassword({onSuccess:()=>resolve(),inputVerificationCode:()=>resolve(),onFailure:error=>{const failure=directFailure(error);if(failure.code==='INVALID_CREDENTIALS')resolve();else reject(failure);}})),
    finishReset:(name:string,code:string,password:string)=>new Promise<void>((resolve,reject)=>select(name).confirmPassword(code,password,{onSuccess:()=>resolve(),onFailure:error=>reject(directFailure(error))})),
    refresh:()=>new Promise<CognitoSession>((resolve,reject)=>{if(!user||!raw)return reject(new DirectAuthFailure('UNAVAILABLE'));const epoch=generation;user.refreshSession(raw.getRefreshToken(),(error,session)=>{if(error||epoch!==generation)return reject(new DirectAuthFailure('UNAVAILABLE'));try{const normalized=directSession(config,session);raw=session;resolve(normalized);}catch{reject(new DirectAuthFailure('UNAVAILABLE'));}});}),
    canRefresh:()=>Boolean(user&&raw),
    signOut:()=>{generation++;user?.signOut();user=null;raw=null;values.clear();},
  };
}
export type DirectCognito = ReturnType<typeof createDirectCognito>;
