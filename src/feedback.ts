import {careNames} from './shared.ts';
import type {Proposal} from './shared.ts';
import {dayInput,dateTimeInput} from './time.ts';
import {entryLabel} from './activities.ts';
export function proposalFeedback(proposal:Proposal){
 const op=proposal.operations[0];
 const entry=op.type==='create_entry'||op.type==='update_entry'?op.entry:op.type==='delete_entry'?proposal.targets?.find(e=>e.id===op.id):null;
 const day=op.type==='set_care'?op.day:entry?dayInput(entry.startAt):null;
 if(proposal.operations.length>1)return {message:`${proposal.operations.length} changes saved.`,day};
 if(op.type==='set_care')return {message:`${op.taskLabel??careNames[op.key]??'Daily task'} ${op.done?'marked done':'cleared'} (${day}).`,day};
 const action=op.type==='create_entry'?'added':op.type==='update_entry'?'updated':'deleted';
 const message=entry?`${entryLabel(entry)} ${action} (${day} ${dateTimeInput(entry.startAt).slice(11)}).`:`Entry ${action}.`;
 return {message,day};
}
