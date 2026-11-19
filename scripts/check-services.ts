import assert from 'node:assert/strict';
import {once} from 'node:events';
import type {Server} from 'node:http';
import {createTestDiary,testAuth} from '../tests/test-diary.ts';
import {createApp} from '../src/server/app.ts';
import {config} from './lib/check-settings.ts';

assert(config.openrouterApiKey,'Set OPENROUTER_API_KEY for the real service check.');
assert(config.sttUrl&&config.ttsUrl,'Set STT_URL and TTS_URL for the speech service check.');
const diary=await createTestDiary();
const {store}=diary;
let server:Server|undefined;
try{
const auth=await testAuth(store,{username:'service-check',password:'Synthetic service password 123'});
server=createApp(store,undefined,auth).listen(0,'127.0.0.1');
await once(server,'listening');
const address=server.address();
assert(address&&typeof address!=='string');
const base=`http://127.0.0.1:${address.port}/api`;
const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'service-check',password:'Synthetic service password 123'}),signal:AbortSignal.timeout(25000)});
assert.equal(login.status,200,'The synthetic service login must succeed.');
const cookie=login.headers.get('set-cookie')?.split(';')[0];
assert(cookie,'The synthetic service login must set a session cookie.');
const authenticatedFetch=(url:string,init:RequestInit={})=>fetch(url,{...init,headers:{...init.headers,Cookie:cookie}});
async function post(path:string,body:unknown){
 const response=await authenticatedFetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(360_000)});
 const data=await response.json();
 assert.equal(response.status,200,JSON.stringify(data));
 return data;
}
 const speech=await authenticatedFetch(base+'/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Nappy change at ten fifteen. Pee and poo.'}),signal:AbortSignal.timeout(300_000)});
 assert.equal(speech.status,200,await (speech.ok?Promise.resolve(''):speech.text()));
 const audio=await speech.arrayBuffer();
 assert(audio.byteLength>1000);
 assert.equal(Buffer.from(audio).subarray(0,4).toString(),'RIFF');
 console.log('PASS: real TTS returns WAV with Emily.wav.',audio.byteLength,'bytes');
 const form=new FormData();
 form.append('audio',new Blob([audio],{type:'audio/wav'}),'check.wav');
 const transcription=await authenticatedFetch(base+'/transcribe',{method:'POST',body:form,signal:AbortSignal.timeout(240_000)});
 const transcript=await transcription.json();
 assert.equal(transcription.status,200,JSON.stringify(transcript));
 assert.match(transcript.text,/ten fifteen|10[:.]15/i);
 console.log('PASS: real STT transcribes TTS audio:',transcript.text);
 const add=await post('/assistant',{day:'2026-11-03',command:'Propose a nappy change on 3 November 2026 at 10:15 Europe/Berlin. Pee and poo. No notes.'});
 assert(add.proposal,JSON.stringify(add));
 assert.equal(add.proposal.operations.length,1);
 assert.equal((await store.listEntries()).length,0);
 const op=add.proposal.operations[0];
 assert.equal(op.type,'create_entry');
 assert.equal(op.entry.activity,'nappy');
 assert.equal(op.entry.startAt,'2026-11-03T09:15:00.000Z');
 assert.equal(op.entry.pee,true);assert.equal(op.entry.poo,true);
 await post('/proposals/'+add.proposal.id+'/confirm',{});
 console.log('PASS: real Pi proposes correct fields and waits for confirmation.');
 const entry=(await store.listEntries())[0];
 const edit=await post('/assistant',{day:'2026-11-05',command:'Find the nappy change on 3 November 2026 at 10:15 Europe/Berlin. Add the note "Integration check". Keep all other fields.'});
 assert(edit.proposal,JSON.stringify(edit));
 assert.equal(edit.proposal.operations.length,1);
 assert.equal(edit.proposal.operations[0].type,'update_entry');
 assert.equal(edit.proposal.operations[0].id,entry.id);
 assert.equal(edit.proposal.operations[0].entry.notes,'Integration check');
 for(const key of ['activity','startAt','endAt','status','pee','poo','temperature'] as const){
  assert.equal(edit.proposal.operations[0].entry[key],entry[key],`Pi changed ${key}`);
 }
 assert.equal(edit.proposal.targets[0].id,entry.id);
 assert.equal((await store.getEntry(entry.id)).notes,'');
 await post('/proposals/'+edit.proposal.id+'/reject',{});
 assert.equal((await store.listEntries()).length,1);
 assert.deepEqual(await store.getEntry(entry.id),entry);
 console.log('PASS: real Pi proposes an older entry update with target details. Rejection leaves it unchanged.');
 const clarification=await post('/assistant',{day:'2026-11-03',command:'Please change the time.'});
 assert.equal(clarification.proposal,null);
 assert(clarification.message.length>0);
 assert.equal((await store.listEntries()).length,1);
 assert.deepEqual(await store.getEntry(entry.id),entry);
 console.log('PASS: real Pi asks for missing details:',clarification.message);
 for(const [day,start,end] of [['2026-11-03','08','11'],['2026-07-03','07','10']]){
  const sleep=await post('/assistant',{day,command:'Add a sleep entry from 9 am to 12 noon on the selected diary date.'});
  assert(sleep.proposal,JSON.stringify(sleep));const op=sleep.proposal.operations[0];
  assert.equal(op.type,'create_entry');assert.equal(op.entry.activity,'sleep');
  assert.equal(op.entry.startAt,day+'T'+start+':00:00.000Z');assert.equal(op.entry.endAt,day+'T'+end+':00:00.000Z');
  await post('/proposals/'+sleep.proposal.id+'/reject',{});
 }
 console.log('PASS: real Pi preserves 09:00 to 12:00 Berlin time in winter and summer.');
 const formula=await post('/assistant',{day:'2026-11-03',command:'Add a formula feed at 10 am on 3 November 2026. Aptamil, 30 ml.'});
 assert(formula.proposal,JSON.stringify(formula));const feed=formula.proposal.operations[0];
 assert.equal(feed.type,'create_entry');assert.equal(feed.entry.activity,'feeding');assert.equal(feed.entry.feedingType,'Syringe');assert.match(feed.entry.notes,/30/);
 await post('/proposals/'+formula.proposal.id+'/reject',{});
 console.log('PASS: real Pi uses syringe feeding for household formula feeds.');
 const beforeWake=Date.now();
 const unfinished=await store.createEntry({activity:'sleep',startAt:new Date(beforeWake-4*3600000).toISOString(),endAt:null,status:'completed',notes:'Keep this sleep note.'});
 const wake=await post('/assistant',{day:new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin'}).format(new Date()),command:'The baby woke up 10min ago. Current sleep end time needed.'});
 assert(wake.proposal,JSON.stringify(wake));const wakeOp=wake.proposal.operations[0];
 assert.equal(wakeOp.type,'update_entry');assert.equal(wakeOp.id,unfinished.id);assert.equal(wakeOp.entry.startAt,unfinished.startAt);
 assert.equal(wakeOp.entry.notes,unfinished.notes);assert.equal(wakeOp.entry.status,'completed');
 assert(Date.parse(wakeOp.entry.endAt)>=beforeWake-11*60000&&Date.parse(wakeOp.entry.endAt)<=Date.now()-9*60000);
 assert.equal((await store.getEntry(unfinished.id)).endAt,null);await post('/proposals/'+wake.proposal.id+'/reject',{});
 console.log('PASS: real Pi proposes the obvious unfinished sleep end without another question.');
 const active=await store.createEntry({activity:'sleep',startAt:new Date(Date.now()-2*3600000).toISOString(),endAt:null,status:'active',notes:'Active sleep note.'});
 const chooseActive=await post('/assistant',{day:new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin'}).format(new Date()),command:'The baby woke up ten minutes ago. Set the current sleep end time.'});
 assert(chooseActive.proposal,JSON.stringify(chooseActive));const activeOp=chooseActive.proposal.operations[0];assert.equal(activeOp.type,'update_entry');assert.equal(activeOp.id,active.id);assert.equal(activeOp.entry.notes,active.notes);
 assert.deepEqual(await store.getEntry(unfinished.id),unfinished);await post('/proposals/'+chooseActive.proposal.id+'/reject',{});
 console.log('PASS: real Pi prefers the active sleep over an older unfinished completed sleep.');
 const followUpAt=new Date(Date.now()-5*60000).toISOString();
 const followUp=await post('/assistant',{day:new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin'}).format(new Date()),command:'Use the last sleep.',conversation:[{command:'The baby woke up ten minutes ago. Set its end time.',reply:'Which sleep should I update?',at:followUpAt}]});
 assert(followUp.proposal,JSON.stringify(followUp));const followOp=followUp.proposal.operations[0];assert.equal(followOp.type,'update_entry');assert.equal(followOp.id,active.id,JSON.stringify(followUp));
 assert(Math.abs(Date.parse(followOp.entry.endAt)-(Date.parse(followUpAt)-10*60000))<60000,JSON.stringify(followUp));await post('/proposals/'+followUp.proposal.id+'/reject',{});
 console.log('PASS: a later reply keeps the original relative wake time.');
 console.log('All service checks use a disposable database. No household data changes.');
}finally{
 try{
  if(server?.listening)await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));
 }finally{await diary.close();}
}
