import {test} from 'node:test';
import assert from 'node:assert/strict';
import {proposalFeedback} from '../src/feedback.ts';
import type {Proposal,Entry,Operation} from '../src/shared.ts';
const entry:Entry={id:'entry',activity:'nappy',feedingType:null,startAt:'2026-11-03T09:15:00Z',endAt:null,status:'completed',pee:true,poo:false,temperature:null,notes:'',version:1,createdAt:'2026-11-03T09:15:00Z',updatedAt:'2026-11-03T09:15:00Z'};
const proposal=(operations:Operation[]):Proposal=>({id:'proposal',summary:'A proposed change.',operations,targets:[entry],status:'confirmed',createdAt:'2026-11-03T09:16:00Z',expiresAt:'2026-11-03T09:26:00Z'});
test('confirmation feedback identifies the action, activity, household date, and time',()=>{
 assert.deepEqual(proposalFeedback(proposal([{type:'create_entry',entry}])),{message:'Nappy change added (2026-11-03 10:15).',day:'2026-11-03'});
 assert.equal(proposalFeedback(proposal([{type:'update_entry',id:entry.id,version:1,entry:{...entry,activity:'bath'}}])).message,'Bath updated (2026-11-03 10:15).');
 assert.equal(proposalFeedback(proposal([{type:'delete_entry',id:entry.id,version:1}])).message,'Nappy change deleted (2026-11-03 10:15).');
 assert.deepEqual(proposalFeedback(proposal([{type:'set_care',day:'2026-11-02',key:'vitamin_d',done:false,version:1}])),{message:'Vitamin D cleared (2026-11-02).',day:'2026-11-02'});
 assert.deepEqual(proposalFeedback(proposal([{type:'create_entry',entry},{type:'set_care',day:'2026-11-03',key:'cord',done:true,version:0}])),{message:'2 changes saved.',day:'2026-11-03'});
});

test('daily check feedback names Tummy time and Face wash for completion and clearing',()=>{
 for(const [key,label] of [['tummy_time','Tummy time'],['face_wash','Face wash']] as const){
  for(const done of [true,false])assert.deepEqual(proposalFeedback(proposal([{type:'set_care',day:'2026-11-03',key,done,version:0}])),{message:`${label} ${done?'marked done':'cleared'} (2026-11-03).`,day:'2026-11-03'});
 }
});
