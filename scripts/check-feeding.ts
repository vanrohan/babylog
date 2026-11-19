import assert from 'node:assert/strict';
import {assist} from '../src/server/assistant.ts';
import {createTestDiary} from '../tests/test-diary.ts';
import {config} from './lib/check-settings.ts';
assert(config.openrouterApiKey,'Set OPENROUTER_API_KEY for the real service check.');
const diary=await createTestDiary();
const {store}=diary;
try{
 for(const [method,feedingType] of [['breastfeeding on the left breast','Breast'],['bottle feeding','Bottle'],['formula feeding with Aptamil','Syringe']] as const){
  const reply=await assist(store,`Log ${method} from 1 AM to 2 AM on 3 November 2026. Note: 20 ml.`,'2026-11-03');
  assert(reply.proposal,JSON.stringify(reply));assert.equal(reply.proposal.operations.length,1);
  const op=reply.proposal.operations[0];assert(op.type==='create_entry');assert.equal(op.entry.activity,'feeding');assert.equal(op.entry.feedingType,feedingType);
  assert.equal(op.entry.startAt,'2026-11-03T00:00:00.000Z');assert.equal(op.entry.endAt,'2026-11-03T01:00:00.000Z');assert.match(op.entry.notes,/20/);
  await store.confirm(reply.proposal.id);console.log('PASS: real Pi uses Feeding with subtype',feedingType);
 }
 const edit=await assist(store,'Change the bottle feeding on 3 November 2026 at 1 AM to cup feeding. Keep every other field.','2026-11-03');
 assert(edit.proposal,JSON.stringify(edit));const op=edit.proposal.operations[0];assert(op.type==='update_entry');assert.equal(op.entry.activity,'feeding');assert.equal(op.entry.feedingType,'Cup');
 const old=await store.getEntry(op.id);assert.equal(old.feedingType,'Bottle');
 for(const key of ['startAt','endAt','status','notes','pee','poo','temperature'] as const)assert.equal(op.entry[key],old[key]);
 await store.confirm(edit.proposal.id);console.log('PASS: real Pi changes the subtype and preserves other fields.');
 const note=await assist(store,'Add the note \"Settled after feeding\" to the cup feeding on 3 November 2026 at 1 AM. Keep every other field.','2026-11-03');
 assert(note.proposal,JSON.stringify(note));const noteOp=note.proposal.operations[0];assert(noteOp.type==='update_entry');assert.equal(noteOp.entry.feedingType,'Cup');assert.match(noteOp.entry.notes,/Settled after feeding/i);
 for(const key of ['activity','feedingType','startAt','endAt','status','pee','poo','temperature'] as const)assert.equal(noteOp.entry[key],(await store.getEntry(noteOp.id))[key]);
 await store.confirm(note.proposal.id);console.log('PASS: a real Pi note edit preserves the feeding subtype.');
}finally{await diary.close();}
