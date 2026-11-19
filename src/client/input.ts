import type {Entry} from '../shared.ts';
import {dateTimeInput,inputToIso} from '../time.ts';

export type TimeValue={iso:string;local:string};
export function shiftedTime(minutes:number,anchor:string,original?:string):TimeValue{
 if(!Number.isSafeInteger(minutes)||Math.abs(minutes)>10080)throw new Error('Use a time amount of up to seven days.');
 const iso=new Date(Date.parse(inputToIso(anchor,undefined,original))+minutes*60_000).toISOString();
 return {iso,local:dateTimeInput(iso)};
}
export function timeAgo(minutes:number,now=Date.now()):TimeValue{
 if(!Number.isSafeInteger(minutes)||minutes<0||minutes>10080)throw new Error('Use a time amount of up to seven days.');
 const iso=new Date(now-minutes*60_000).toISOString();
 return {iso,local:dateTimeInput(iso)};
}
export function parseTimeAmount(hours:string,minutes:string){
 if(!/^\d+$/.test(hours.trim())||!/^\d+$/.test(minutes.trim())||Number(minutes)>59)throw new Error('Use whole hours and 0 to 59 minutes.');
 const total=Number(hours)*60+Number(minutes);
 if(!Number.isSafeInteger(total)||total<1||total>10080)throw new Error('Use a time amount from one minute to seven days.');
 return total;
}

export function endAfterFifteenMinutes(start:string,originalStart?:string){
 try{
  return shiftedTime(15,start,originalStart);
 }catch{return null;}
}

export function parseTemperature(input:string):number|null{
 const value=input.trim();
 if(!value)return null;
 const temperature=Number(value.replace(',','.'));
 if(!/^\d+(?:[.,]\d+)?$/.test(value)||!Number.isFinite(temperature)||temperature<20||temperature>50){
  throw new Error('Enter a temperature from 20 to 50 C. Use 36.7 or 36,7.');
 }
 return temperature;
}

export function lastActivityEnd(entries:Pick<Entry,'id'|'endAt'>[],excludeId?:string,now=Date.now()):TimeValue|null{
 const ends=entries.filter(entry=>entry.id!==excludeId&&entry.endAt&&Date.parse(entry.endAt)<=now);
 const iso=ends.reduce<string|null>((last,entry)=>!last||Date.parse(entry.endAt!)>Date.parse(last)?entry.endAt:last,null);
 return iso?{iso,local:dateTimeInput(iso)}:null;
}
