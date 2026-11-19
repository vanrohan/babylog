import type {Entry} from './shared.ts';
import {dateTimeInput,dayInput,inputToIso} from './time.ts';
import {feedingActivity,normalizeActivity,inferBreastSide} from './activities.ts';
export type View='day'|'week'|'month'|'custom';
export type Track='sleep'|'feeding'|'nappy'|'bath'|'other';
export interface Mark {id:string;track:Track;minute:number;duration:number;active:boolean}
export interface DaySummary {
 day:string;hours:number;entries:Entry[];marks:Mark[];sleepMinutes:number;
 feeds:number;nappies:number;pee:number;poo:number;active:number;untimedSleep:number;
}
export const trackFor=(activity:string):Track=>feedingActivity(activity)?'feeding':activity==='sleep'||activity==='nappy'||activity==='bath'?activity:'other';
export function shiftDate(day:string,amount:number){
 const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10);
}
function validDay(day:string){
 const time=Date.parse(day+'T00:00:00Z');
 return /^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===day;
}
export function rangeFor(view:Exclude<View,'custom'>,anchor:string){
 if(!validDay(anchor))throw new Error('Choose a valid date.');
 if(view==='day')return {from:anchor,to:anchor};
 if(view==='week'){
  const weekday=new Date(anchor+'T12:00:00Z').getUTCDay();
  const from=shiftDate(anchor,-((weekday+6)%7));return {from,to:shiftDate(from,6)};
 }
 const from=anchor.slice(0,7)+'-01';
 const next=new Date(from+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);
 return {from,to:shiftDate(next.toISOString().slice(0,10),-1)};
}
export function rangeDays(from:string,to:string){
 if(!validDay(from)||!validDay(to))throw new Error('Choose valid start and end dates.');
 const count=Math.round((Date.parse(to)-Date.parse(from))/86_400_000)+1;
 if(count<1)throw new Error('The end date must follow the start date.');
 if(count>366)throw new Error('Choose a range of 366 days or fewer.');
 return Array.from({length:count},(_,i)=>shiftDate(from,i));
}
const minuteOf=(iso:string)=>{const value=dateTimeInput(iso);return Number(value.slice(11,13))*60+Number(value.slice(14,16));};
function unionMinutes(intervals:[number,number][]){
 const sorted=intervals.sort((a,b)=>a[0]-b[0]);let total=0,start=0,end=0;
 for(const [a,b] of sorted){if(a>end){total+=end-start;start=a;end=b;}else end=Math.max(end,b);}
 return (total+end-start)/60_000;
}
export function summarizeDays(entries:Entry[],from:string,to:string,now=new Date()):DaySummary[]{
 const bounds=rangeDays(from,to).map(day=>({day,start:Date.parse(inputToIso(day+'T00:00')),end:Date.parse(inputToIso(shiftDate(day,1)+'T00:00'))}));
 const days:DaySummary[]=bounds.map(b=>({day:b.day,hours:(b.end-b.start)/3_600_000,entries:[],marks:[],sleepMinutes:0,feeds:0,nappies:0,pee:0,poo:0,active:0,untimedSleep:0}));
 const intervals:[number,number][][]=days.map(()=>[]);
 const startRange=bounds[0].start,endRange=bounds[bounds.length-1].end;
 for(const entry of entries){
  const start=Date.parse(entry.startAt);
  const finish=entry.status==='active'?Math.max(start,+now):entry.endAt?Date.parse(entry.endAt):start;
  if(start>=endRange||finish<startRange||(finish===startRange&&finish>start))continue;
  const startDay=dayInput(entry.startAt),track=trackFor(entry.activity);
  for(let i=0;i<days.length;i++){
   const day=days[i],b=bounds[i];
   const isPoint=finish===start;
   if(isPoint?start<b.start||start>=b.end:finish<=b.start||start>=b.end)continue;
   day.entries.push(entry);
   if(startDay===day.day){
    if(track==='feeding')day.feeds++;
    if(track==='nappy')day.nappies++;
    if(entry.pee)day.pee++;
    if(entry.poo)day.poo++;
   }
   if(entry.status==='active')day.active++;
   if(track==='sleep'&&entry.status==='completed'&&!entry.endAt)day.untimedSleep++;
   const a=Math.max(start,b.start),z=Math.min(finish,b.end);
   if(track==='sleep'&&z>a)intervals[i].push([a,z]);
   if(isPoint){day.marks.push({id:entry.id,track,minute:minuteOf(entry.startAt),duration:0,active:entry.status==='active'});continue;}
   // Split at UTC hours so clock changes do not reverse a bar.
   for(let cursor=a;cursor<z;){
    const next=Math.min(z,(Math.floor(cursor/3_600_000)+1)*3_600_000);
    const minute=minuteOf(new Date(cursor).toISOString())+(cursor%60_000)/60_000;
    day.marks.push({id:entry.id,track,minute,duration:Math.min((next-cursor)/60_000,1440-minute),active:entry.status==='active'});
    cursor=next;
   }
  }
 }
 for(let i=0;i<days.length;i++){
  days[i].sleepMinutes=unionMinutes(intervals[i]);
  days[i].entries.sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt));
 }
 return days;
}
export function durationLabel(minutes:number){
 const rounded=Math.round(minutes);return rounded>=60?`${Math.floor(rounded/60)}h ${rounded%60}m`:`${rounded}m`;
}

