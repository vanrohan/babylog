import {z} from 'zod';
import {normalizeActivity,inferBreastSide} from '../activities.ts';
export const daySchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(x=>!Number.isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x,'Use a valid date.');
export const timeSchema=z.iso.datetime({offset:true}).transform(x=>new Date(x).toISOString());
export const entrySchema=z.object({
 activity:z.string().trim().min(1).max(80),
 feedingType:z.string().trim().min(1).max(80).nullable().default(null),
 breastSide:z.enum(['left','right','both']).nullable().optional(),
 startAt:timeSchema,
 endAt:timeSchema.nullable().default(null),
 status:z.enum(['active','completed']).default('completed'),
 pee:z.boolean().default(false), poo:z.boolean().default(false),
 temperature:z.number().finite().min(20).max(50).nullable().default(null),
 notes:z.string().max(5000).default('')
}).superRefine((x,c)=>{
 const inferred=normalizeActivity(x.activity).feedingType;
 if(inferred&&x.feedingType&&normalizeActivity(x.activity,x.feedingType).feedingType!==inferred)c.addIssue({code:'custom',message:'The feeding subtype conflicts with the activity name.'});
 if(normalizeActivity(x.activity).activity!=='feeding'&&x.feedingType!==null)c.addIssue({code:'custom',message:'Only Feeding can have a feeding subtype.'});
}).transform(x=>{const normalized=normalizeActivity(x.activity,x.feedingType);return {...x,...normalized,breastSide:normalized.feedingType==='Breast'?(x.breastSide===undefined?inferBreastSide(x.notes):x.breastSide):null,status:['sleep','feeding'].includes(normalized.activity)?(x.endAt?'completed' as const:'active' as const):x.status};}).superRefine((x,c)=>{
 if(x.endAt&&x.endAt<x.startAt)c.addIssue({code:'custom',message:'The end time must follow the start time.'});
 if(x.status==='active'&&x.endAt)c.addIssue({code:'custom',message:'An active entry cannot have an end time.'});
 if(x.status==='active'&&!['sleep','feeding'].includes(x.activity))c.addIssue({code:'custom',message:'Only Sleep and Feeding can run a timer.'});
});
export const versionSchema=z.number().int().positive();
export const careTaskLabelSchema=z.string().trim().min(1).max(80).refine(label=>!/[\u0000-\u001f\u007f]/.test(label),'Use a task name without line breaks.');
export const careTaskKeySchema=z.string().regex(/^[a-z0-9][a-z0-9_-]{0,49}$/);
export const careTaskInputSchema=z.object({label:careTaskLabelSchema});
export const careSchema=z.object({day:daySchema,key:careTaskKeySchema,done:z.boolean(),version:z.number().int().nonnegative(),taskVersion:versionSchema.optional()});
export const operationSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('create_entry'),entry:entrySchema}),
 z.object({type:z.literal('update_entry'),id:z.uuid(),version:versionSchema,entry:entrySchema}),
 z.object({type:z.literal('delete_entry'),id:z.uuid(),version:versionSchema}),
 careSchema.extend({type:z.literal('set_care')})
]);
export const operationsSchema=z.array(operationSchema).min(1).max(12);
export class AppError extends Error {constructor(message:string,public status=400){super(message);}}
export function localDay(date:Date,timeZone:string){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const get=(type:string)=>parts.find(p=>p.type===type)!.value;
 return `${get('year')}-${get('month')}-${get('day')}`;
}
