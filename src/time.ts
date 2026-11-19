export const householdZone='Europe/Berlin';
export function dateTimeInput(iso:string,zone=householdZone){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));
 const value=(type:string)=>parts.find(p=>p.type===type)!.value;
 return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}
export function inputToIso(value:string,zone=householdZone,originalIso?:string){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('Enter a date and time.');
 if(originalIso&&dateTimeInput(originalIso,zone)===value)return originalIso;
 const target=Date.parse(value+'Z');
 if(!Number.isFinite(target)||new Date(target).toISOString().slice(0,16)!==value)throw new Error('Enter a valid date and time.');
 let guess=target;
 for(let i=0;i<4;i++){
  const rendered=Date.parse(dateTimeInput(new Date(guess).toISOString(),zone)+'Z');
  const delta=target-rendered;
  if(!delta)return new Date(guess).toISOString();
  guess+=delta;
 }
 throw new Error('This time does not exist in the household timezone. Choose another time.');
}
export function dayInput(iso=new Date().toISOString(),zone=householdZone){return dateTimeInput(iso,zone).slice(0,10);}