export function zoomRange(from:string,to:string,factor:number){
 const count=rangeDays(from,to).length;
 if(!Number.isFinite(factor)||factor<=0)throw new Error('Use a valid zoom factor.');
 const next=Math.max(1,Math.min(366,Math.round(count*factor)));
 const start=shiftDate(from,Math.floor((count-next)/2));
 return {from:start,to:shiftDate(start,next-1)};
}
export function startDensity(entries:Entry[],from:string,to:string,bandwidth=60){
 rangeDays(from,to);
 if(!Number.isFinite(bandwidth)||bandwidth<15||bandwidth>180)throw new Error('Choose smoothing from 15 to 180 minutes.');
 const groups=new Map<Track,number[]>();
 const seen=new Set<string>();
 for(const e of entries){
  const day=dayInput(e.startAt);
  if(day<from||day>to||seen.has(e.id))continue;
  seen.add(e.id);
  const track=trackFor(e.activity),samples=groups.get(track)??[];
  samples.push(minuteOf(e.startAt));groups.set(track,samples);
 }
 return [...groups].map(([track,samples])=>({track,count:samples.length,points:Array.from({length:145},(_,i)=>{
  const minute=i*10;
  const sum=samples.reduce((total,sample)=>total+[-1440,0,1440].reduce((a,offset)=>a+Math.exp(-0.5*((minute-sample+offset)/bandwidth)**2),0),0);
  return [minute,sum*6000/(samples.length*bandwidth*Math.sqrt(2*Math.PI))] as [number,number];
 })}));
}

export function breastBalance(entries:Entry[],from:string,to:string,now=new Date()){
 const dates=rangeDays(from,to);
 const days=dates.map(day=>({day,left:0,right:0,unknown:0}));
 const bounds=dates.map(day=>[Date.parse(inputToIso(day+'T00:00')),Date.parse(inputToIso(shiftDate(day,1)+'T00:00'))]);
 let untimed=0,running=0;
 const seen=new Set<string>();
 for(const entry of entries){
  if(seen.has(entry.id))continue;seen.add(entry.id);
  if(normalizeActivity(entry.activity,entry.feedingType).feedingType!=='Breast')continue;
  const start=Date.parse(entry.startAt),end=entry.status==='active'?Math.max(start,+now):entry.endAt?Date.parse(entry.endAt):start;
  if(start>=bounds.at(-1)![1]||end<bounds[0][0]||(end===bounds[0][0]&&end>start))continue;
  if(entry.status==='completed'&&!entry.endAt){untimed++;continue;}
  if(entry.status==='active')running++;
  const side=entry.breastSide===undefined?inferBreastSide(entry.notes):entry.breastSide;
  const stated=entry.status==='completed'?entry.notes.match(/Feeding:\s*\d+(?:\.\d+)? min per side,\s*(\d+(?:\.\d+)?) min total\b/i):null;
  const scale=stated&&end>start?Math.min(1,Number(stated[1])*60_000/(end-start)):1;
  for(let i=0;i<days.length;i++){
   const minutes=scale*Math.max(0,Math.min(end,bounds[i][1])-Math.max(start,bounds[i][0]))/60_000;
   if(side==='both'){days[i].left+=minutes/2;days[i].right+=minutes/2;}
   else if(side==='left'||side==='right')days[i][side]+=minutes;
   else days[i].unknown+=minutes;
  }
 }
 return {days,left:days.reduce((sum,d)=>sum+d.left,0),right:days.reduce((sum,d)=>sum+d.right,0),unknown:days.reduce((sum,d)=>sum+d.unknown,0),untimed,running};
}
