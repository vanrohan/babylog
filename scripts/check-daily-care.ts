import './lib/check-settings.ts';
import assert from 'node:assert/strict';
import {assist} from '../src/server/assistant.ts';
import {createTestDiary} from '../tests/test-diary.ts';
import type {Operation} from '../src/shared.ts';
const diary=await createTestDiary();
const {store}=diary;
try{
 const reply=await assist(store,'On 3 November 2026 mark Tummy time and Face wash done in the daily checklist.','2026-11-03');
 assert(reply.proposal,'Expected a daily check proposal.');assert.equal(reply.proposal.operations.length,2);
 for(const key of ['tummy_time','face_wash'] as const){
  const op:Operation|undefined=reply.proposal.operations.find(operation=>operation.type==='set_care'&&operation.key===key);assert(op&&op.type==='set_care');assert.equal(op.day,'2026-11-03');assert.equal(op.done,true);assert.equal((await store.getCare(op.day))[key].done,false);
 }
 assert.equal((await store.listEntries()).length,0);await store.confirm(reply.proposal.id);
 assert.equal((await store.getCare('2026-11-03')).tummy_time.done,true);assert.equal((await store.getCare('2026-11-03')).face_wash.done,true);
 const task=await store.createCareTask({label:'Air out apartment'});
 const custom=await assist(store,'On 3 November 2026 mark Air out apartment done in the daily checklist.','2026-11-03');
 assert(custom.proposal,'Expected a custom daily task proposal.');assert.equal(custom.proposal.operations.length,1);
 const op=custom.proposal.operations[0];assert.equal(op.type,'set_care');
 if(op.type!=='set_care')throw new Error('Expected a daily task.');
 assert.equal(op.key,task.key);assert.equal(op.taskLabel,task.label);assert.equal(op.taskVersion,task.version);
 assert.equal((await store.getCare('2026-11-03'))[task.key].done,false);await store.confirm(custom.proposal.id);
 assert.equal((await store.getCare('2026-11-03'))[task.key].done,true);
 console.log('PASS: real Pi proposes built-in and custom daily tasks and waits for confirmation. Only a temporary diary changes.');
}finally{await diary.close();}
