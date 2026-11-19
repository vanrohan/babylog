import React,{useState,useEffect,useLayoutEffect,useRef,useCallback,lazy,Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import {api,json,saveEntryRequest} from './api.ts';
import {parseTemperature,shiftedTime,timeAgo,lastActivityEnd} from './input.ts';
import {EntryTime,type EntryTimeHandle} from './EntryTime.tsx';
import {TimeShortcuts} from './TimeShortcuts.tsx';
import {PcmRecording} from './recording.ts';
import {dateTimeInput,inputToIso,dayInput} from '../time.ts';
import {careNames,careLabels,emptyCare,assistantConversationError,type CareCheck} from '../shared.ts';
import type {Entry,EntryUndo,Care,CareTask,Proposal,AssistantReply,Operation,ConversationTurn} from '../shared.ts';
import './style.css';
import {Auth} from './Auth.tsx';
import type {User} from '../shared.ts';
import {Settings} from './Settings.tsx';
import {Icon} from './Icon.tsx';
import {latestCareStart,elapsedCareTime} from '../care-status.ts';
import {Help,EntryNotes} from './Details.tsx';
import {proposalFeedback} from '../feedback.ts';
import {activityLabel as label,entryLabel,feedingTypes} from '../activities.ts';
const Dashboard=lazy(()=>import('./Dashboard.tsx').then(module=>({default:module.Dashboard})));

const names:Record<string,string>={feeding:'Feeding',sleep:'Sleep',nappy:'Nappy change',bath:'Bath',note:'Note'};
const time=(iso:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
const dateLabel=(day:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long'}).format(new Date(day+'T12:00:00Z'));
const when=(iso:string)=>`${dayInput(iso)} at ${time(iso)}`;
function App({user,authenticated,onLogout}:{user:User;authenticated:boolean;onLogout:()=>Promise<void>}){
 const [page,setPage]=useState(location.pathname==='/assistant'?'assistant':location.pathname==='/dashboard'?'dashboard':'log');
 const [allEntries,setAllEntries]=useState<Entry[]>([]);
 const [day,setDay]=useState(dayInput());
 const [care,setCare]=useState<Care>(emptyCare);
 const [careTasks,setCareTasks]=useState<CareTask[]>([]);
 const [tasksReady,setTasksReady]=useState(false);
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const tick=()=>setNow(Date.now());const timer=setInterval(tick,30_000);window.addEventListener('focus',tick);return ()=>{clearInterval(timer);window.removeEventListener('focus',tick);};},[]);
 const [editing,setEditing]=useState<Entry|null>(null);
 const [entryBusy,setEntryBusy]=useState(false);
 const [entryOpen,setEntryOpen]=useState(false);
 const [toastDay,setToastDay]=useState<string|null>(null);
 useEffect(()=>{if(editing)setEntryOpen(true);},[editing]);
 const assistantReturn=useRef<'log'|'dashboard'>('log');
 const [settings,setSettings]=useState(false);
 const [assistantConfig,setAssistantConfig]=useState({assistantAvailable:false,transcriptionAvailable:false});
 const assistantOpener=useRef<HTMLButtonElement|null>(null);
 useEffect(()=>{
  if(!authenticated){setAssistantConfig({assistantAvailable:false,transcriptionAvailable:false});return;}
  let active=true,pending:AbortController|null=null;
  const update=()=>{
   if(document.visibilityState==='hidden'||pending)return;
   const controller=new AbortController();pending=controller;const timer=setTimeout(()=>controller.abort(),8000);
   void api('/config',{signal:controller.signal}).then(c=>{
    if(active&&!controller.signal.aborted&&typeof c.assistantAvailable==='boolean'&&typeof c.transcriptionAvailable==='boolean')setAssistantConfig({assistantAvailable:c.assistantAvailable===true,transcriptionAvailable:c.transcriptionAvailable===true});
   }).catch(()=>{}).finally(()=>{clearTimeout(timer);if(pending===controller)pending=null;});
  };
  update();const interval=setInterval(update,10_000);window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);
  return ()=>{active=false;pending?.abort();clearInterval(interval);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};
 },[authenticated]);
 const visiblePage=page==='assistant'&&!assistantConfig.assistantAvailable?'log':page;
 const [error,setError]=useState('');
 const [entryLoadError,setEntryLoadError]=useState(''),[taskLoadError,setTaskLoadError]=useState('');
 const [toast,setToast]=useState('');
 const [lastEdit,setLastEdit]=useState<Entry|null>(null),[reviewUndo,setReviewUndo]=useState(false);
 const [online,setOnline]=useState(navigator.onLine);
 const [loaded,setLoaded]=useState(false);
 const [filter,setFilter]=useState('all');
 const [ending,setEnding]=useState('');const endPending=useRef(false);
 const endSaves=useRef(new Map<string,{key:string;version:number;entry:Entry}>());
 const diaryBusy=entryBusy||!!ending;
 const [careBusy,setCareBusy]=useState(false);
 const [checksDay,setChecksDay]=useState(''),[careDay,setCareDay]=useState('');
 const careCache=useRef(new Map<string,Care>());
 const [careError,setCareError]=useState<{day:string;message:string}|null>(null);
 const [checksError,setChecksError]=useState<{day:string;message:string}|null>(null);
 const carePending=useRef(false);
 const currentDay=useRef(day);currentDay.current=day;
 const checksReady=tasksReady&&checksDay===day;
 const displayedCare=careDay===day?care:careCache.current.get(day)??emptyCare();
 const currentChecks=useRef({ready:checksReady});currentChecks.current={ready:checksReady};
 const careTarget=useRef<string|null>(null);
 const requestId=useRef(0),checksRequestId=useRef(0);
 const globalPending=useRef<Promise<void>|null>(null);
 const checksPending=useRef<{day:string;promise:Promise<void>}|null>(null);
 const sessionActive=useRef(authenticated);sessionActive.current=authenticated;
 const refreshGlobal=useCallback(async(afterPending=false):Promise<void>=>{
  if(!sessionActive.current)return;
  if(globalPending.current){await globalPending.current;if(afterPending&&sessionActive.current)await refreshGlobal();return;}
  const id=requestId.current;
  const pending=(async()=>{
   await Promise.all([
    api<Entry[]>('/entries').then(all=>{if(id!==requestId.current||!sessionActive.current)return;setAllEntries(all);setNow(Date.now());setOnline(true);setLoaded(true);setEntryLoadError('');}).catch(e=>{if(id!==requestId.current||!sessionActive.current)return;setOnline(false);setEntryLoadError((e as Error).message);}),
    api<CareTask[]>('/care-tasks').then(tasks=>{if(id!==requestId.current||!sessionActive.current)return;setCareTasks(tasks);setTasksReady(true);setTaskLoadError('');}).catch(e=>{if(id!==requestId.current||!sessionActive.current)return;setTasksReady(false);setTaskLoadError((e as Error).message);})
   ]);
  })();
  globalPending.current=pending;
  try{await pending;}finally{if(globalPending.current===pending)globalPending.current=null;}
 },[]);
 const refreshChecks=useCallback(async(force=false):Promise<void>=>{
  if(!sessionActive.current)return;
  const targetDay=currentDay.current;
  if(checksPending.current?.day===targetDay&&!force){await checksPending.current.promise;return;}
  const id=++checksRequestId.current;
  const pending=(async()=>{
   try{
    const checks=await api<Care>('/care/'+targetDay);
    if(id!==checksRequestId.current||!sessionActive.current)return;
    if(force||!carePending.current||careTarget.current!==targetDay){
     careCache.current.set(targetDay,checks);
     if(currentDay.current===targetDay){setCare(checks);setCareDay(targetDay);setChecksDay(targetDay);setChecksError(previous=>previous?.day===targetDay?null:previous);}
    }
   }catch(e){if(id!==checksRequestId.current||!sessionActive.current)return;if(currentDay.current===targetDay){setChecksDay('');setChecksError({day:targetDay,message:(e as Error).message});}}
  })();
  checksPending.current={day:targetDay,promise:pending};
  try{await pending;}finally{if(checksPending.current?.promise===pending)checksPending.current=null;}
 },[]);
 const refresh=useCallback(async(forceCare=false)=>{await Promise.all([refreshGlobal(true),refreshChecks(forceCare)]);},[refreshGlobal,refreshChecks]);
 useEffect(()=>{
  if(!authenticated)return;
  sessionActive.current=true;
  void refreshGlobal(true);
  const update=()=>{if(document.visibilityState==='hidden')return;void refreshGlobal();void refreshChecks();};
  const interval=setInterval(update,10_000);
  window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);
  return ()=>{sessionActive.current=false;clearInterval(interval);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);requestId.current++;checksRequestId.current++;};
 },[authenticated,refreshGlobal,refreshChecks]);
 useLayoutEffect(()=>{
  setChecksDay('');
  if(authenticated)void refreshChecks();
  return ()=>{checksRequestId.current++;checksPending.current=null;};
 },[day,authenticated,refreshChecks]);
 useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),7000);return ()=>clearTimeout(t);}},[toast]);
 useEffect(()=>{if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('/sw.js').catch(()=>{});},[]);
 useEffect(()=>{const changed=()=>setPage(location.pathname==='/assistant'?'assistant':location.pathname==='/dashboard'?'dashboard':'log');window.addEventListener('popstate',changed);return ()=>window.removeEventListener('popstate',changed);},[]);
 function goPage(next:'log'|'dashboard'|'assistant'){if(next==='assistant'&&page!=='assistant')assistantReturn.current=page as 'log'|'dashboard';setPage(next);history.pushState(null,'',next==='log'?'/':'/'+next);setSettings(false);window.scrollTo(0,0);}
 function openAssistant(opener:HTMLButtonElement){assistantOpener.current=opener;goPage('assistant');}
 function closeAssistant(){
  goPage(assistantReturn.current);requestAnimationFrame(()=>{
   const opener=assistantOpener.current;
   if(opener?.isConnected&&opener.offsetParent!==null)opener.focus({preventScroll:true});
   else Array.from(document.querySelectorAll<HTMLButtonElement>('.settings-launch')).find(button=>button.offsetParent!==null)?.focus({preventScroll:true});
  });
 }
 function openDashboardEntry(entry:Entry){if(diaryBusy)return;setDay(dayInput(entry.startAt));setEditing(entry);setEntryOpen(true);goPage('log');requestAnimationFrame(()=>document.getElementById('entry-form')?.scrollIntoView({block:'start'}));}
 const saved=(notice?:string,lastEdit?:Entry)=>{setLastEdit(lastEdit??null);setReviewUndo(false);setEditing(null);setEntryOpen(false);void refresh();setToast(notice?'Entry saved. '+notice:'Entry saved.');setToastDay(null);setError('');};
 function assistantSaved(proposal:Proposal){const result=proposalFeedback(proposal);goPage('log');setToast(result.message);setToastDay(result.day);void refresh();}
 async function toggleCare(key:keyof Care){
  if(carePending.current||!checksReady||!online)return;
  const task=careTasks.find(task=>task.key===key&&task.active);if(!task)return;
  const targetDay=day,original=care[key]??{done:false,version:0},done=!original.done,focused=document.activeElement;
  carePending.current=true;careTarget.current=targetDay;setCareBusy(true);setCareError(null);setCare(previous=>({...previous,[key]:{...original,done}}));
  try{
   const saved=await api<CareCheck>('/care/'+targetDay,json('PUT',{key,done,version:original.version,taskVersion:task.version}));
   if(currentDay.current===targetDay){
    if(currentChecks.current.ready){checksRequestId.current++;setCare(previous=>{const next={...previous,[key]:saved};careCache.current.set(targetDay,next);return next;});}
    else void refresh();
   }
   if(currentDay.current!==targetDay)careCache.current.delete(targetDay);
   setToast(`${task.label} ${done?'marked done':'cleared'} (${targetDay}).`);setToastDay(targetDay);
  }catch(e){
   setCareError({day:targetDay,message:(e as Error).message});
   if(currentDay.current===targetDay){
    if(currentChecks.current.ready)setCare(previous=>({...previous,[key]:original}));
    await refresh(true);
   }
  }finally{
   carePending.current=false;careTarget.current=null;setCareBusy(false);
   requestAnimationFrame(()=>{if(currentDay.current===targetDay&&document.activeElement===document.body&&focused instanceof HTMLElement&&focused.isConnected&&focused.offsetParent!==null)focused.focus({preventScroll:true});});
  }
 }
 async function endEntry(entry:Entry){
  if(endPending.current||entryBusy)return;endPending.current=true;setEnding(entry.id);setError('');
  let intent=endSaves.current.get(entry.id);
  if(!intent||intent.version!==entry.version){intent={key:crypto.randomUUID(),version:entry.version,entry:{...entry,endAt:new Date().toISOString(),status:'completed'}};endSaves.current.set(entry.id,intent);}
  try{const result=await saveEntryRequest(intent.key,intent.entry,entry.id);endSaves.current.delete(entry.id);setLastEdit(result);void refresh();setToast(result.sleepNotice?'Entry saved. '+result.sleepNotice:'Entry saved.');setToastDay(null);}
  catch(e){setError((e as Error).message);}finally{endPending.current=false;setEnding('');}
 }
 function shiftDay(amount:number){if(diaryBusy)return;const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+amount);setDay(d.toISOString().slice(0,10));}
 const today=dayInput(new Date(now).toISOString());
 const yesterdayDate=new Date(today+'T12:00:00Z');yesterdayDate.setUTCDate(yesterdayDate.getUTCDate()-1);
 const relativeDay=day===today?'Today':day===yesterdayDate.toISOString().slice(0,10)?'Yesterday':'';
 const entries=allEntries.filter(entry=>dayInput(entry.startAt)<=day&&dayInput(entry.endAt??(entry.status==='active'?new Date(now).toISOString():entry.startAt))>=day);
 const active=allEntries.filter(entry=>entry.status==='active');
 const shown=entries.filter(e=>filter==='all'||e.activity===filter);
 const displayedCareError=careError?.day===day?careError.message:checksError?.day===day?checksError.message:null;
 const displayedError=error||entryLoadError||taskLoadError;
 return <div className="app-shell">
  <aside className="rail">
   <a href="/" className="brand"><span className="brand-icon"><Icon name="diary" size={27}/></span><span>babylog<span className="brand-caption">Our daily diary</span></span></a>
   <nav aria-label="Main navigation"><button className={'nav-item nav-time '+(page==='log'?'selected':'')} disabled={diaryBusy} onClick={()=>goPage('log')}><Icon name="diary"/> Time log</button><button className={'nav-item nav-dashboard '+(page==='dashboard'?'selected':'')} disabled={diaryBusy} onClick={()=>goPage('dashboard')}><Icon name="patterns"/> Dashboard</button>{assistantConfig.assistantAvailable&&<button className={'nav-item nav-ask '+(page==='assistant'?'selected':'')} aria-current={page==='assistant'?'page':undefined} disabled={diaryBusy} onClick={event=>openAssistant(event.currentTarget)}><Icon name="chat"/> Assistant</button>}<button className="nav-item nav-settings settings-launch" disabled={diaryBusy} onClick={()=>setSettings(true)}><Icon name="settings"/> Settings</button></nav>
   <div className="rail-bottom"><span className={'connection '+(online?'':'offline')}></span>{online?'Shared household diary':'Connection lost'}<small>All times use Europe/Berlin.</small></div>
  </aside>
  <main>
   <nav className="mobile-pages" aria-label="Diary pages"><button aria-current={page==='log'?'page':undefined} disabled={diaryBusy} onClick={()=>goPage('log')}>Time log</button><button aria-current={page==='dashboard'?'page':undefined} disabled={diaryBusy} onClick={()=>goPage('dashboard')}>Dashboard</button>{assistantConfig.assistantAvailable&&<button aria-current={page==='assistant'?'page':undefined} disabled={diaryBusy} onClick={event=>openAssistant(event.currentTarget)}>Assistant</button>}<button className="settings-launch" disabled={diaryBusy} onClick={()=>setSettings(true)}>Settings</button></nav>
   {authenticated&&page==='assistant'&&assistantConfig.assistantAvailable&&<Assistant transcriptionAvailable={assistantConfig.transcriptionAvailable} day={day} entries={entries} onClose={closeAssistant} onSave={assistantSaved}/>}
   {page==='dashboard'&&<Suspense fallback={<p role="status">Loading the dashboard...</p>}><Dashboard entries={allEntries} loaded={loaded} online={online} onOpenEntry={openDashboardEntry} onLog={()=>{if(diaryBusy)return;goPage('log');setEntryOpen(true);}} onRetry={()=>void refresh()}/></Suspense>}
   <div hidden={visiblePage!=='log'}>
   <header className="page-heading"><h1>Our daily diary</h1></header>
   {displayedError&&<div className="notice error" role="alert">{displayedError}<button onClick={()=>{setError('');setEntryLoadError('');setTaskLoadError('');}} aria-label="Dismiss error"><Icon name="close" size={18}/></button></div>}
   {!online&&<div className="notice">Offline. Reconnect to save.</div>}
   <CareNow entries={allEntries} loaded={loaded} online={online} now={now}/>
   <section className="day-bar" aria-label="Diary date"><div className="date-controls"><button className="icon-button previous" aria-label="Previous day" disabled={diaryBusy} onClick={()=>shiftDay(-1)}><Icon name="arrow" size={18}/></button><label className="date-selector"><strong>{dateLabel(day)}</strong>{relativeDay&&<span className="relative-day">{relativeDay}</span>}<input type="date" value={day} aria-label="Diary date" disabled={diaryBusy} onChange={e=>{if(e.target.value)setDay(e.target.value);}}/></label><button className="icon-button" aria-label="Next day" disabled={diaryBusy} onClick={()=>shiftDay(1)}><Icon name="arrow" size={18}/></button>{day!==today&&<button className="quiet go-today" disabled={diaryBusy} onClick={()=>setDay(dayInput())}>Go to today</button>}</div><fieldset className="daily-checks" aria-label={'Daily checks for '+day} disabled={careBusy||!checksReady||!online} aria-busy={careBusy||(!checksReady&&online)}><legend>Daily checks</legend><div className="daily-check-grid">{careTasks.filter(task=>task.active).map(task=><label key={task.key}><input type="checkbox" checked={displayedCare[task.key]?.done??false} onChange={()=>void toggleCare(task.key)}/><span>{task.label}</span></label>)}{checksReady&&!careTasks.some(task=>task.active)&&<span>Add daily tasks in Settings.</span>}</div><p className="daily-check-status" role="status">{careBusy&&<Icon name="spinner" size={14}/>}{careBusy?'Saving daily check for '+careTarget.current+'...':!online?'Offline. Reconnect to save checks.':!tasksReady?(taskLoadError?'Daily tasks are unavailable.':'Loading daily tasks...'):!checksReady?(checksError?.day===day?'Daily checks are unavailable.':'Loading daily checks...'):''}</p></fieldset>{displayedCareError&&<p className="daily-check-error" role="alert">{displayedCareError}</p>}</section>
   {active.length>0&&<section className="active-list" aria-label="Active timers">{active.map(e=><div className={'active-record '+e.activity} key={e.id}><Icon name={e.activity==='sleep'?'sleep':'feed'}/><div><strong>{entryLabel(e)} in progress</strong><span>Started {when(e.startAt)}</span></div><button disabled={diaryBusy} aria-busy={ending===e.id} onClick={()=>void endEntry(e)}>{ending===e.id&&<Icon name="spinner" size={18}/>}End now</button><button className="icon-button" aria-label={'Edit active '+entryLabel(e)} disabled={diaryBusy} onClick={()=>setEditing(e)}><Icon name="edit" size={18}/></button></div>)}</section>}
   <div className={'workspace '+(entryOpen?'':'entry-collapsed')}><EntryForm blocked={!!ending} onBusyChange={setEntryBusy} entries={allEntries} day={day} editing={editing} reviewUndo={reviewUndo} open={entryOpen} onToggle={()=>setEntryOpen(value=>!value)} onSave={saved} onCancel={()=>{setEditing(null);setEntryOpen(false);}}/>
    <section className="log-panel"><div className="section-title"><div><h2>Time log</h2><p>{entries.length} {entries.length===1?'entry':'entries'}</p></div><label className="filter-label"><span className="sr-only">Filter activities</span><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All activities</option>{['feeding','sleep','nappy','bath','note',...new Set(entries.map(e=>e.activity).filter(a=>!Object.hasOwn(names,a)))].map(a=><option value={a} key={a}>{label(a)}</option>)}</select></label></div><div className="log-counts" aria-label="Daily findings"><span>Pee <strong>{loaded?entries.filter(e=>dayInput(e.startAt)===day&&e.pee).length:'-'}</strong></span><span>Poo <strong>{loaded?entries.filter(e=>dayInput(e.startAt)===day&&e.poo).length:'-'}</strong></span></div>
     {!loaded?<div className="empty-state">{online?'Loading the shared diary...':'The shared diary is unavailable.'}{!online&&<button onClick={()=>void refresh()}>Try again</button>}</div>:shown.length===0?<div className="empty-state"><span className="empty-icon"><Icon name="diary" size={35}/></span><h3>{entries.length?'No matching entries':'No entries yet'}</h3><button className="quiet" onClick={()=>setEntryOpen(true)}>Add entry</button></div>:<div className="timeline">{shown.map(e=><article key={e.id} className="timeline-entry"><div className={'event-icon '+(Object.hasOwn(names,e.activity)?e.activity:'note')}><Icon name={e.activity==='feeding'?'feed':e.activity}/></div><div className="event-content"><div className="event-top"><strong>{entryLabel(e)}</strong><span className="event-time">{time(e.startAt)}{e.endAt?' - '+time(e.endAt)+(dayInput(e.endAt)!==dayInput(e.startAt)?' ('+dayInput(e.endAt)+')':''):e.status==='active'?' - running':''}</span></div>{(e.pee||e.poo||e.temperature!==null)&&<div className="event-findings">{e.pee&&<span>Pee</span>}{e.poo&&<span>Poo</span>}{e.temperature!==null&&<span>{e.temperature} C</span>}</div>}<EntryNotes notes={e.notes}/></div><button className="icon-button" aria-label={'Edit '+entryLabel(e)+' at '+time(e.startAt)} disabled={diaryBusy} onClick={()=>{setEditing(e);setEntryOpen(true);document.getElementById('entry-form')?.scrollIntoView({behavior:'smooth',block:'start'});}}><Icon name="edit" size={18}/></button></article>)}</div>}
    </section>
   </div>
   </div>
  </main>
  {authenticated&&settings&&<Modal title="Settings" onClose={()=>setSettings(false)}><Settings user={user} onLogout={onLogout} assistantAvailable={assistantConfig.assistantAvailable} onAssistant={openAssistant} onChanged={()=>void refresh()}/></Modal>}
  <div className={toast?'toast':'sr-only'} role="status" aria-live="polite" aria-atomic="true">{toast&&<><Icon name="check" size={18}/><span>{toast}</span>{lastEdit&&<button disabled={diaryBusy} onClick={()=>{setEditing(lastEdit);setReviewUndo(true);setEntryOpen(true);goPage('log');setToast('');document.getElementById('entry-form')?.scrollIntoView({block:'start'});}}>Undo last edit</button>}{toastDay&&<button disabled={diaryBusy} onClick={()=>{setDay(toastDay);goPage('log');setToast('');document.querySelector('.log-panel')?.scrollIntoView({block:'start'});}}>View day</button>}<button aria-label="Dismiss confirmation" onClick={()=>setToast('')}>Close</button></>}</div>
 </div>;
}

