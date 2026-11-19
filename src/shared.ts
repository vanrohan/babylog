import type {BreastSide} from './activities.ts';
export interface Entry {
 sleepNotice?:string; id:string; activity:string; feedingType:string|null; breastSide?:BreastSide|null; startAt:string; endAt:string|null; status:'active'|'completed';
 pee:boolean; poo:boolean; temperature:number|null; notes:string; version:number; createdAt:string; updatedAt:string;
}
export interface CareCheck {done:boolean;version:number}
export interface EntryUndo {id:string;entryId:string;changes:Operation[];targets:Entry[];sleepChanges:number}
export const careKeys=['vitamin_d','cord','tummy_time','face_wash'] as const;
export type CareKey=string;
export interface CareTask {key:string;label:string;active:boolean;version:number}
export const careNames:Record<CareKey,string>={vitamin_d:'Vitamin D',cord:'Cord care',tummy_time:'Tummy time',face_wash:'Face wash'};
export const careLabels:Record<CareKey,string>={...careNames,vitamin_d:'Vitamin D given',cord:'Umbilical cord care'};
export type Care = Record<CareKey,CareCheck>;
export const emptyCare=():Care=>Object.fromEntries(careKeys.map(key=>[key,{done:false,version:0}])) as Care;
export type Operation =
 | {type:'create_entry';entry:Omit<Entry,'id'|'version'|'createdAt'|'updatedAt'>}
 | {type:'update_entry';id:string;version:number;entry:Omit<Entry,'id'|'version'|'createdAt'|'updatedAt'>}
 | {type:'delete_entry';id:string;version:number}
 | {type:'set_care';day:string;key:CareKey;done:boolean;version:number;taskLabel?:string;taskVersion?:number};
export interface Proposal {id:string;summary:string;operations:Operation[];targets:Entry[];sleepChanges?:Operation[];sleepTargets?:Entry[];sleepNotice?:string;status:string;createdAt:string;expiresAt:string}
export interface AssistantReply {message:string;proposal:Proposal|null;interpretedAt?:string}


export interface ConversationTurn {command:string;reply:string;at:string}
export const assistantConversationLimit=24;
export function assistantConversationError(command:string,day:string,conversation:ConversationTurn[]):string|null{
 if(conversation.length>=assistantConversationLimit)return 'This conversation reaches its limit. Start a new instruction.';
 if(new TextEncoder().encode(JSON.stringify({command,day,conversation})).length>120000)return 'This conversation is too long. Start a new instruction.';
 return null;
}

export interface User {id:string;username:string}
