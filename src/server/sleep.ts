import type {Entry,Operation} from '../shared.ts';

export const interruptsSleep=(entry:Pick<Entry,'activity'>)=>['feeding','nappy','bath'].includes(entry.activity);

// Care without an end stops only sleep that contains its start.
export function sleepChanges(entries:Entry[],care:Entry[]):Operation[]{
 const changes:Operation[]=[];
 for(const sleep of entries.filter(entry=>entry.activity==='sleep'&&(entry.endAt||entry.status==='active'))){
  let segments=[{start:sleep.startAt,end:sleep.endAt}];
  for(const event of care.filter(interruptsSleep).sort((a,b)=>a.startAt.localeCompare(b.startAt))){
   if(!event.endAt&&sleep.startAt>event.startAt)continue;
   segments=segments.flatMap(segment=>{
    if(event.startAt>=(segment.end??'~')||(event.endAt??'~')<=segment.start)return [segment];
    const parts:typeof segments=[];
    if(segment.start<event.startAt)parts.push({start:segment.start,end:event.startAt});
    const resume=event.endAt;
    if(resume&&resume<(segment.end??'~'))parts.push({start:resume,end:segment.end});
    return parts;
   });
  }
  if(segments.length===1&&segments[0].start===sleep.startAt&&segments[0].end===sleep.endAt)continue;
  if(!segments.length){changes.push({type:'delete_entry',id:sleep.id,version:sleep.version});continue;}
  segments.forEach((segment,index)=>{
   const {id,version,createdAt,updatedAt,...entry}=sleep;
   const value={...entry,startAt:segment.start,endAt:segment.end,status:segment.end?'completed' as const:'active' as const,
    pee:index===0?entry.pee:false,poo:index===0?entry.poo:false,temperature:index===0?entry.temperature:null};
   changes.push(index===0?{type:'update_entry',id,version,entry:value}:{type:'create_entry',entry:value});
  });
 }
 return changes;
}
