import type {Entry} from './shared.ts';
import {normalizeActivity} from './activities.ts';

export function latestCareStart(entries:Entry[],activity:string,now:number){
 return entries.filter(entry=>normalizeActivity(entry.activity).activity===activity&&Date.parse(entry.startAt)<=now)
  .reduce<Entry|null>((latest,entry)=>!latest||entry.startAt>latest.startAt?entry:latest,null);
}
export function elapsedCareTime(startAt:string,now:number){
 const minutes=Math.max(0,Math.floor((now-Date.parse(startAt))/60_000));
 return `${Math.floor(minutes/60)}h ${minutes%60}m`;
}
