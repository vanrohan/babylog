import React,{useState} from 'react';
import {Icon} from './Icon.tsx';
import type {User} from '../shared.ts';

export function Account({user,onLogout}:{user:User;onLogout:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function logout(){if(busy)return;setBusy(true);setError('');try{await onLogout();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section aria-label="Household login"><h3>Household login</h3><div className="account-heading"><strong>{user.username}</strong><button className="quiet" disabled={busy} aria-busy={busy} onClick={()=>void logout()}>{busy&&<Icon name="spinner" size={18}/>}Sign out</button></div>{error&&<p role="alert" className="input-error">{error}</p>}</section>;
}
