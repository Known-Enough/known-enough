import { useEffect,useRef,useState } from 'react';
import { DirectAuthFailure,type DirectCognito,type DirectResult } from './cognito-direct';
import type { CognitoSession } from './cognito-session';
const failureText=(error:unknown)=>error instanceof DirectAuthFailure?error.code==='INVALID_CREDENTIALS'?'Sign-in details were not accepted. Check them and try again.':error.code==='INVALID_CODE'?'The code was not accepted. Check it or request a new code.':error.code==='INVALID_PASSWORD'?'Use eight or more characters with uppercase, lowercase, a number and a symbol.':error.code==='UNSUPPORTED'?'This verification step is unavailable. Contact the app operator.':'Sign-in is temporarily unavailable. Try again later.':'The result is not confirmed. Try again later.';
export function SignInForm({client,onSession,onBack}:{client:DirectCognito;onSession:(session:CognitoSession)=>void;onBack:()=>void}){
 const [stage,setStage]=useState<'LOGIN'|'FORGOT'|DirectResult['kind']>('LOGIN'),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState(''),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[required,setRequired]=useState<string[]>([]),[attributes,setAttributes]=useState<Record<string,string>>({});
 const epoch=useRef(0),submitting=useRef(false),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();},[stage]);useEffect(()=>()=>{epoch.current++;},[]);
 const result=(value:DirectResult,current:number)=>{if(current!==epoch.current)return;if(value.kind==='SESSION')onSession(value.session);else{setStage(value.kind);setRequired(value.attributes??[]);setNotice(value.kind==='VERIFY'?'Verify your email before signing in.':'');}};
 async function action(work:(current:number)=>Promise<void>){if(submitting.current)return;submitting.current=true;setBusy(true);setNotice('');const current=epoch.current;
  try{await work(current);}catch(error){if(current===epoch.current)setNotice(failureText(error));}finally{if(current===epoch.current){setBusy(false);submitting.current=false;}}}
 function back(){epoch.current++;submitting.current=false;client.signOut();setPassword('');setCode('');onBack();}
 return <form className="ke-registration" aria-busy={busy} onSubmit={event=>{event.preventDefault();const secret=password,answer=code;setPassword('');setCode('');void action(async current=>{
  if(stage==='LOGIN')result(await client.login(username,secret),current);
  else if(stage==='VERIFY'){await client.verify(username,answer);if(current!==epoch.current)return;setStage('LOGIN');setNotice('Email verified. Sign in to continue.');}
  else if(stage==='FORGOT'){await client.reset(username);if(current!==epoch.current)return;setStage('RESET');setNotice('If this account can receive a recovery code, it has been sent.');}
  else if(stage==='RESET'){await client.finishReset(username,answer,secret);if(current!==epoch.current)return;setStage('LOGIN');setNotice('Password reset. Sign in with your new password.');}
  else result(await client.answer(answer,secret,attributes),current);
 });}}>
 <h2 ref={heading} tabIndex={-1}>{stage==='LOGIN'?'Sign in':stage==='VERIFY'?'Verify email':stage==='FORGOT'||stage==='RESET'?'Reset password':stage==='NEW_PASSWORD'?'Choose a new password':'Verification required'}</h2>
 {['LOGIN','FORGOT','RESET','VERIFY'].includes(stage)&&<><label htmlFor="signin-username">Username</label><input id="signin-username" autoComplete="username" required maxLength={128} value={username} disabled={busy} onChange={event=>setUsername(event.target.value)} /></>}
 {['LOGIN','RESET','NEW_PASSWORD'].includes(stage)&&<><label htmlFor="signin-password">{stage==='LOGIN'?'Password':'New password'}</label><input id="signin-password" type={show?'text':'password'} autoComplete={stage==='LOGIN'?'current-password':'new-password'} required minLength={stage==='LOGIN'?1:8} value={password} disabled={busy} onChange={event=>setPassword(event.target.value)} /><button type="button" className="secondary" aria-pressed={show} onClick={()=>setShow(!show)}>{show?'Hide password':'Show password'}</button></>}
 {['VERIFY','RESET','MFA'].includes(stage)&&<><label htmlFor="signin-code">Verification code</label><input id="signin-code" autoComplete="one-time-code" required maxLength={32} value={code} disabled={busy} onChange={event=>setCode(event.target.value)} /></>}
 {stage==='NEW_PASSWORD'&&required.map(name=><label key={name}>{name}<input required value={attributes[name]??''} disabled={busy} onChange={event=>setAttributes({...attributes,[name]:event.target.value})} /></label>)}
 <button type="submit" disabled={busy}>{busy?'Please wait…':stage==='LOGIN'?'Sign in':stage==='FORGOT'?'Send recovery code':stage==='RESET'?'Reset password':'Continue'}</button>
 {stage==='LOGIN'&&<><button type="button" className="secondary" disabled={busy} onClick={()=>setStage('FORGOT')}>Forgot password?</button><button type="button" className="secondary" disabled={busy} onClick={()=>setStage('VERIFY')}>Enter verification code</button></>}
 {stage==='VERIFY'&&<button type="button" disabled={busy||!username.trim()} onClick={()=>void action(async current=>{await client.resend(username);if(current!==epoch.current)return;setNotice('If verification is available, a new code has been sent.');})}>Resend code</button>}
 <button type="button" className="secondary" onClick={back}>Back</button>{notice&&<p role="status">{notice}</p>}
 </form>;
}
