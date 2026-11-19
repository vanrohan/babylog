import React,{useEffect,useRef,useState} from 'react';
import {api,json} from './api.ts';
import type {CareTask,User} from '../shared.ts';
import {Account} from './Account.tsx';
import {Icon} from './Icon.tsx';
import {Help} from './Details.tsx';

function TaskEditor({task,onChanged}:{task:CareTask;onChanged:()=>Promise<void>}){
 const [label,setLabel]=useState(task.label),[draftVersion,setDraftVersion]=useState(task.version),[removing,setRemoving]=useState(false),[action,setAction]=useState(''),[error,setError]=useState('');
 const busy=!!action;
 async function save(remove=false){
  if(busy)return;setAction(remove?'remove':'save');setError('');
  try{const saved=await api<CareTask>('/care-tasks/'+task.key,json(remove?'DELETE':'PUT',remove?{version:draftVersion}:{label,version:draftVersion}));setDraftVersion(saved.version);await onChanged();setRemoving(false);}
  catch(e){setError((e as Error).message);}finally{setAction('');}
 }
 return <li className="task-editor"><form onSubmit={e=>{e.preventDefault();void save();}}><label className="sr-only" htmlFor={'task-'+task.key}>Task name: {task.label}</label><input id={'task-'+task.key} maxLength={80} value={label} disabled={busy} onChange={e=>setLabel(e.target.value)}/><button type="submit" disabled={busy||label===task.label} aria-busy={action==='save'} aria-label={'Save task '+task.label} title="Save" className="settings-icon"><Icon name={action==='save'?'spinner':'check'} size={19}/></button><button type="button" className="settings-icon danger" disabled={busy} onClick={()=>setRemoving(true)} aria-label={'Remove task '+task.label} title="Remove"><Icon name="trash" size={19}/></button></form>
  {removing&&<div className="task-removal"><p>Remove {task.label}? History stays.</p><button className="danger" disabled={busy} onClick={()=>void save(true)} aria-label="Remove from checklist" aria-busy={action==='remove'}>{action==='remove'&&<Icon name="spinner" size={19}/>}Remove</button><button disabled={busy} onClick={()=>setRemoving(false)} aria-label="Keep task">Cancel</button></div>}
  {error&&<p role="alert" className="input-error">{error}</p>}
 </li>;
}

function DiaryExport(){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>()=>pending.current?.abort(),[]);
 async function download(){
  if(pending.current)return;
  const controller=new AbortController();pending.current=controller;setBusy(true);setError('');
  try{
   const data=await api('/export',{signal:controller.signal});
   if(controller.signal.aborted)return;
   if(!Array.isArray(data.entries)||!Array.isArray(data.care)||!Array.isArray(data.careTasks))throw new Error('The diary export is invalid. Try again.');
   const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
   const link=document.createElement('a');link.href=url;link.download='babylog-export.json';link.target='_blank';link.rel='noopener';link.hidden=true;
   document.body.append(link);link.click();link.remove();
   // Safari needs the URL until its download starts.
   setTimeout(()=>URL.revokeObjectURL(url),60_000);
  }catch(e){if(!controller.signal.aborted)setError((e as Error).message);}
  finally{if(pending.current===controller){pending.current=null;if(!controller.signal.aborted)setBusy(false);}}
 }
 return <section className="settings-export" aria-label="Diary export"><button className="quiet" disabled={busy} aria-busy={busy} onClick={()=>void download()}><Icon name={busy?'spinner':'download'} size={21}/>{busy?'Preparing diary JSON...':'Download diary JSON'}</button><Help label="About diary JSON"><p>This file contains the diary records for use in other software.</p></Help>{error&&<p className="input-error" role="alert">{error}</p>}</section>;
}

export function Settings({onChanged,assistantAvailable,onAssistant,user,onLogout}:{user:User;onLogout:()=>Promise<void>;onChanged:()=>void;assistantAvailable:boolean;onAssistant:(opener:HTMLButtonElement)=>void}){
 const [tasks,setTasks]=useState<CareTask[]>([]),[loaded,setLoaded]=useState(false);
 const [error,setError]=useState(''),[taskName,setTaskName]=useState(''),[adding,setAdding]=useState(false),[taskError,setTaskError]=useState('');
 const reload=async()=>{setTasks(await api<CareTask[]>('/care-tasks'));onChanged();};
 useEffect(()=>{let active=true;void api<CareTask[]>('/care-tasks').then(tasks=>{if(active){setTasks(tasks);setLoaded(true);}}).catch(e=>{if(active)setError(e.message);});
  return ()=>{active=false;};
 },[]);
 async function addTask(event:React.FormEvent){event.preventDefault();if(adding)return;setAdding(true);setTaskError('');try{await api('/care-tasks',json('POST',{label:taskName}));setTaskName('');await reload();}catch(e){setTaskError((e as Error).message);}finally{setAdding(false);}}
 return <div className="drawer-body settings-body">{error&&<p className="notice error" role="alert">{error}</p>}
  <Account user={user} onLogout={onLogout}/>
  <DiaryExport/>
  {assistantAvailable&&<section aria-label="Assistant settings"><button className="quiet" onClick={event=>onAssistant(event.currentTarget)}><Icon name="chat" size={21}/>Assistant</button></section>}
  {!loaded?(!error&&<p role="status">Loading...</p>):<section aria-label="Daily tasks"><h3>Daily tasks</h3><ul className="task-list">{tasks.filter(task=>task.active).map(task=><TaskEditor key={task.key} task={task} onChanged={reload}/>)}</ul>{!tasks.some(task=>task.active)&&<p>No tasks</p>}<form className="add-task" onSubmit={event=>void addTask(event)}><label className="sr-only" htmlFor="new-daily-task">New daily task</label><input id="new-daily-task" value={taskName} maxLength={80} placeholder="New task" disabled={adding} onChange={e=>setTaskName(e.target.value)}/><button className="settings-icon" aria-label="Add daily task" aria-busy={adding} title="Add task" disabled={adding||!taskName.trim()} type="submit"><Icon name={adding?'spinner':'plus'} size={21}/></button>{taskError&&<p className="input-error" role="alert">{taskError}</p>}</form></section>}
 </div>;
}
