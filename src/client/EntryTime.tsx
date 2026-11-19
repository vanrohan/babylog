import React,{forwardRef,useImperativeHandle,useRef,useState,useEffect} from 'react';
import {dayInput} from '../time.ts';
import {shiftDate} from '../dashboard.ts';
import {Icon} from './Icon.tsx';

import {Wheel,type WheelHandle} from './Wheel.tsx';

export interface EntryTimeHandle{value:()=>string}

export const EntryTime=forwardRef<EntryTimeHandle,{field:'start'|'end';value:string;visible:boolean;busy:boolean;collapsed?:boolean;onChange:(value:string)=>void;onAdd:()=>void;children?:React.ReactNode}>(function EntryTime({field,value,visible,busy,collapsed=false,onChange,onAdd,children},ref){
 const hour=useRef<WheelHandle>(null),minute=useRef<WheelHandle>(null);
 const [today,setToday]=useState(dayInput());
 const [expanded,setExpanded]=useState(!collapsed);
 const name=field==='start'?'Start':'End',yesterday=shiftDate(today,-1),date=value.slice(0,10);
 const hours=Number(value.slice(11,13))||0,minutes=Number(value.slice(14,16))||0;
 useEffect(()=>{const update=()=>setToday(dayInput()),timer=setInterval(update,30000);window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);return ()=>{clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};},[]);
 useImperativeHandle(ref,()=>({value:()=>value&&hour.current&&minute.current?`${date}T${String(hour.current.value()).padStart(2,'0')}:${String(minute.current.value()).padStart(2,'0')}`:value}));
 const manual=(date:string,hours:number,minutes:number)=>{const next=`${date}T${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;if(next!==value)onChange(next);};
 return <section className={'entry-time-section entry-time-'+field} aria-label={name+' time'}>
  <div className="entry-time-heading"><strong><Icon name={field==='start'?'start':'stop'} size={18}/>{name} time{field==='end'&&<span className="optional">optional</span>}</strong>{value&&field==='end'&&<button type="button" className="icon-button" aria-label="Clear end time" disabled={busy} onClick={()=>onChange('')}><Icon name="close" size={18}/></button>}</div>
  {collapsed&&<button type="button" className="start-time-toggle" aria-label="Change start time" aria-describedby="start-time-value" aria-expanded={expanded} aria-controls="start-time-controls" disabled={busy} onClick={()=>setExpanded(value=>!value)}><span id="start-time-value">{value.replace('T',' at ')}</span><span>Change<Icon name="chevron" size={16}/></span></button>}
  <div id={field+'-time-controls'} hidden={!expanded}>
  {children}
  {value?<>
   <div className="entry-date-choices" role="group" aria-label={name+' day choices'}>
    <button type="button" aria-pressed={date===today} disabled={busy} onClick={()=>{const current=dayInput();setToday(current);manual(current,hour.current?.value()??hours,minute.current?.value()??minutes);}}>Today</button>
    <button type="button" aria-pressed={date===yesterday} disabled={busy} onClick={()=>{const current=dayInput();setToday(current);manual(shiftDate(current,-1),hour.current?.value()??hours,minute.current?.value()??minutes);}}>Yesterday</button>
    <label className={'entry-other-date'+(date!==today&&date!==yesterday?' is-selected':'')}><Icon name="calendar" size={18}/>{date!==today&&date!==yesterday&&<span>{new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'}).format(new Date(date+'T12:00:00Z'))}</span>}<input type="date" aria-label={name+' date'} value={date} disabled={busy} onChange={event=>{if(event.target.value)manual(event.target.value,hours,minutes);}}/></label>
   </div>
   <div className="time-wheel-labels" aria-hidden="true"><span>Hour</span><span>Minute</span></div>
   <div className={'time-wheels'+(busy?' is-disabled':'')}><Wheel ref={hour} label={name+' hour'} value={hours} max={23} cyclic visible={visible&&expanded} disabled={busy} onChange={next=>manual(date,next,minute.current?.read()??minutes)}/><span className="time-wheel-colon" aria-hidden="true">:</span><Wheel ref={minute} label={name+' minute'} value={minutes} max={59} cyclic visible={visible&&expanded} disabled={busy} onChange={next=>manual(date,hour.current?.read()??hours,next)}/></div>
  </>:<button className="empty-entry-time" type="button" disabled={busy} onClick={onAdd}><Icon name="plus" size={18}/>{field==='end'?'Add end time':'Set start time'}</button>}
  </div>
 </section>;
});