function CareNow({entries,loaded,online,now}:{entries:Entry[];loaded:boolean;online:boolean;now:number}){
 return <section className="care-now" aria-label="Latest Care"><header><h2>Latest Care</h2>{!online&&<span className="care-offline" role="status"><Icon name="offline" size={16}/>Offline</span>}</header><div className="care-now-grid">{['feeding','nappy'].map(activity=>{
  const name=activity==='feeding'?'Feeding':'Nappy',latest=latestCareStart(entries,activity,now);
  const elapsed=!loaded?(online?'Loading...':'Unavailable'):latest?elapsedCareTime(latest.startAt,now)+' ago':'No record';
  return <div key={activity} className="care-now-item"><div className="care-now-label"><h3><Icon name={activity==='feeding'?'feed':'nappy'} size={19}/>{name}</h3></div>
   {latest&&loaded?<details className="care-details"><summary aria-label={`${name}: ${elapsed}. Show details`}><span className="care-elapsed">{elapsed}</span><Icon name="chevron" size={14}/></summary><div><p>Started {when(latest.startAt)}</p></div></details>:<p className="care-elapsed">{elapsed}</p>}
  </div>;
 })}</div></section>;
}

function EntryForm({blocked,onBusyChange,entries,day,editing,reviewUndo,open,onToggle,onSave,onCancel}:{blocked:boolean;onBusyChange:(busy:boolean)=>void;entries:Entry[];day:string;editing:Entry|null;reviewUndo:boolean;open:boolean;onToggle:()=>void;onSave:(notice?:string,lastEdit?:Entry)=>void;onCancel:()=>void}){
 const heading=useRef<HTMLHeadingElement>(null);
 const entryPanel=useRef<HTMLElement>(null),startPicker=useRef<EntryTimeHandle>(null),endPicker=useRef<EntryTimeHandle>(null);
 useEffect(()=>{
  if(!open)return;const viewport=window.visualViewport,panel=entryPanel.current;let frame=0;
  const update=(reveal=false)=>{
   const inset=Math.max(0,innerHeight-(viewport?.height??innerHeight)-(viewport?.offsetTop??0));panel?.style.setProperty('--entry-keyboard',inset+'px');
   if(!reveal||!inset)return;cancelAnimationFrame(frame);
   frame=requestAnimationFrame(()=>{
    const active=document.activeElement;if(!(active instanceof HTMLElement)||!panel?.contains(active)||!active.matches('input,textarea,select'))return;
    const rect=active.getBoundingClientRect(),top=(viewport?.offsetTop??0)+12,bottom=(viewport?.offsetTop??0)+(viewport?.height??innerHeight)-(panel.querySelector('.entry-save-footer')?.getBoundingClientRect().height??0)-12;
    if(rect.height>bottom-top)return;
    if(rect.bottom>bottom+2)window.scrollBy({top:rect.bottom-bottom,behavior:'instant'});else if(rect.top<top-2)window.scrollBy({top:rect.top-top,behavior:'instant'});
   });
  };
  const resize=()=>update(true),scroll=()=>update();update();viewport?.addEventListener('resize',resize);viewport?.addEventListener('scroll',scroll);panel?.addEventListener('focusin',resize);
  return ()=>{cancelAnimationFrame(frame);viewport?.removeEventListener('resize',resize);viewport?.removeEventListener('scroll',scroll);panel?.removeEventListener('focusin',resize);};
 },[open]);
 const [formError,setFormError]=useState('');
 const [fieldError,setFieldError]=useState<{field:'side'|'activity'|'subtype';message:string}|null>(null);
 const sideInput=useRef<HTMLSelectElement>(null),activityInput=useRef<HTMLInputElement>(null),subtypeInput=useRef<HTMLInputElement>(null);
 useEffect(()=>{
  if(!fieldError)return;
  const input=fieldError.field==='side'?sideInput.current:fieldError.field==='activity'?activityInput.current:subtypeInput.current;
  input?.focus();input?.scrollIntoView({block:'center',behavior:'instant'});
 },[fieldError]);
 function clearFieldError(){setFieldError(null);}
 const [undo,setUndo]=useState<EntryUndo|null>(null),[undoError,setUndoError]=useState('');
 useEffect(()=>{
  setUndo(null);setUndoError('');if(!editing)return;let active=true;
  void api<{undo:EntryUndo|null}>('/entries/'+editing.id+'/undo').then(result=>{if(active)setUndo(result.undo);}).catch(error=>{if(active)setUndoError((error as Error).message);});
  return ()=>{active=false;};
 },[editing]);
 useEffect(()=>{if(open)heading.current?.focus({preventScroll:true});},[open,editing]);
 const [activity,setActivity]=useState('feeding');
 const [feedingType,setFeedingType]=useState('Breast'),[customFeedingType,setCustomFeedingType]=useState('');
 const [breastSide,setBreastSide]=useState('');
 const [custom,setCustom]=useState('');
 const [start,setStart]=useState('');
 const [end,setEnd]=useState('');
 const progressToggle=useRef<HTMLInputElement>(null);
 const [quickEndAt,setQuickEndAt]=useState<string>();
 const [quickStartAt,setQuickStartAt]=useState<string>();
 const [timeHelper,setTimeHelper]=useState<'start'|'end'|null>(null);
 const running=['feeding','sleep'].includes(activity)&&!end;
 const lastEnd=lastActivityEnd(entries,editing?.id);
 const [pee,setPee]=useState(false);const [poo,setPoo]=useState(false);
 const [temperature,setTemperature]=useState('');const [temperatureError,setTemperatureError]=useState('');const temperatureInput=useRef<HTMLInputElement>(null);const [notes,setNotes]=useState('');
 const [action,setAction]=useState('');const busy=!!action||blocked;const saveKey=useRef<string|null>(null),pending=useRef(false);const [deletePrompt,setDeletePrompt]=useState(false);
 const previousDay=useRef(day);
 const reset=useCallback(()=>{
  saveKey.current=null;setActivity('feeding');setFeedingType('Breast');setBreastSide('');setCustomFeedingType('');setCustom('');setStart(day+'T'+dateTimeInput(new Date().toISOString()).slice(11));setEnd('');setQuickEndAt(undefined);setQuickStartAt(undefined);setTimeHelper(null);setPee(false);setPoo(false);setTemperature('');setNotes('');setDeletePrompt(false);
 },[day]);
 useEffect(()=>{
  saveKey.current=null;setFormError('');setFieldError(null);setTemperatureError('');setQuickEndAt(undefined);setQuickStartAt(undefined);setTimeHelper(null);
  if(editing){setBreastSide(editing.breastSide??'');setFeedingType(editing.feedingType?(feedingTypes.includes(editing.feedingType)?editing.feedingType:'custom'):'');setCustomFeedingType(editing.feedingType&&!feedingTypes.includes(editing.feedingType)?editing.feedingType:'');setActivity(Object.hasOwn(names,editing.activity)?editing.activity:'custom');setCustom(Object.hasOwn(names,editing.activity)?'':editing.activity);setStart(dateTimeInput(editing.startAt));setEnd(editing.endAt?dateTimeInput(editing.endAt):'');setPee(editing.pee);setPoo(editing.poo);setTemperature(editing.temperature===null?'':String(editing.temperature));setNotes(editing.notes);setDeletePrompt(false);}
  else reset();
 },[editing]);
 useEffect(()=>{if(day!==previousDay.current&&!editing){setStart(s=>day+'T'+(s.slice(11)||'12:00'));if(end)setEnd(e=>day+'T'+e.slice(11));setQuickStartAt(undefined);setQuickEndAt(undefined);}previousDay.current=day;},[day]);
 function choose(value:string){if(value!==activity)clearFieldError();setActivity(value);}
 async function save(e:React.FormEvent){
  e.preventDefault();if(pending.current||blocked)return;setFormError('');setFieldError(null);setTemperatureError('');
  const startValue=startPicker.current?.value()??start,endValue=endPicker.current?.value()??end;
  if(startValue!==start){setStart(startValue);setQuickStartAt(undefined);setTimeHelper(null);}
  if(endValue!==end){setEnd(endValue);setQuickEndAt(undefined);setTimeHelper(null);}
  if(activity==='feeding'&&feedingType==='Breast'&&!breastSide){setFieldError({field:'side',message:'Choose Left, Right, or Both before saving.'});return;}
  if(activity==='custom'&&!custom.trim()){setFieldError({field:'activity',message:'Enter an activity name.'});return;}
  if(activity==='feeding'&&feedingType==='custom'&&!customFeedingType.trim()){setFieldError({field:'subtype',message:'Enter a subtype name.'});return;}
  let parsedTemperature:number|null;
  try{parsedTemperature=parseTemperature(temperature);}catch(error){setTemperatureError((error as Error).message);temperatureInput.current?.focus();return;}
  pending.current=true;onBusyChange(true);setAction('save');
  try{
   const data={breastSide:activity==='feeding'&&feedingType==='Breast'?(breastSide||null):null,activity:activity==='custom'?custom.trim():activity,feedingType:activity==='feeding'?(feedingType==='custom'?customFeedingType.trim():feedingType||null):null,startAt:inputToIso(startValue,undefined,startValue===start?quickStartAt??editing?.startAt:undefined),endAt:endValue&&!running?inputToIso(endValue,undefined,endValue===end?quickEndAt??editing?.endAt??undefined:undefined):null,status:running?'active':'completed',pee,poo,temperature:parsedTemperature,notes,...(editing?{version:editing.version}:{})};
   saveKey.current??=crypto.randomUUID();
   const result=await saveEntryRequest(saveKey.current,data,editing?.id);reset();onSave(result.sleepNotice,editing?result:undefined);
  }catch(error){setFormError((error as Error).message);}finally{pending.current=false;onBusyChange(false);setAction('');}
 }
 async function restore(){
  if(!editing||!undo||pending.current||blocked)return;pending.current=true;onBusyChange(true);setAction('restore');setFormError('');setFieldError(null);
  try{await api('/entries/'+editing.id+'/undo',json('POST',{undoId:undo.id}));reset();onSave('Previous entry restored.');}
  catch(error){setFormError((error as Error).message);}finally{pending.current=false;onBusyChange(false);setAction('');}
 }
 async function remove(){
  if(!editing||pending.current||blocked)return;pending.current=true;onBusyChange(true);setAction('delete');setFormError('');setFieldError(null);
  try{await api('/entries/'+editing.id,json('DELETE',{version:editing.version}));reset();onSave();}
  catch(error){setFormError((error as Error).message);}finally{pending.current=false;onBusyChange(false);setAction('');}
 }
 return <section ref={entryPanel} className={'entry-panel '+(open?'is-expanded':'is-collapsed')} id="entry-form"><div className="section-title"><h2 ref={heading} tabIndex={-1} aria-label={editing?'Edit entry':'Add an entry'}><button type="button" id="entry-toggle" aria-label={open?'Hide entry form':editing?'Show entry form':'Add an entry'} aria-expanded={open} aria-controls="manual-entry" disabled={busy} onClick={onToggle}><Icon name={editing?'edit':'plus'} size={19}/><span>{editing?'Edit entry':'Add an entry'}</span><span className="entry-chevron"><Icon name="chevron" size={18}/></span></button></h2>{editing&&<button className="icon-button" aria-label="Cancel edit" disabled={busy} onClick={onCancel}><Icon name="close"/></button>}</div><form id="manual-entry" hidden={!open} noValidate onSubmit={e=>void save(e)}>
  {editing&&undo&&<details className="entry-undo" key={undo.id} open={reviewUndo||undefined}><summary>Undo last edit</summary><p>Restore the previous entry. This discards unsaved changes.</p>{undo.sleepChanges>0&&<p>Restore also reverses {undo.sleepChanges} automatic sleep {undo.sleepChanges===1?'change':'changes'}.</p>}<ul>{undo.changes.map((op,index)=><OperationPreview key={index} op={op} entries={undo.targets}/>)}</ul><button type="button" disabled={busy} aria-busy={action==='restore'} onClick={()=>void restore()}><Icon name={action==='restore'?'spinner':'undo'} size={18}/>Restore previous entry</button></details>}
  {editing&&undoError&&<p role="alert">Undo could not load. {undoError}</p>}
  <fieldset className="entry-fields" disabled={busy}><fieldset className="activity-choices"><legend className="sr-only">Activity</legend>{[{value:'feeding',icon:'feed'},{value:'sleep',icon:'sleep'},{value:'nappy',icon:'nappy'},{value:'bath',icon:'bath'},{value:'custom',icon:'plus'}].map(a=><button key={a.value} type="button" aria-pressed={activity===a.value} className={'activity-button '+a.value+(activity===a.value?' chosen':'')} onClick={()=>choose(a.value)}><Icon name={a.icon}/><span>{a.value==='custom'?'Other':label(a.value)}</span></button>)}</fieldset>
  {activity==='feeding'&&<><label className="field">Feeding subtype<select value={feedingType} onChange={event=>{setFeedingType(event.target.value);clearFieldError();}}><option value="">Not recorded</option>{feedingTypes.map(type=><option key={type} value={type}>{type}</option>)}<option value="custom">Other</option></select></label>{feedingType==='custom'&&<label className="field">Subtype name<input ref={subtypeInput} aria-label="Subtype name" required maxLength={80} aria-invalid={fieldError?.field==='subtype'} aria-describedby={fieldError?.field==='subtype'?'subtype-error':undefined} value={customFeedingType} onChange={event=>{setCustomFeedingType(event.target.value);if(event.target.value.trim())clearFieldError();}}/>{fieldError?.field==='subtype'&&<span className="input-error" id="subtype-error">{fieldError.message}</span>}</label>}</>}
  {activity==='feeding'&&feedingType==='Breast'&&<label className="field">Breast side<select ref={sideInput} aria-label="Breast side" required aria-invalid={fieldError?.field==='side'} aria-describedby={fieldError?.field==='side'?'breast-side-error':undefined} value={breastSide} onChange={event=>{setBreastSide(event.target.value);if(event.target.value)clearFieldError();}}><option value="">Choose a side</option><option value="left">Left</option><option value="right">Right</option><option value="both">Both (equal time)</option></select>{fieldError?.field==='side'&&<span className="input-error" id="breast-side-error">{fieldError.message}</span>}</label>}
  {activity==='custom'&&<label className="field">Activity name<input ref={activityInput} aria-label="Activity name" value={custom} required maxLength={80} aria-invalid={fieldError?.field==='activity'} aria-describedby={fieldError?.field==='activity'?'activity-error':undefined} placeholder="For example: walk" onChange={e=>{setCustom(e.target.value);if(e.target.value.trim())clearFieldError();}}/>{fieldError?.field==='activity'&&<span className="input-error" id="activity-error">{fieldError.message}</span>}</label>}
  <div className="field time-field"><EntryTime key={editing?.id??'new'} collapsed={!!editing} ref={startPicker} field="start" value={start} visible={open} busy={busy} onChange={value=>{setStart(value);setQuickStartAt(undefined);setTimeHelper(null);}} onAdd={()=>{const time=timeAgo(0);setStart(time.local);setQuickStartAt(time.iso);setTimeHelper(null);}}><TimeShortcuts field="start" lastEnd={lastEnd} anchor={end} originalAnchor={quickEndAt??editing?.endAt??undefined} open={timeHelper==='start'} onToggle={()=>setTimeHelper(value=>value==='start'?null:'start')} onSet={time=>{setStart(time.local);setQuickStartAt(time.iso);}} busy={busy}/></EntryTime></div>

  {['feeding','sleep'].includes(activity)&&<label className="check-field progress-toggle"><input ref={progressToggle} aria-controls="end-time-editor" type="checkbox" checked={running} disabled={busy} onChange={event=>{if(event.target.checked){setEnd('');setQuickEndAt(undefined);}else{try{const time=shiftedTime(0,start,quickStartAt??editing?.startAt);setEnd(time.local);setQuickEndAt(time.iso);}catch{setFormError('Enter a start time first.');}}setTimeHelper(null);}}/><span>Still in progress</span></label>}<div className="field time-field" id="end-time-editor" hidden={running}><EntryTime ref={endPicker} field="end" value={end} visible={open&&!running} busy={busy} onChange={value=>{setEnd(value);setQuickEndAt(undefined);setTimeHelper(null);if(!value&&['feeding','sleep'].includes(activity))requestAnimationFrame(()=>progressToggle.current?.focus({preventScroll:true}));}} onAdd={()=>{try{const time=shiftedTime(0,start,quickStartAt??editing?.startAt);setEnd(time.local);setQuickEndAt(time.iso);setTimeHelper(null);}catch{setFormError('Enter a start time first.');}}}><TimeShortcuts field="end" anchor={start} originalAnchor={quickStartAt??editing?.startAt} open={timeHelper==='end'} onToggle={()=>setTimeHelper(value=>value==='end'?null:'end')} onSet={time=>{setEnd(time.local);setQuickEndAt(time.iso);}} busy={busy}/></EntryTime></div>
  <div className="findings-row"><fieldset className="findings"><legend>Nappy findings</legend><label><input type="checkbox" checked={pee} onChange={e=>setPee(e.target.checked)}/>Pee</label><label><input type="checkbox" checked={poo} onChange={e=>setPoo(e.target.checked)}/>Poo</label></fieldset><label className="field temperature">Temperature <span className="optional">C</span><input ref={temperatureInput} type="text" inputMode="decimal" autoComplete="off" aria-label="Temperature" aria-invalid={!!temperatureError} aria-describedby={temperatureError?'temperature-error':undefined} value={temperature} placeholder="Optional" onChange={e=>{setTemperature(e.target.value);setTemperatureError('');}}/>{temperatureError&&<span className="input-error" id="temperature-error" role="alert">{temperatureError}</span>}</label></div>
  <label className="field">Notes <span className="optional">optional</span><textarea rows={3} value={notes} maxLength={5000} placeholder="Optional notes" onChange={e=>setNotes(e.target.value)}/></label>
  </fieldset>
  {editing&&<div className="edit-actions">{deletePrompt?<><span>Delete this entry?</span><button type="button" className="danger" disabled={busy} aria-busy={action==='delete'} onClick={()=>void remove()}>{action==='delete'&&<Icon name="spinner" size={18}/>}Delete entry</button><button type="button" className="quiet" disabled={busy} onClick={()=>setDeletePrompt(false)}>Keep entry</button></>:<button className="danger quiet" type="button" disabled={busy} onClick={()=>setDeletePrompt(true)}>Delete entry</button>}</div>}
  <div className="entry-save-footer">{(fieldError||formError)&&<div className="notice error" role="alert">{fieldError?.message??formError}</div>}<button className="primary save-button" disabled={busy} aria-busy={action==='save'} type="submit"><Icon name={action==='save'?'spinner':editing?'check':'plus'} size={20}/>{action==='save'?'Saving...':editing?'Save changes':'Save entry'}</button></div>
 </form></section>;
}

