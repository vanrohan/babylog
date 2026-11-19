import React,{useMemo,useState,useEffect} from 'react';
import type {Entry} from '../shared.ts';
import {dayInput,dateTimeInput} from '../time.ts';
import {summarizeDays,rangeFor,rangeDays,shiftDate,durationLabel,trackFor,zoomRange,type View,type Track,type DaySummary} from '../dashboard.ts';
import {CareCharts,RangeNavigator} from './CareCharts.tsx';
import {Help,EntryNotes} from './Details.tsx';
import './dashboard.css';
import {entryLabel} from '../activities.ts';
import {SlidingTimeline} from './SlidingTimeline.tsx';

const tracks:{key:Track;label:string}[]=[{key:'sleep',label:'Sleep'},{key:'feeding',label:'Feeding'},{key:'nappy',label:'Nappy changes'},{key:'bath',label:'Bath'},{key:'other',label:'Other activities'}];
const shortDate=(day:string)=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
const fullDate=(day:string)=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
const weekday=(day:string)=>new Intl.DateTimeFormat('en-GB',{weekday:'short',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
const exactTime=(iso:string)=>dateTimeInput(iso).replace('T',' ')+new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',timeZoneName:'shortOffset'}).formatToParts(new Date(iso)).filter(p=>p.type==='timeZoneName').map(p=>' '+p.value.replace('GMT','UTC')).join('');
const sleepLabel=(day:DaySummary)=>day.entries.some(e=>e.activity==='sleep'&&(e.endAt||e.status==='active'))?durationLabel(day.sleepMinutes):day.untimedSleep?'Not timed':'-';
const entryDuration=(entry:Entry)=>entry.status==='active'?durationLabel(Math.max(0,(Date.now()-Date.parse(entry.startAt))/60_000))+' so far (running)':entry.endAt?durationLabel((Date.parse(entry.endAt)-Date.parse(entry.startAt))/60_000):['sleep','feeding'].includes(entry.activity)?'Not recorded':'Point event';
function ClockAxis(){return <div className="clock-axis" aria-hidden="true">{[0,6,12,18,24].map(h=><span key={h} style={{left:`${h/24*100}%`}}>{String(h).padStart(2,'0')}:00</span>)}</div>;}
function TrackMarks({day,track,onPreview}:{day:DaySummary;track:Track;onPreview:(id:string)=>void}){
 return <span className={'pattern-track '+track} aria-hidden="true">{[0,6,12,18,24].map(h=><i className="clock-line" key={h} style={{left:`${h/24*100}%`}}/>)}{day.marks.filter(m=>m.track===track).map((mark,i)=><span key={mark.id+'-'+i} onMouseEnter={()=>onPreview(mark.id)} onClick={e=>{e.stopPropagation();onPreview(mark.id);}} className={'pattern-mark '+(mark.duration===0?'point ':'')+(mark.active?'running':'')} style={{left:`${mark.minute/1440*100}%`,width:mark.duration===0?undefined:`${mark.duration/1440*100}%`}}/>)}</span>;
}
export function Dashboard({entries,loaded,online,onOpenEntry,onLog,onRetry}:{entries:Entry[];loaded:boolean;online:boolean;onOpenEntry:(entry:Entry)=>void;onLog:()=>void;onRetry:()=>void}){
 const initial=new URLSearchParams(location.search);
 const initialView=initial.get('view');
 const [view,setView]=useState<View>(['day','week','month','custom'].includes(initialView??'')?initialView as View:'week');
 const [anchor,setAnchor]=useState(initial.get('date')??dayInput());
 const [customFrom,setCustomFrom]=useState(initial.get('from')??shiftDate(dayInput(),-6));
 const [customTo,setCustomTo]=useState(initial.get('to')??dayInput());
 const [dateOptions,setDateOptions]=useState(false);
 const [filter,setFilter]=useState<Track|'all'>('all');
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [previewId,setPreviewId]=useState<string|null>(null);
 const preview=entries.find(e=>e.id===previewId);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setPreviewId(null);};window.addEventListener('keydown',close);return ()=>window.removeEventListener('keydown',close);},[]);
 useEffect(()=>setPreviewId(null),[view,anchor,customFrom,customTo,filter]);
 const [previousRange,setPreviousRange]=useState<{view:View;anchor:string;from:string;to:string}|null>(null);
 useEffect(()=>{const query=new URLSearchParams({view,date:anchor});if(view==='custom'){query.set('from',customFrom);query.set('to',customTo);}history.replaceState(null,'','/dashboard?'+query);},[view,anchor,customFrom,customTo]);
 const result=useMemo(()=>{
  try{
   const range=view==='custom'?{from:customFrom,to:customTo}:rangeFor(view,anchor);
   const days=summarizeDays(entries,range.from,range.to);
   return {...range,days,error:''};
  }catch(error){return {from:'',to:'',days:[] as DaySummary[],error:(error as Error).message};}
 },[entries,view,anchor,customFrom,customTo]);
 const days=result.days;
 const totals=days.reduce((a,d)=>({sleep:a.sleep+d.sleepMinutes,feeds:a.feeds+d.feeds,pee:a.pee+d.pee,poo:a.poo+d.poo,untimed:a.untimed+d.untimedSleep}),{sleep:0,feeds:0,pee:0,poo:0,untimed:0});
 const covered=days.filter(d=>d.entries.length>0).length;
 const visibleTracks=tracks.filter(t=>filter==='all'||filter===t.key);
 const selected=entries.find(e=>e.id===selectedId);
 const day=days[0];
 function applyRange(from:string,to:string){
  try{rangeDays(from,to);setCustomFrom(from);setCustomTo(to);setView('custom');setPreviousRange(null);setSelectedId(null);}catch{}
 }
 function preset(count:number){const to=dayInput();applyRange(shiftDate(to,1-count),to);}
 function allRecords(){const dates=entries.flatMap(e=>[dayInput(e.startAt),dayInput(e.endAt?new Date(Math.max(Date.parse(e.startAt),Date.parse(e.endAt)-1)).toISOString():e.status==='active'?new Date(Math.max(Date.parse(e.startAt),Date.now())).toISOString():e.startAt)]).sort();if(!dates.length){preset(7);return;}const to=dates.at(-1)!;const from=dates[0]<shiftDate(to,-365)?shiftDate(to,-365):dates[0];applyRange(from,to);}
 function zoom(factor:number){const next=zoomRange(result.from,result.to,factor);applyRange(next.from,next.to);}
 function chooseView(next:View){setPreviousRange(null);setView(next);setSelectedId(null);if(next==='custom'&&result.from){setCustomFrom(result.from);setCustomTo(result.to);}}
 function openDay(day:string){setPreviousRange({view,anchor,from:customFrom,to:customTo});setAnchor(day);setView('day');setSelectedId(null);window.scrollTo({top:0});}
 function backToRange(){if(!previousRange)return;setView(previousRange.view);setAnchor(previousRange.anchor);setCustomFrom(previousRange.from);setCustomTo(previousRange.to);setPreviousRange(null);setSelectedId(null);}
 function move(direction:number){
  if(view==='custom'){
   try{const span=rangeDays(customFrom,customTo).length;setCustomFrom(shiftDate(customFrom,direction*span));setCustomTo(shiftDate(customTo,direction*span));}catch{}
  }else if(view==='month'){
   const date=new Date(anchor.slice(0,7)+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+direction);setAnchor(date.toISOString().slice(0,10));
  }else setAnchor(shiftDate(anchor,direction*(view==='week'?7:1)));
  setSelectedId(null);
 }
 return <div className="dashboard">
  <div className="dashboard-heading"><div><h1>Care patterns</h1></div><button className="primary" onClick={onLog}>Add an entry</button></div>
  {previousRange&&view==='day'&&<button className="quiet back-to-range" onClick={backToRange}>Back to range</button>}
  <section className="dashboard-controls" aria-label="Dashboard range">
   <div className="range-tabs" role="group" aria-label="Time range">{(['day','week','month','custom'] as View[]).map(v=><button key={v} aria-pressed={view===v} onClick={()=>chooseView(v)}>{v[0].toUpperCase()+v.slice(1)}</button>)}</div>
   <div className={'range-dates'+(view==='custom'?' custom-dates':'')}><button className="range-arrow" aria-label="Previous range" title="Previous range" disabled={!!result.error} onClick={()=>move(-1)}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 6-6 6 6 6"/></svg></button>{view==='custom'?<><label>From<input type="date" aria-label="Range start" value={customFrom} onChange={e=>{setCustomFrom(e.target.value);setSelectedId(null);}}/></label><label>To<input type="date" aria-label="Range end" value={customTo} onChange={e=>{setCustomTo(e.target.value);setSelectedId(null);}}/></label></>:<label>{view==='day'?'Date':view==='week'?'Week of':'Month of'}<input type="date" aria-label="Dashboard date" value={anchor} onChange={e=>{setAnchor(e.target.value);setSelectedId(null);}}/></label>}<button className="range-arrow" aria-label="Next range" title="Next range" disabled={!!result.error} onClick={()=>move(1)}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6"/></svg></button><button className="quiet" onClick={()=>{setAnchor(dayInput());if(view==='custom'){setCustomFrom(shiftDate(dayInput(),-6));setCustomTo(dayInput());}}}>Today</button></div>
  </section>
  <details className="date-options" open={dateOptions} onToggle={event=>setDateOptions(event.currentTarget.open)}><summary>More date options</summary><div className="range-explore" role="group" aria-label="Explore dates"><div className="range-presets">{[7,14,30].map(n=><button key={n} className="quiet" onClick={()=>preset(n)}>Last {n} days</button>)}<button className="quiet" onClick={allRecords}>All recorded days</button></div><div className="range-zoom"><button disabled={!!result.error||days.length<=1} onClick={()=>zoom(0.5)}>Zoom in</button><button disabled={!!result.error||days.length>=366} onClick={()=>zoom(2)}>Zoom out</button></div></div>
  {dateOptions&&view==='custom'&&!result.error&&<><RangeNavigator entries={entries} from={result.from} to={result.to} onRange={applyRange}/><p className="chart-help">{days.length} selected {days.length===1?'day':'days'}. Drag to change dates.</p></>}
  </details>
  {result.error?<div className="notice error" role="alert">{result.error}</div>:!loaded?(online?<p role="status" className="dashboard-loading">Loading the shared diary...</p>:<div className="notice error" role="alert"><p>The shared diary is unavailable. Try again or open the time log.</p><button onClick={onRetry}>Try again</button></div>):<>
   <section className="range-overview" aria-label="Range totals"><div><h2>{view==='day'?fullDate(result.from):fullDate(result.from)+' - '+fullDate(result.to)}</h2><p>{covered} / {days.length} days logged. Berlin time.</p></div><dl><div><dt>Sleep logged</dt><dd>{days.some(d=>d.entries.some(e=>e.activity==='sleep'&&(e.endAt||e.status==='active')))?durationLabel(totals.sleep):'-'}</dd></div><div><dt>Feeds</dt><dd>{totals.feeds}</dd></div><div><dt>Pee</dt><dd>{totals.pee}</dd></div><div><dt>Poo</dt><dd>{totals.poo}</dd></div></dl></section>
   {!online&&<p className="notice" role="status">The connection is lost. These records can be out of date.</p>}
   <div className="pattern-toolbar"><div><h2>Daily rhythm</h2></div><label className="pattern-filter">Show<select aria-label="Dashboard activity" value={filter} onChange={e=>{setFilter(e.target.value as Track|'all');setSelectedId(null);}}><option value="all">All activities</option>{tracks.map(t=><option key={t.key} value={t.key}>{t.label}</option>)}</select></label></div>
   <div className="pattern-legend" aria-label="Activity legend">{tracks.map(t=><span key={t.key}><i className={t.key}/>{t.label}</span>)}</div>
   {covered===0&&<div className="dashboard-empty"><h3>No entries in this range</h3><button className="quiet" onClick={onLog}>Open the time log</button></div>}
   <Help label="Timeline help"><p>Tap an activity for details. Select a day to open its entries.</p><p>Scroll the timeline to see later times. Blank time has no records.</p></Help>
   <div className="pattern-scroll" role="region" aria-label="Care timeline" tabIndex={0}>
    {view==='day'&&day?<div className="day-pattern"><div className="day-axis"><ClockAxis/></div>{visibleTracks.map(t=><div key={t.key} className="day-track"><strong>{t.label}</strong><TrackMarks day={day} track={t.key} onPreview={setPreviewId}/></div>)}</div>:<div className={'pattern-grid '+(view==='month'||view==='custom'?'compact':'')}>
     <div className="pattern-grid-heading"><span>Day</span><ClockAxis/><span className="daily-column-head">Sleep / Feeds<br/>Pee / Poo</span></div>
     {days.map(d=><button className={'pattern-day '+(d.entries.length?'':'unlogged')} key={d.day} aria-label={`${d.day}: ${d.entries.length} entries, sleep ${sleepLabel(d)}, ${d.feeds} feeds, ${d.pee} pee, ${d.poo} poo. Open day.`} onClick={()=>openDay(d.day)}><span className="pattern-date"><strong>{weekday(d.day)}</strong><span>{shortDate(d.day)}</span>{d.day===dayInput()&&<small>Today, partial</small>}{d.hours!==24&&<small>{d.hours}h clock day</small>}<span className="mobile-findings">Pee {d.entries.length?d.pee:'-'} / Poo {d.entries.length?d.poo:'-'}</span></span><span className="day-tracks">{visibleTracks.map(t=><TrackMarks key={t.key} day={d} track={t.key} onPreview={setPreviewId}/>)}{!d.entries.length&&<span className="no-day-data">No entries</span>}</span><span className="daily-counts"><span>{sleepLabel(d)} <b>/</b> {d.entries.length?d.feeds:'-'}</span><span>Pee {d.entries.length?d.pee:'-'} <b>/</b> Poo {d.entries.length?d.poo:'-'}</span>{d.active>0&&<small>Running timer</small>}</span></button>)}
    </div>}
   </div>
   <CareCharts entries={entries} days={days} filter={filter}/>
   <SlidingTimeline entries={entries} from={result.from} to={result.to} filter={filter} onDay={openDay} onPreview={setPreviewId}/>
   <div className="counting-notes"><Help label="About totals"><p>Counts use the start date. Mixed nappies count once for each finding.</p><p>Sleep splits at midnight. Overlapping sleep counts once. Running timers include elapsed time.</p><p>Totals include all activities. Filters change the timeline and density curves.</p></Help>{totals.untimed>0&&<p>{totals.untimed} sleep {totals.untimed===1?'record has':'records have'} no end time.</p>}{days.some(d=>d.hours!==24)&&<p>Clock change: totals use elapsed time.</p>}</div>
   {view==='day'&&day&&<section className="dashboard-details" aria-label="Day entries"><div className="detail-heading"><h2>Entries for {shortDate(day.day)}</h2><span>{day.day===dayInput()?'Today, partial':''}</span></div><div className="day-totals"><span>Sleep: <strong>{sleepLabel(day)}</strong></span><span>Feeds: <strong>{day.feeds}</strong></span><span>Nappies: <strong>{day.nappies}</strong></span><span>Pee: <strong>{day.pee}</strong></span><span>Poo: <strong>{day.poo}</strong></span></div>{day.entries.filter(e=>filter==='all'||trackFor(e.activity)===filter).map(e=><button key={e.id} className={'dashboard-entry '+(selectedId===e.id?'is-open':'')} onFocus={event=>{if(event.currentTarget.matches(':focus-visible'))setPreviewId(e.id);}} onClick={()=>{setPreviewId(null);setSelectedId(selectedId===e.id?null:e.id);}} aria-expanded={selectedId===e.id}><i className={'entry-dot '+trackFor(e.activity)}/><strong>{entryLabel(e)}</strong><span>{dateTimeInput(e.startAt).slice(11)}{dayInput(e.startAt)!==day.day?' ('+shortDate(dayInput(e.startAt))+')':''}{e.endAt?' - '+dateTimeInput(e.endAt).slice(11)+(dayInput(e.endAt)!==day.day?' ('+shortDate(dayInput(e.endAt))+')':''):e.status==='active'?' - running':['sleep','feeding'].includes(e.activity)?' - no end time':''}{(e.endAt||e.status==='active')?' ('+entryDuration(e)+')':''}</span><span>{[e.pee?'Pee':'',e.poo?'Poo':'',e.temperature!==null?e.temperature+' C':''].filter(Boolean).join(', ')}</span></button>)}{!day.entries.some(e=>filter==='all'||trackFor(e.activity)===filter)&&<p className="muted">No entries match this activity on this day.</p>}{selected&&day.entries.some(e=>e.id===selected.id)&&<article className="entry-inspector" aria-label="Entry details"><h3>{entryLabel(selected)}</h3><p>Start: {exactTime(selected.startAt)}</p><p>End: {selected.endAt?exactTime(selected.endAt):selected.status==='active'?'Still in progress':'Not recorded'}</p><p>Duration: {entryDuration(selected)}</p><p>Pee: {selected.pee?'Yes':'No'}. Poo: {selected.poo?'Yes':'No'}. Temperature: {selected.temperature===null?'Not recorded':selected.temperature+' C'}.</p><EntryNotes notes={selected.notes}/><button className="quiet" onClick={()=>onOpenEntry(selected)}>Edit in time log</button></article>}</section>}
  </>}
  {preview&&<aside className="activity-preview" role="region" aria-label="Activity preview"><header><h3>{entryLabel(preview)}</h3><button className="quiet" aria-label="Close activity preview" onClick={()=>setPreviewId(null)}>Close</button></header><p>Start: {exactTime(preview.startAt)}</p><p>End: {preview.endAt?exactTime(preview.endAt):preview.status==='active'?'Still in progress':'Not recorded'}</p><p>Duration: {entryDuration(preview)}</p><p>Pee: {preview.pee?'Yes':'No'}. Poo: {preview.poo?'Yes':'No'}.</p><p>Temperature: {preview.temperature===null?'Not recorded':preview.temperature+' C'}</p><div className="preview-notes"><EntryNotes notes={preview.notes}/></div><button className="quiet" onClick={()=>{setPreviewId(null);onOpenEntry(preview);}}>Edit in time log</button></aside>}
 </div>;
}
