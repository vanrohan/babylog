import './lib/check-settings.ts';
import assert from 'node:assert/strict';
import {assist} from '../src/server/assistant.ts';
import {createTestDiary} from '../tests/test-diary.ts';
const diary=await createTestDiary();
const {store}=diary;
try{
 for(const [now,command,start,end] of [
  ['2026-11-07T02:23:00Z','Log a sleeping session from 1 to 3.','2026-11-07T00:00:00.000Z','2026-11-07T02:00:00.000Z'],
  ['2026-11-03T17:10:00Z','Add a breastfeeding session that started at 17:55. Note: right.','2026-11-03T16:55:00.000Z',null],
  ['2026-11-03T17:10:00Z','Add a nappy change at 17h55. Pee only.','2026-11-03T16:55:00.000Z',null],
  ['2027-01-01T00:00:00Z','Add a nappy change at 11 pm. Pee only.','2026-12-31T22:00:00.000Z',null],
  ['2026-11-04T00:00:00Z','We changed the nappy at 11 pm. Poo only.','2026-11-03T22:00:00.000Z',null],
  ['2026-11-04T00:00:00Z','She slept from 11 pm to 12:30 am.','2026-11-03T22:00:00.000Z','2026-11-03T23:30:00.000Z'],
  ['2026-11-04T00:00:00Z','Add a nappy change today at 11 pm. Pee only.','2026-11-04T22:00:00.000Z',null],
  ['2026-11-06T16:26:00Z','A sleeping session has started at 4.55.','2026-11-06T15:55:00.000Z',null],
  ['2026-11-06T04:26:00Z','A sleeping session has started at 4.55.','2026-11-06T03:55:00.000Z',null],
  ['2026-11-05T23:20:00Z','Sleep started at 11:55.','2026-11-05T22:55:00.000Z',null],
  ['2026-11-05T23:20:00Z','She slept from 11 to 12:10.','2026-11-05T22:00:00.000Z','2026-11-05T23:10:00.000Z'],
  ['2026-11-06T16:26:00Z','Sleep started at 04:55.','2026-11-06T03:55:00.000Z',null],
  ['2026-11-06T16:26:00Z','Sleep started at 4:55 this morning.','2026-11-06T03:55:00.000Z',null],
 ] as const){
  const reply=await assist(store,command,'2026-10-01',[],new Date(now));
  assert(reply.proposal,JSON.stringify(reply));assert.equal(reply.proposal.operations.length,1);
  const op=reply.proposal.operations[0];assert(op.type==='create_entry');assert.equal(op.entry.startAt,start,JSON.stringify(reply));assert.equal(op.entry.endAt,end,JSON.stringify(reply));
  if(command.includes('breastfeeding')){assert.equal(op.entry.activity,'feeding');assert.equal(op.entry.feedingType,'Breast');assert.equal(op.entry.status,'active');assert.equal(op.entry.breastSide,'right');}
  if(/sleep/i.test(command)&&!end)assert.equal(op.entry.status,'active');
  assert.equal((await store.listEntries()).length,0);await store.reject(reply.proposal.id);
  console.log('PASS: real Pi date rule:',command);
 }
 const continued=await assist(store,'Pee only.','2026-10-01',[{command:'Add a nappy change at 11 pm.',reply:'Which findings should I record?',at:'2026-11-04T00:00:00Z'}],new Date('2026-11-04T22:50:00Z'));
 assert(continued.proposal,JSON.stringify(continued));assert.equal(continued.proposal.operations.length,1);
 const op=continued.proposal.operations[0];assert(op.type==='create_entry');assert.equal(op.entry.startAt,'2026-11-03T22:00:00.000Z',JSON.stringify(continued));assert(op.entry.pee);assert.equal(op.entry.poo,false);assert.equal((await store.listEntries()).length,0);
 console.log('PASS: a later reply keeps the original undated event date.');
 const original='A sleeping session has started at 4.55.';
 for(const correction of ['AM obviously','AM']){
  const reply=await assist(store,correction,'2026-10-01',[{command:'Log a sleeping session from 1 to 3.',reply:'Add sleep 2026-11-06 13:00-15:00 (completed). Changes cancelled. Nothing is saved. Tell me what to change.',at:'2026-11-07T02:23:00Z'}],new Date('2026-11-07T23:30:00Z'));
  assert(reply.proposal,JSON.stringify(reply));assert.equal(reply.proposal.operations.length,1);
  const operation=reply.proposal.operations[0];assert(operation.type==='create_entry');assert.equal(operation.entry.activity,'sleep');
  assert.equal(operation.entry.startAt,'2026-11-07T00:00:00.000Z');assert.equal(operation.entry.endAt,'2026-11-07T02:00:00.000Z');assert.equal(operation.entry.status,'completed');
  assert.equal((await store.listEntries()).length,0);await store.reject(reply.proposal.id);
  console.log('PASS: first cancelled-interval correction:',correction);
 }
 const question='What time did the sleep session start: 4:55 AM or 4:55 PM?';
 for(const [command,now,expected] of [
  ['Pm','2026-11-06T16:27:00Z','2026-11-06T15:55:00.000Z'],
  ['p.m.','2026-11-06T16:27:00Z','2026-11-06T15:55:00.000Z'],
  ['AM','2026-11-06T16:27:00Z','2026-11-06T03:55:00.000Z'],
  ['PM','2026-11-06T23:30:00Z','2026-11-06T15:55:00.000Z'],
 ] as const){
  const reply=await assist(store,command,'2026-10-01',[{command:original,reply:question,at:'2026-11-06T16:26:00Z'}],new Date(now));
  assert(reply.proposal,JSON.stringify(reply));assert.equal(reply.proposal.operations.length,1);
  const op=reply.proposal.operations[0];assert(op.type==='create_entry');assert.equal(op.entry.activity,'sleep');
  assert.equal(op.entry.startAt,expected,JSON.stringify(reply));assert.equal(op.entry.status,'active');assert.equal(op.entry.endAt,null);
  assert.equal((await store.listEntries()).length,0);await store.reject(reply.proposal.id);
  console.log('PASS: short time reply:',command,now);
 }
 const batch=await assist(store,'Pm','2026-10-01',[{command:'Sleep started at 4.55. Add a pee-only nappy change at 5:10 am.',reply:question,at:'2026-11-06T16:26:00Z'}],new Date('2026-11-06T16:27:00Z'));
 assert(batch.proposal,JSON.stringify(batch));assert.equal(batch.proposal.operations.length,2);
 assert.deepEqual(batch.proposal.operations.map(op=>{assert(op.type==='create_entry');return op.entry.activity;}).sort(),['nappy','sleep']);
 for(const op of batch.proposal.operations){
  assert(op.type==='create_entry');assert.equal(op.entry.startAt,op.entry.activity==='sleep'?'2026-11-06T15:55:00.000Z':'2026-11-06T04:10:00.000Z');
  if(op.entry.activity==='nappy'){assert(op.entry.pee);assert.equal(op.entry.poo,false);}
 }
 assert.equal((await store.listEntries()).length,0);await store.reject(batch.proposal.id);
 console.log('PASS: PM clarification preserves another event with explicit AM.');
 const historical=await assist(store,'Add a bath on 1 November 2026 at 4:55.','2026-10-01',[],new Date('2026-11-06T16:26:00Z'));
 assert.equal(historical.proposal,null,JSON.stringify(historical));assert.match(historical.message,/AM|PM|morning|afternoon/i);
 assert.equal((await store.listEntries()).length,0);
 console.log('PASS: an unresolved historical clock time still needs clarification.');
}finally{await diary.close();}
