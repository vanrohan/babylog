import React,{useEffect,useRef,useState} from 'react';
import {Wheel,type WheelHandle} from './Wheel.tsx';
import {Icon} from './Icon.tsx';
import {shiftedTime,timeAgo,type TimeValue} from './input.ts';

export function TimeShortcuts({field,lastEnd,anchor,originalAnchor,open,onToggle,onSet,busy}:{field:'start'|'end';lastEnd?:TimeValue|null;anchor:string;originalAnchor?:string;open:boolean;onToggle:()=>void;onSet:(time:TimeValue)=>void;busy:boolean}){
 const [mode,setMode]=useState<'ago'|'duration'>(field==='start'?'ago':'duration');
 const wheel=useRef<WheelHandle>(null);
 const [minutes,setMinutes]=useState(15),[now,setNow]=useState(Date.now());
 const disclosure=useRef<HTMLButtonElement>(null);
 const amountId=`${field}-helper`,anchorName=field==='start'?'end':'start';
 useEffect(()=>{if(!open)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[open]);
 function calculate(at:number,readWheel=false){
  const amount=readWheel?wheel.current?.value()??minutes:minutes;
  if(mode==='ago')return timeAgo(amount,at);
  try{return shiftedTime(field==='start'?-amount:amount,anchor,originalAnchor);}
  catch{throw new Error(`Enter a valid ${anchorName} time first.`);}
 }
 let preview:TimeValue|null=null,error='';
 const durations=[5,10,15].map(minutes=>{
  let time:TimeValue|null=null;
  if(field==='end'){try{time=shiftedTime(minutes,anchor,originalAnchor);}catch{}}
  return {minutes,time};
 });
 try{preview=calculate(now);}catch(e){error=(e as Error).message;}
 function apply(){
  if(busy)return;
  try{onSet(calculate(Date.now(),true));onToggle();disclosure.current?.focus({preventScroll:true});}catch{}
 }
 return <>
  <div className="time-shortcuts" role="group" aria-label={`${field==='start'?'Start':'End'} time shortcuts`}>
   <button type="button" disabled={busy} aria-label={`Set ${field} time to now`} onClick={()=>onSet(timeAgo(0))}><span>Now</span></button>
   {field==='start'?<button type="button" disabled={busy} aria-label="Set start time 15 minutes ago" onClick={()=>onSet(timeAgo(15))}><span>15min ago</span></button>:durations.map(({minutes,time})=><button key={minutes} type="button" disabled={busy||!time} aria-label={`Set end time ${minutes} minutes after start`} onClick={()=>{if(time)onSet(time);}}><span>{minutes}min total</span></button>)}
   {field==='start'&&<button type="button" disabled={busy||!lastEnd} aria-label="Use last activity end" onClick={()=>{if(lastEnd){onSet(lastEnd);if(open)onToggle();}}}><span>Last end</span></button>}
  </div>
  <div className="time-relative-group">
   <button ref={disclosure} type="button" disabled={busy} className="time-helper-toggle" aria-label={`${field==='start'?'Start':'End'} relative time`} aria-expanded={open} aria-controls={amountId} onClick={onToggle}>Relative time<Icon name="chevron" size={18}/></button>
  <fieldset id={amountId} className="time-options" hidden={!open} disabled={busy}>
   <legend className="sr-only">{field==='start'?'Start':'End'} time helper</legend>
   <div className="time-helper-modes" role="group" aria-label={`${field==='start'?'Start':'End'} time calculation`}>
    <button type="button" aria-pressed={mode==='ago'} onClick={()=>setMode('ago')}>Ago</button>
    <button type="button" aria-pressed={mode==='duration'} onClick={()=>setMode('duration')}>{field==='start'?'Before end':'After start'}</button>
   </div>
   <div className="time-helper-presets" role="group" aria-label={`${field==='start'?'Start':'End'} time amount presets`}>{[5,15,30,60].map(value=><button type="button" key={value} aria-pressed={minutes===value} aria-label={`${value} minutes`} onClick={()=>{setMinutes(value);}}>{value+'min'}</button>)}</div>
   <div className="time-helper-amount"><span aria-hidden="true">Minutes</span><Wheel ref={wheel} label={`${field==='start'?'Start':'End'} relative minutes`} value={minutes} max={120} visible={open} disabled={busy} onChange={setMinutes}/></div>
   {preview?<p className="time-helper-preview"><time dateTime={preview.iso}>{new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(preview.iso))}</time></p>:<p className="input-error" role="status">{error}</p>}
   <button type="button" className="time-helper-apply" disabled={busy||!preview} onClick={apply}><Icon name="check" size={18}/>Set {field}</button>
  </fieldset>
  </div>
 </>;
}
