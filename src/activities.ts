export const feedingTypes=['Breast','Bottle','Syringe','Cup','Tube'];
const aliases:Record<string,string|null>=Object.assign(Object.create(null),{feeding:null,feed:null});
for(const [type,stems] of [['Breast',['breast','breastfeed','breastfeeding','breast feeding','breast feed']],['Bottle',['bottle','bottlefeed','bottlefeeding','bottle feeding','bottle feed']],['Syringe',['syringe','syringe feeding','syringe feed']],['Cup',['cup feeding','cup feed']],['Tube',['tube feeding','tube feed']]] as [string,string[]][]){
 for(const stem of stems)aliases[stem]=type;
}
export function feedingActivity(activity:string){
 return Object.hasOwn(aliases,activity.trim().toLowerCase());
}
export function normalizeActivity(activity:string,feedingType:string|null=null){
 const key=activity.trim().toLowerCase();
 const type=feedingType?.trim()||null;
 return {activity:feedingActivity(activity)?'feeding':activity.trim(),feedingType:type?feedingTypes.find(value=>value.toLowerCase()===type.toLowerCase())??type:aliases[key]??null};
}
export function activityLabel(activity:string){
 const names:Record<string,string>={feeding:'Feeding',sleep:'Sleep',nappy:'Nappy change',bath:'Bath',note:'Note'};
 return Object.hasOwn(names,activity)?names[activity]:activity;
}
export function entryLabel(entry:{activity:string;feedingType?:string|null;breastSide?:BreastSide|null}){
 const normalized=normalizeActivity(entry.activity,entry.feedingType);
 return activityLabel(normalized.activity)+(normalized.activity==='feeding'&&normalized.feedingType?' ('+normalized.feedingType+')':'')+(normalized.feedingType==='Breast'&&entry.breastSide?' / '+({left:'Left',right:'Right',both:'Both'})[entry.breastSide]:'');
}

export type BreastSide='left'|'right'|'both';
export function inferBreastSide(notes:string):BreastSide|null{
 const text=notes.split('\n').filter(line=>!/^Source:|^Import:/i.test(line)).join('\n');
 if(/\b(?:not|no|neither|unsure|uncertain|maybe|possibly)\b|\?/i.test(text))return null;
 if(/\b(?:left\s*(?:[+/]|and)\s*right|right\s*(?:[+/]|and)\s*left|left first,? then right|right first,? then left)\b/i.test(text))return 'both';
 if(/\b(?:both breasts?|both sides|left and right|right and left)\b/i.test(text)||/^\s*both[.!]?\s*$/im.test(text))return 'both';
 const left=/\b(?:left breast|left side|breast on the left|breast: left)\b/i.test(text)||/^\s*(?:left(?=\s*(?:[.,(;]|$))|L[.!]?\s*$)/im.test(text);
 const right=/\b(?:right breast|right side|breast on the right|breast: right)\b/i.test(text)||/^\s*(?:right(?=\s*(?:[.,(;]|$))|R[.!]?\s*$)/im.test(text);
 return left&&right?'both':left?'left':right?'right':null;
}
