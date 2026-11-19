import {z} from 'zod';
import {dateTimeInput,inputToIso} from '../time.ts';
import {config} from './settings.ts';
import type {ConversationTurn} from '../shared.ts';

const daypartReply=/^\s*(a\.?m\.?|p\.?m\.?)(?:\s+obviously)?[.!]?\s*$/i;

// Model summaries can omit the original time interval.
export function resolveSleepInterval(command:string,conversation:ConversationTurn[],now:Date){
 const original=conversation[0];
 const text=original?.command??command;
 const clock='(0?\\d|1\\d|2[0-3])(?:[:.](\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?';
 const match=new RegExp('^\\s*(?:(?:log|add|record)\\s+(?:a\\s+)?(?:sleep|sleeping)(?:\\s+session)?|(?:she\\s+)?slept|sleep)\\s+from\\s+'+clock+'\\s+to\\s+'+clock+'[.!]?\\s*$','i').exec(text);
 if(!match)return null;
 const corrections=original?[...conversation.slice(1).map(turn=>turn.command),command]:[];
 if(corrections.some(reply=>!daypartReply.test(reply)))return null;
 const correction=corrections.at(-1)?.match(daypartReply)?.[1].replaceAll('.','').toLowerCase();
 const at=original?new Date(original.at):now;
 if(!Number.isFinite(at.getTime()))return null;
 const candidates=(hourText:string,minuteText:string|undefined,partText:string|undefined)=>{
  const hour=Number(hourText),minute=Number(minuteText??0);
  if(minute>59)return [];
  const explicit=partText?.replaceAll('.','').toLowerCase();
  const part=explicit??(hour>=1&&hour<=12&&!hourText.startsWith('0')?correction:undefined);
  if(part&&(hour<1||hour>12))return [];
  const hours=part?[hour%12+(part==='pm'?12:0)]:hourText.startsWith('0')||hour>12||hour===0?[hour]:[hour%12,hour%12+12];
  return hours.map(h=>String(h).padStart(2,'0')+':'+String(minute).padStart(2,'0'));
 };
 const starts=candidates(match[1],match[2],match[3]),ends=candidates(match[4],match[5],match[6]);
 const recent=(clocks:string[],before:number)=>{
  const day=dateTimeInput(new Date(before).toISOString(),config.timeZone).slice(0,10);
  const yesterday=new Date(Date.parse(day+'T12:00:00Z')-86400000).toISOString().slice(0,10);
  const times:string[]=[];
  for(const date of [day,yesterday])for(const clock of clocks){
   try{const utc=assistantTimeToIso(date+'T'+clock);if(Date.parse(utc)<=before)times.push(utc);}catch{return null;}
  }
  return times.sort().at(-1)??null;
 };
 const endAt=recent(ends,at.getTime());
 const startAt=endAt?recent(starts,Date.parse(endAt)-1):null;
 if(!startAt||!endAt)return null;
 return {startAt,endAt};
}

const repeats=(utc:string,local:string)=>[-3600000,3600000].some(delta=>dateTimeInput(new Date(Date.parse(utc)+delta).toISOString(),config.timeZone)===local);

export function assistantTimeToIso(value:unknown,original?:string|null):string{
 if(original&&value===original)return original;
 if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/.test(value)){
  const local=value.slice(0,16),utc=new Date(value).toISOString();
  if(dateTimeInput(utc,config.timeZone)===local&&repeats(utc,local))return utc;
 }
 const local=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,'Use household local time without an offset.').parse(value);
 const utc=inputToIso(local,config.timeZone,original??undefined);
 if((!original||dateTimeInput(original,config.timeZone)!==local)&&repeats(utc,local)){
  throw new Error('This clock time occurs twice. Ask which occurrence, then use its explicit UTC offset.');
 }
 return utc;
}

export function calculateDateTime(input:unknown){
 const {from,minutes}=z.object({from:z.string(),minutes:z.number().int().min(-10080).max(10080)}).parse(input);
 const utc=new Date(Date.parse(assistantTimeToIso(from))+minutes*60000).toISOString();
 const local=dateTimeInput(utc,config.timeZone);
 let proposalTime=local;
 if(repeats(utc,local)){
  const offsetMinutes=(Date.parse(local+'Z')-Date.parse(utc))/60000;
  const sign=offsetMinutes<0?'-':'+';
  const absolute=Math.abs(offsetMinutes);
  proposalTime=local+':00'+sign+String(Math.floor(absolute/60)).padStart(2,'0')+':'+String(absolute%60).padStart(2,'0');
 }
 return {local,proposalTime,utc,timeZone:config.timeZone};
}