function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const element=dialog.current;const previous=document.activeElement as HTMLElement|null;element?.showModal();return ()=>{element?.close();if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
 return <dialog ref={dialog} aria-labelledby="dialog-title" className="drawer" onCancel={e=>{e.preventDefault();onClose();}}><header><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close"/></button></header>{children}</dialog>;
}
function OperationPreview({op,entries}:{op:Operation;entries:Entry[]}){
 if(op.type==='set_care')return <li><strong>{op.taskLabel??careLabels[op.key]??'Daily task'}</strong><p>{op.day}: {op.done?'Mark complete':'Mark incomplete'}</p></li>;
 const old='id'in op?entries.find(e=>e.id===op.id):undefined;
 const details=(e:Entry)=><><p>{when(e.startAt)}{e.endAt?' to '+when(e.endAt):e.status==='active'?' (in progress)':''}</p><p>{e.pee?'Pee. ':''}{e.poo?'Poo. ':''}{e.temperature!==null?`${e.temperature} C. `:''}</p><EntryNotes notes={e.notes}/></>;
 if(op.type==='delete_entry')return <li className="delete-preview"><strong>Delete {old?entryLabel(old):'entry'}</strong>{old?details(old):<p>{op.id}</p>}</li>;
 const e=op.entry;
 return <li><strong>{op.type==='create_entry'?'Add':'Update'} {entryLabel(e)}</strong>{op.type==='update_entry'&&old&&<div className="proposal-before"><strong>Current: {entryLabel(old)}</strong>{details(old)}<strong>Proposed:</strong></div>}<p>{when(e.startAt)}{e.endAt?' to '+when(e.endAt):e.status==='active'?' (in progress)':''}</p><p>{e.pee?'Pee. ':''}{e.poo?'Poo. ':''}{e.temperature!==null?`${e.temperature} C. `:''}</p><EntryNotes notes={e.notes}/></li>;
}
function Assistant({day,entries,onClose,onSave,transcriptionAvailable}:{transcriptionAvailable:boolean;day:string;entries:Entry[];onClose:()=>void;onSave:(proposal:Proposal)=>void}){
 const instructionInput=useRef<HTMLTextAreaElement>(null);const recordButton=useRef<HTMLButtonElement>(null);const proposalHeading=useRef<HTMLHeadingElement>(null);const transcriptHeading=useRef<HTMLHeadingElement>(null);
 const [pendingInstruction,setPendingInstruction]=useState('');
 const pendingStatus=useRef<HTMLDivElement>(null),latestReply=useRef<HTMLDivElement>(null);
 useEffect(()=>{(recordButton.current??instructionInput.current)?.focus({preventScroll:true});},[]);
 const [command,setCommand]=useState('');const [reply,setReply]=useState('');const [proposal,setProposal]=useState<Proposal|null>(null);
 const recordingTarget=useRef<'command'|'reply'>('command');
 const [conversation,setConversation]=useState<ConversationTurn[]>([]);const [followUp,setFollowUp]=useState('');
 const [busy,setBusy]=useState('');const [error,setError]=useState('');const [recording,setRecording]=useState(false);
 const focusReply=useRef(false);
 useLayoutEffect(()=>{if(!busy&&focusReply.current){focusReply.current=false;(proposalHeading.current??recordButton.current??instructionInput.current)?.focus({preventScroll:true});}},[busy]);
 useEffect(()=>{
  if(!pendingInstruction&&(!conversation.length||error))return;
  const frame=requestAnimationFrame(()=>{
   const target=pendingInstruction?pendingStatus.current:proposal?proposalHeading.current:latestReply.current;
   target?.scrollIntoView({block:'nearest',behavior:'instant'});
  });
  return ()=>cancelAnimationFrame(frame);
 },[pendingInstruction,conversation.length,proposal?.id,error]);
 const [recordedUrl,setRecordedUrl]=useState('');const [speechDebug,setSpeechDebug]=useState('');const recordedBlob=useRef<Blob|null>(null);const recordedInfo=useRef({durationMs:0,chunks:0,mimeType:''});const recordingUrl=useRef('');
 const [seconds,setSeconds]=useState(0);const [transcript,setTranscript]=useState<string|null>(null);
 const [micSignal,setMicSignal]=useState(false);const lastMicSignal=useRef(0);const playback=useRef<HTMLAudioElement>(null);
 const microphoneContext=useRef<AudioContext|null>(null);
 useEffect(()=>{if(transcript!==null)transcriptHeading.current?.focus({preventScroll:true});},[transcript]);
 useLayoutEffect(()=>{
  const resize=()=>{
   const field=instructionInput.current;if(!field)return;
   const scroll=field.scrollTop;
   field.style.height='auto';field.style.height=field.scrollHeight+'px';field.scrollTop=scroll;
  };
  resize();window.addEventListener('resize',resize);
  return ()=>window.removeEventListener('resize',resize);
 },[command,followUp,proposal,conversation.length]);
 const mounted=useRef(true);const permissionPending=useRef(false);const transcription=useRef<AbortController|null>(null);
 useEffect(()=>{if(!recording)return;const start=Date.now();setSeconds(0);const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-start)/1000)),1000);return ()=>clearInterval(timer);},[recording]);
 const recorder=useRef<PcmRecording|null>(null);const stream=useRef<MediaStream|null>(null);
 useEffect(()=>()=>{mounted.current=false;transcription.current?.abort();recorder.current?.cancel();void microphoneContext.current?.close().catch(()=>{});stream.current?.getTracks().forEach(t=>t.stop());if(recordingUrl.current)URL.revokeObjectURL(recordingUrl.current);},[]);
 async function ask(text=command,history:ConversationTurn[]=[]){
  if(!text.trim()||busy||recording||transcript!==null)return;
  const historyError=assistantConversationError(text,day,history);if(historyError){setError(historyError);return;}
  setPendingInstruction(text);if(history.length)setFollowUp('');else setCommand('');setBusy('Preparing changes...');setError('');if(!history.length)setReply('');
  try{
   if(proposal)await api('/proposals/'+proposal.id+'/reject',json('POST',{}));setProposal(null);
   const result=await api<AssistantReply>('/assistant',json('POST',{command:text,day,conversation:history}));
   if(!mounted.current)return;setReply(result.message);setProposal(result.proposal);setFollowUp('');
   setConversation([...history,{command:text,reply:result.message,at:result.interpretedAt??new Date().toISOString()}]);
  }catch(e){if(mounted.current){setError((e as Error).message);if(history.length)setFollowUp(text);else setCommand(text);}}finally{if(mounted.current){focusReply.current=true;setBusy('');setPendingInstruction('');}}
 }
 async function confirm(){if(!proposal||busy)return;setBusy('Saving...');setError('');try{await api('/proposals/'+proposal.id+'/confirm',json('POST',{}));onSave(proposal);}catch(e){setError((e as Error).message);}finally{setBusy('');}}
 async function cancel(){if(!proposal||busy)return;setBusy('Cancelling...');setError('');try{await api('/proposals/'+proposal.id+'/reject',json('POST',{}));setProposal(null);setFollowUp('');setReply('Changes cancelled. Tell me what to change.');setConversation(turns=>turns.map((turn,index)=>index===turns.length-1?{...turn,reply:turn.reply+' Changes cancelled. Nothing is saved. Tell me what to change.'}:turn));requestAnimationFrame(()=>(recordButton.current??instructionInput.current)?.focus({preventScroll:true}));}catch(e){setError((e as Error).message);}finally{setBusy('');}}
 async function transcribeRecording(){
  if(!recordedBlob.current)return;if(recordingTarget.current==='command'){setConversation([]);setFollowUp('');setReply('');}setSpeechDebug('');setProposal(null);setTranscript(null);setBusy('Transcribing...');setError('');
  try{
   const form=new FormData();form.append('audio',recordedBlob.current,'command.audio');
   for(const [key,value] of Object.entries(recordedInfo.current))form.append(key,String(value));
   transcription.current=new AbortController();
   const data=await api<{text:string;diagnostics?:{diagnosticId:string;durationSeconds:number}}>('/transcribe',{method:'POST',body:form,signal:transcription.current.signal});
   if(!mounted.current)return;
   if(recordingTarget.current==='reply'){if(followUp.trim())setTranscript(data.text);else setFollowUp(data.text);}else if(command.trim())setTranscript(data.text);else setCommand(data.text);
   setSpeechDebug(data.diagnostics?`Audio: ${data.diagnostics.durationSeconds.toFixed(1)} seconds. Debug ID: ${data.diagnostics.diagnosticId}`:'');
  }catch(e){if(mounted.current)setError((e as Error).message);}finally{if(mounted.current){setBusy('');requestAnimationFrame(()=>(transcriptHeading.current??recordButton.current)?.focus({preventScroll:true}));}}
 }
 async function record(target:'command'|'reply'='command'){
  if(recording){setBusy('Finishing recording...');recorder.current?.stop();return;}
  if(permissionPending.current||busy)return;
  if(!navigator.mediaDevices?.getUserMedia){setError('Microphone access needs HTTPS. You can still type a command.');return;}
  permissionPending.current=true;setBusy('Opening microphone...');
  try{
   playback.current?.pause();setError('');setSpeechDebug('');setTranscript(null);setProposal(null);if(target==='command')setReply('');
   const context=new AudioContext();microphoneContext.current=context;void context.resume().catch(()=>{});
   const captured=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   stream.current=captured;
   if(!mounted.current){captured.getTracks().forEach(track=>track.stop());return;}
   const r=new PcmRecording(captured,context);recorder.current=r;lastMicSignal.current=0;setMicSignal(false);
   r.onlevel=active=>{if(active)lastMicSignal.current=performance.now();if(mounted.current)setMicSignal(performance.now()-lastMicSignal.current<1000&&lastMicSignal.current>0);};
   r.onstop=async(blob,info,captureError)=>{
    if(!mounted.current||recorder.current!==r)return;setRecording(false);setBusy('');
    recordingTarget.current=target;recordedBlob.current=blob;recordedInfo.current=info;
    if(recordingUrl.current)URL.revokeObjectURL(recordingUrl.current);
    recordingUrl.current=URL.createObjectURL(recordedBlob.current);setRecordedUrl(recordingUrl.current);
    if(captureError){setSpeechDebug(`Audio: ${(info.frames/info.sampleRate).toFixed(1)} seconds. Signal: ${(info.signalMs/1000).toFixed(1)} seconds.`);setError(captureError);return;}
    await transcribeRecording();
   };
   await r.start();if(!mounted.current){r.cancel();return;}setRecording(true);
  }catch(e){recorder.current?.cancel();void microphoneContext.current?.close().catch(()=>{});stream.current?.getTracks().forEach(t=>t.stop());if(mounted.current){setRecording(false);setError(e instanceof Error&&/^(No microphone audio|The microphone|Microphone startup)/.test(e.message)?e.message:'Microphone unavailable. Type a command or try again.');}}
  finally{permissionPending.current=false;if(mounted.current)setBusy('');}
 }
 function newInstruction(){
  setCommand('');setReply('');setConversation([]);setFollowUp('');setTranscript(null);setError('');setRecordedUrl('');setSpeechDebug('');recordedBlob.current=null;
  if(recordingUrl.current){URL.revokeObjectURL(recordingUrl.current);recordingUrl.current='';}
  requestAnimationFrame(()=>(recordButton.current??instructionInput.current)?.focus({preventScroll:true}));
 }
 const answering=conversation.length>0&&!proposal;
 const working=busy&&<div role="status" className="working" ref={pendingStatus} aria-live="polite"><span aria-hidden="true"></span><div><strong>{busy}</strong>{busy==='Transcribing...'&&<p>Converting your recording to text. Please wait.</p>}</div></div>;
 return <section className="assistant-page" aria-label="Assistant">
  <header className="page-heading"><h1>Assistant</h1><div>{conversation.length>0&&!proposal&&<button disabled={!!busy||recording} onClick={newInstruction}>New instruction</button>}<button onClick={onClose} aria-label="Close Assistant">Back to diary</button></div></header>
  <div className="assistant-chat">
   {!conversation.length&&!pendingInstruction&&!command&&!followUp&&!recordedUrl&&<div className="assistant-welcome"><Icon name="mic" size={32}/><h2>What would you like to record?</h2><p>Describe one or more care actions. Review the changes before saving.</p></div>}
   <div className="chat-messages" role="log" aria-label="Conversation" aria-live="polite">
    {conversation.map((turn,index)=><React.Fragment key={index}><div className="chat-message from-user"><span className="sr-only">You: </span><p>{turn.command}</p></div>{(!proposal||index<conversation.length-1)&&<div ref={index===conversation.length-1?latestReply:undefined} className="chat-message from-assistant"><span className="sr-only">Assistant: </span><p>{turn.reply}</p></div>}</React.Fragment>)}
    {pendingInstruction&&<div className="chat-message from-user"><p>{pendingInstruction}</p></div>}
    {busy==='Preparing changes...'&&working}
   </div>
   {proposal&&<section className="proposal"><h3 ref={proposalHeading} tabIndex={-1}>Review these changes</h3><p>{proposal.operations.length+(proposal.sleepChanges?.length??0)} {proposal.operations.length+(proposal.sleepChanges?.length??0)===1?'change':'changes'}. Check every action before saving.</p><ul>{proposal.operations.map((op,i)=><OperationPreview key={i} op={op} entries={proposal.targets??entries}/>)}</ul>{!!proposal.sleepChanges?.length&&<><h3>Sleep changes</h3><ul>{proposal.sleepChanges.map((op,i)=><OperationPreview key={i} op={op} entries={proposal.sleepTargets??proposal.targets??entries}/>)}</ul></>}{proposal.sleepNotice&&<p role="status">{proposal.sleepNotice}</p>}<p className="muted">Nothing is saved until you confirm all changes. Expires in 10 minutes.</p><div className="assistant-actions"><button className="quiet" disabled={!!busy} aria-busy={busy==='Cancelling...'} onClick={()=>void cancel()}>{busy==='Cancelling...'&&<Icon name="spinner" size={18}/>}Cancel changes</button><button className="primary" disabled={!!busy} aria-busy={busy==='Saving...'} onClick={()=>void confirm()}><Icon name={busy==='Saving...'?'spinner':'check'} size={18}/>Confirm changes</button></div></section>}
   {error&&<div className="notice error" role="alert">{error}</div>}
   {!proposal&&<form className="instruction-composer" onSubmit={event=>{event.preventDefault();void ask(answering?followUp:command,answering?conversation:[]);}}>
    {busy!=='Preparing changes...'&&working}
    {recording&&!busy&&<p className="recording-time" role="status">Recording<span aria-hidden="true"> {Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')} / 2:00</span><span>{micSignal?'Microphone signal detected':seconds>=2?'Recording level is low. Speak near the microphone.':'Checking microphone...'}</span></p>}
    <label className="field composer-input"><span className="sr-only">{answering?'Your reply':'Your instruction'}</span><textarea aria-label={answering?'Your reply':'Your instruction'} ref={instructionInput} rows={3} maxLength={4000} value={answering?followUp:command} onChange={event=>{if(answering)setFollowUp(event.target.value);else{setCommand(event.target.value);setConversation([]);setFollowUp('');setReply('');}}} placeholder={answering?'Give your reply here':'Give your logging instruction here'} disabled={!!busy||recording}/></label>
    {transcript!==null&&<section className="transcript-review" aria-label="Recorded transcript"><h3 ref={transcriptHeading} tabIndex={-1}>Recorded transcript</h3><p>{transcript}</p><div className="assistant-actions"><button type="button" className="primary" onClick={()=>{if(recordingTarget.current==='reply')setFollowUp(transcript);else{setCommand(transcript);setReply('');}setTranscript(null);requestAnimationFrame(()=>(recordButton.current??instructionInput.current)?.focus({preventScroll:true}));}}>Use transcript</button><button type="button" className="quiet" onClick={()=>{setTranscript(null);if(recordingTarget.current==='command')setReply('');requestAnimationFrame(()=>(recordButton.current??instructionInput.current)?.focus({preventScroll:true}));}}>{recordingTarget.current==='reply'?'Keep typed reply':'Keep typed command'}</button></div></section>}
    {!conversation.length&&reply&&<p className="composer-hint" role="status">{reply}</p>}
    <div className="composer-footer"><Help label="Examples"><p>OpenRouter receives your instructions and relevant diary records.</p><p>Recordings go to OpenRouter for transcription.</p><p>"Add a nappy change now. Pee and poo."</p><p>"She slept from 10:15 to 11:40. Add a nappy change at 11:45, pee only."</p><p>You can include several actions in one instruction.</p></Help><div className="composer-controls"><button className="composer-icon submit-instruction" type="submit" aria-label="Send" aria-busy={busy==='Preparing changes...'} title="Send" disabled={!(answering?followUp:command).trim()||!!busy||recording||transcript!==null}><Icon name={busy==='Preparing changes...'?'spinner':'send'} size={22}/></button>{transcriptionAvailable&&<button ref={recordButton} type="button" className={'composer-icon record-button'+(recording?' recording':'')} aria-label={recording?'Stop recording':answering?'Record reply':'Record voice'} title={recording?'Stop recording':answering?'Record reply':'Record voice'} aria-pressed={recording} aria-busy={['Opening microphone...','Finishing recording...'].includes(busy)} disabled={!!busy||transcript!==null} onClick={()=>void record(answering?'reply':'command')}><Icon name={['Opening microphone...','Finishing recording...'].includes(busy)?'spinner':recording?'stop':'mic'} size={22}/></button>}</div></div>

   </form>}
   {proposal&&working}
   {recordedUrl&&!recording&&<section className="recording-review" aria-label="Recording playback"><audio ref={playback} controls preload="none" src={recordedUrl} aria-label="Play full recording"/><button type="button" className="quiet" disabled={!!busy} aria-busy={busy==='Transcribing...'} onClick={()=>void transcribeRecording()}>{busy==='Transcribing...'&&<Icon name="spinner" size={18}/>}Retry transcription</button><details><summary>Speech diagnostics</summary><p>{speechDebug}</p><p>Recordings use temporary server storage for up to seven days. The server keeps at most 100 recordings.</p></details></section>}
  </div>
 </section>;
}

createRoot(document.getElementById('root')!).render(<Auth>{(user,authenticated,onLogout)=><App user={user} authenticated={authenticated} onLogout={onLogout}/>}</Auth>);
