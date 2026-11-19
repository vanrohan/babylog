import assert from 'node:assert/strict';
import {assist} from '../src/server/assistant.ts';
import {createTestDiary} from '../tests/test-diary.ts';
import {config} from './lib/check-settings.ts';
assert(config.openrouterApiKey,'Set OPENROUTER_API_KEY for the real service check.');
const diary=await createTestDiary();
const {store}=diary;
try{
 for(const [index,side] of ['left','right','both'].entries()){
  const hour=10+index;
  const reply=await assist(store,`Log breastfeeding on ${side==='both'?'both breasts equally':`the ${side} breast`} from ${hour}:00 to ${hour}:20 on 3 November 2026.`,'2026-11-03');
  assert(reply.proposal,'Expected a side-specific proposal.');
  const op=reply.proposal.operations[0];assert(op.type==='create_entry');assert.equal(op.entry.feedingType,'Breast');assert.equal(op.entry.breastSide,side);
  await store.confirm(reply.proposal.id);console.log('PASS: real Pi records',side);
 }
 const missing=await assist(store,'Log breastfeeding from 14:00 to 14:20 on 3 November 2026.','2026-11-03');
 assert.equal(missing.proposal,null);assert.match(missing.message,/side|which breast|left|right/i);console.log('PASS: real Pi asks for the missing side.');
 const edit=await assist(store,'Add the note Settled to the right breast feed at 11:00 on 3 November 2026. Keep every other field.','2026-11-03');
 assert(edit.proposal);const op=edit.proposal.operations[0];assert(op.type==='update_entry');assert.equal(op.entry.breastSide,'right');
 console.log('PASS: real Pi preserves the side during a note edit. Only the temporary diary changes.');
}finally{await diary.close();}
