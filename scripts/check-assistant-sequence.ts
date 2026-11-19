import './lib/check-settings.ts';
import assert from 'node:assert/strict';
import {assist} from '../src/server/assistant.ts';
import {createTestDiary} from '../tests/test-diary.ts';
import type {ConversationTurn,AssistantReply} from '../src/shared.ts';

const original='At 7.45 a breastfeeding session started on the left breast for 10 minutes. Then there was a 10 minute gap and then the nappy change happened. There was pee and poo discovered. That took about 10 minutes. at 20:25 the right breastfeeding session started and is now in progress.';
const now=new Date('2026-11-06T19:41:00Z');
const diary=await createTestDiary();
const {store}=diary;
async function check(reply:AssistantReply,day='2026-11-06',nappy='20:05',previousDay=day){
 assert(reply.proposal,JSON.stringify(reply));assert.equal(reply.proposal.operations.length,3,JSON.stringify(reply));
 const entries=reply.proposal.operations.map(op=>{assert(op.type==='create_entry');return op.entry;});
 assert.equal(entries.filter(e=>e.activity==='feeding').length,2);assert.equal(entries.filter(e=>e.activity==='nappy').length,1);
 const left=entries.find(e=>e.breastSide==='left')!,right=entries.find(e=>e.breastSide==='right')!,change=entries.find(e=>e.activity==='nappy')!;
 const overnight=day!==previousDay;
 assert(left);assert(right);assert.equal(left.feedingType,'Breast');assert.equal(right.feedingType,'Breast');
 assert.equal(left.startAt,previousDay+(overnight?'T22:45:00.000Z':'T18:45:00.000Z'));
 assert.equal(left.endAt,previousDay+(overnight?'T22:55:00.000Z':'T18:55:00.000Z'));assert.equal(left.status,'completed');
 const nappyStart=new Date(`${day}T${nappy}:00+01:00`);
 assert.equal(change.startAt,nappyStart.toISOString());assert.equal(change.endAt,new Date(nappyStart.getTime()+10*60000).toISOString());
 assert(change.pee);assert(change.poo);assert.match(change.notes,/about|approximately|approx\.?|~/i);assert.match(change.notes,/10/);
 assert.equal(right.startAt,overnight?previousDay+'T23:25:00.000Z':day+'T19:25:00.000Z');assert.equal(right.endAt,null);assert.equal(right.status,'active');
 assert.equal((await store.listEntries()).length,0);await store.reject(reply.proposal.id);
}
try{
 await check(await assist(store,original,'2026-10-01',[],now));
 console.log('PASS: screenshot instruction resolves all three events without a question.');
 const history:ConversationTurn[]=[
  {command:original,reply:'What time did the 7:45 breastfeeding session happen, today or yesterday?',at:now.toISOString()},
  {command:'Today',reply:'Left feed at 07:45, nappy at 08:05, right feed at 20:25. Changes cancelled. Nothing is saved. Tell me what to change.',at:now.toISOString()},
  {command:'Pm',reply:'What time did the nappy change happen?',at:now.toISOString()},
 ];
 await check(await assist(store,'20:05','2026-10-01',history,now));
 console.log('PASS: screenshot replies preserve today, PM, sides, durations, and both findings.');
 await check(await assist(store,'Move only the nappy change to 20:10 instead.','2026-10-01',[{command:original,reply:'Left 19:45-19:55, nappy 20:05, right 20:25 active. Changes cancelled. Nothing is saved.',at:now.toISOString()}],now),'2026-11-06','20:10');
 console.log('PASS: explicit nappy correction keeps both feeding times.');
 const overnight=original.replace('7.45','23:45').replace('20:25','00:25');
 await check(await assist(store,overnight,'2026-10-01',[],new Date('2026-11-06T23:41:00Z')),'2026-11-07','00:05','2026-11-06');
 console.log('PASS: duration and gap calculations cross midnight.');
 const missing=await assist(store,'Left breastfeeding at 19:45 for 10 minutes. A nappy change with pee and poo happened at another time, time unknown. Right breastfeeding at 20:25 is in progress.','2026-10-01',[],now);
 assert.equal(missing.proposal,null,JSON.stringify(missing));assert.match(missing.message,/nappy/i);assert.equal((await store.listEntries()).length,0);
 console.log('PASS: an unknown time without a stated gap still requires clarification.');
 const old=await store.createEntry({activity:'nappy',startAt:'2026-11-06T18:05:05.456Z',endAt:'2026-11-06T18:15:17.123Z',status:'completed',pee:true,poo:true,notes:'About ten minutes. Keep this note.'});
 const edit=await assist(store,'For the nappy change on 6 November 2026 at 19:05, change only its start time to 19:10. Keep its end time and other details.','2026-10-01',[],now);
 assert(edit.proposal,JSON.stringify(edit));assert.equal(edit.proposal.operations.length,1);
 const operation=edit.proposal.operations[0];assert(operation.type==='update_entry');assert.equal(operation.id,old.id);
 assert.equal(operation.entry.startAt,'2026-11-06T18:10:00.000Z');assert.equal(operation.entry.endAt,old.endAt);
 assert.equal(operation.entry.notes,old.notes);assert(operation.entry.pee);assert(operation.entry.poo);
 assert.equal((await store.getEntry(old.id)).startAt,old.startAt);await store.reject(edit.proposal.id);
 console.log('PASS: an existing start-only edit preserves the exact end and other fields.');
}finally{await diary.close();}
