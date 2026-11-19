import React,{useLayoutEffect,useMemo,useRef} from 'react';
import type {Entry} from '../shared.ts';
import {summarizeDays,shiftDate,rangeDays,type Track} from '../dashboard.ts';

const tracks:{key:Track;label:string}[]=[{key:'sleep',label:'Sleep'},{key:'feeding',label:'Feeding'},{key:'nappy',label:'Nappy'},{key:'bath',label:'Bath'},{key:'other',label:'Other'}];
export function SlidingTimeline({entries,from,to,filter,onDay,onPreview}:{entries:Entry[];from:string;to:string;filter:Track|'all';onDay:(day:string)=>void;onPreview:(id:string)=>void}){
 const scroll=useRef<HTMLDivElement>(null);
 const span=rangeDays(from,to).length;
 const padding=Math.min(90,Math.floor((366-span)/2));
 const days=useMemo(()=>summarizeDays(entries,shiftDate(from,-padding),shiftDate(to,padding)),[entries,from,to,padding]);
 const visible=tracks.filter(t=>filter==='all'||filter===t.key);
 const width=span===1?640:220;
 useLayoutEffect(()=>{if(scroll.current)scroll.current.scrollLeft=padding*width;},[from,to,padding,width]);
 function move(direction:number){const el=scroll.current;if(el)el.scrollBy({left:direction*Math.max(160,el.clientWidth*.75),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
 return <section className="sliding-timeline" aria-label="Continuous timeline">
  <div className="sliding-heading"><h2>Continuous timeline</h2><div><button onClick={()=>move(-1)} aria-label="Scroll to earlier times">Earlier</button><button onClick={()=>move(1)} aria-label="Scroll to later times">Later</button></div></div>
  <p className="chart-help">Swipe or scroll across midnight. Select a date to open its entries. Berlin time.</p>
  <div className="sliding-scroll" ref={scroll} tabIndex={0} role="region" aria-label="Scrollable care history">
   <div className="sliding-canvas" style={{width:days.length*width+100}}>
    <div className="sliding-row"><strong className="sliding-label">Date</strong>{days.map(day=><button className="sliding-date" style={{width}} key={day.day} onClick={()=>onDay(day.day)}>{day.day}<span>00:00 / 06:00 / 12:00 / 18:00</span></button>)}</div>
    {visible.map(track=><div className="sliding-row" key={track.key}><strong className="sliding-label">{track.label}</strong>{days.map(day=><div key={day.day} className={'sliding-day '+track.key} style={{width}}>{[0,25,50,75].map(x=><i key={x} style={{left:x+'%'}}/>)}{day.marks.filter(m=>m.track===track.key).map((mark,i)=><button key={mark.id+'-'+i} className={'sliding-mark '+(mark.active?'running':'')} style={{left:`${mark.minute/1440*100}%`,width:mark.duration?`${mark.duration/1440*100}%`:undefined}} aria-label={`${track.label} on ${day.day}. Open details.`} onClick={()=>onPreview(mark.id)}/>)}</div>)}</div>)}
   </div>
  </div>
 </section>;
}
