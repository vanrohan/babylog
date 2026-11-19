import React,{useCallback,useEffect,useState,useRef} from 'react';
import {api,json} from './api.ts';
import type {User} from '../shared.ts';
import {Icon} from './Icon.tsx';

type Session={user:User|null;setupRequired:boolean};
export function Auth({children}:{children:(user:User,authenticated:boolean,onLogout:()=>Promise<void>)=>React.ReactNode}){
 const [user,setUser]=useState<User|null>(null),[authenticated,setAuthenticated]=useState(false),[loaded,setLoaded]=useState(false),[setupRequired,setSetupRequired]=useState(false),[error,setError]=useState('');
 const revision=useRef(0);
 const check=useCallback(async()=>{const id=++revision.current;try{const session=await api<Session>('/auth/session');if(id!==revision.current)return;setSetupRequired(session.setupRequired);setAuthenticated(!!session.user);if(session.user)setUser(session.user);setLoaded(true);setError('');}catch(e){if(id!==revision.current)return;setError((e as Error).message);setAuthenticated(false);setLoaded(true);}},[]);
 useEffect(()=>{void check();const expired=()=>{revision.current++;setAuthenticated(false);};window.addEventListener('babylog:unauthorized',expired);window.addEventListener('focus',check);const timer=setInterval(()=>void check(),60_000);return ()=>{window.removeEventListener('babylog:unauthorized',expired);window.removeEventListener('focus',check);clearInterval(timer);};},[check]);
 async function logout(){revision.current++;await api('/auth/logout',json('POST',{}));revision.current++;setAuthenticated(false);setUser(null);}
 return <>{user&&<div key={user.id} hidden={!authenticated} inert={!authenticated}>{children(user,authenticated,logout)}</div>}{!authenticated&&<Login loaded={loaded} setupRequired={setupRequired} initialUsername={user?.username??''} error={error} onRetry={()=>void check()} onLogin={next=>{revision.current++;setUser(next);setAuthenticated(true);}}/>}</>;
}
function Login({loaded,setupRequired,initialUsername,error:loadError,onRetry,onLogin}:{loaded:boolean;setupRequired:boolean;initialUsername:string;error:string;onRetry:()=>void;onLogin:(user:User)=>void}){
 const [username,setUsername]=useState(initialUsername),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function login(event:React.FormEvent){event.preventDefault();if(busy)return;setBusy(true);setError('');try{const result=await api<{user:User}>('/auth/login',json('POST',{username,password}));setPassword('');onLogin(result.user);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <main className="auth-page"><section className="auth-panel" aria-label="Sign in"><a href="/" className="brand"><Icon name="diary" size={30}/><span>babylog</span></a><h1>{setupRequired?'Sign-in setup':'Sign in'}</h1>
  {!loaded&&!loadError?<p role="status">Loading...</p>:setupRequired?<><p>The server login is not configured.</p><button onClick={onRetry}>Check again</button></>:loadError?<><p role="alert" className="input-error">{loadError}</p><button onClick={onRetry}>Try again</button></>:<form className="account-form" onSubmit={event=>void login(event)}><label>Username<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required maxLength={64} value={username} disabled={busy} onChange={event=>setUsername(event.target.value)}/></label><label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={128} value={password} disabled={busy} onChange={event=>setPassword(event.target.value)}/></label>{error&&<p className="input-error" role="alert">{error}</p>}<button className="primary" type="submit" disabled={busy} aria-busy={busy}>{busy&&<Icon name="spinner" size={18}/>}<span>{busy?'Signing in...':'Sign in'}</span></button></form>}
 </section></main>;
}
