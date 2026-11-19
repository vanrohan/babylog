import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresDatabase} from '../src/server/postgres.ts';
import {PostgresStore} from '../src/server/postgres-store.ts';
import type {Entry} from '../src/shared.ts';

const connection=process.env.TEST_DATABASE_URL;
if(!connection)throw new Error('Set TEST_DATABASE_URL to an isolated test Postgres database.');
const enabled={};
const at=(hour:number)=>`2026-11-13T${String(hour).padStart(2,'0')}:00:00.000Z`;
const sleep={activity:'sleep',startAt:at(1),endAt:at(7),notes:'Original sleep.',pee:true,temperature:37};
const fields=(entry:Entry)=>{const {version,updatedAt,...value}=entry;return value;};
async function diary(t:TestContext){
 const schema='babylog_test_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:connection,max:1});
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new Pool({connectionString:connection,max:4,options:`-c search_path=${schema}`});
 const database=new PostgresDatabase(pool),store=new PostgresStore(database);
 t.after(async()=>{await database.close();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});
 await store.initialize();
 return {store,database,peer:new PostgresStore(new PostgresDatabase(pool))};
}
const sleeps=async(store:PostgresStore)=>(await store.listEntries()).filter(entry=>entry.activity==='sleep').sort((a,b)=>a.startAt.localeCompare(b.startAt));

test('Postgres preserves exact timestamps and undo state across a store restart',enabled,async t=>{
 const {store,database}=await diary(t);
 const old=await store.createEntry({activity:'walk',startAt:'2026-10-25T00:55:17.123Z',endAt:'2026-10-25T01:10:18.123Z',notes:'Original notes.',pee:true,temperature:36.8});
 const edited=await store.updateEntry(old.id,{...old,notes:'Changed.',pee:false,poo:true,temperature:null},old.version);
 const undo=await store.getEntryUndo(old.id);
 assert.ok(undo);
 const restarted=new PostgresStore(database);await restarted.initialize();
 const restored=await restarted.undoEntry(old.id,undo.id);
 assert.deepEqual(fields(restored),fields(old));assert.ok(restored.version>edited.version);
 assert.equal(await restarted.getEntryUndo(old.id),null);
 await assert.rejects(restarted.undoEntry(old.id,undo.id),/no longer available/);
 await assert.rejects(restarted.updateEntry(old.id,edited,edited.version),/changed/);
});

test('Postgres concurrent device edits accept one version and retain the winning record',enabled,async t=>{
 const {store,peer}=await diary(t);
 const entry=await store.createEntry({activity:'note',startAt:at(10)});
 const results=await Promise.allSettled([store.updateEntry(entry.id,{...entry,notes:'First device.'},entry.version),peer.updateEntry(entry.id,{...entry,notes:'Second device.'},entry.version)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 const failure=results.find(result=>result.status==='rejected');assert.ok(failure&&failure.status==='rejected');assert.match(failure.reason.message,/changed/);
 const saved=await store.getEntry(entry.id);assert.equal(saved.version,2);
 assert.ok(['First device.','Second device.'].includes(saved.notes));
});

test('Postgres task rename preserves checks and concurrent duplicate names fail',enabled,async t=>{
 const {store,peer}=await diary(t);
 const results=await Promise.allSettled([store.createCareTask({label:'Go outside'}),peer.createCareTask({label:'go OUTSIDE'})]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 const result=results.find(result=>result.status==='fulfilled');assert.ok(result&&result.status==='fulfilled');
 const task=result.value;await store.setCare('2026-11-13',task.key,true,0,task.version);
 const renamed=await store.updateCareTask(task.key,{label:'Stroll outside'},task.version);
 assert.equal(renamed.key,task.key);assert.deepEqual((await store.getCare('2026-11-13'))[task.key],{done:true,version:1});
 await assert.rejects(store.setCare('2026-11-13',task.key,false,1,task.version),/changed/);
 await store.removeCareTask(task.key,renamed.version);
 await assert.rejects(store.setCare('2026-11-13',task.key,false,1),/removed/);
 assert.deepEqual((await store.listCareTasks()).filter(task=>task.active).map(task=>task.key),['vitamin_d','tummy_time','face_wash']);
});

test('Postgres sleep completion and undo preserve source links and a later completion',enabled,async t=>{
 const {store}=await diary(t);
 await store.createEntry(sleep);
 let care=await store.createEntry({activity:'nappy',startAt:at(2)});
 assert.deepEqual((await sleeps(store)).map(e=>[e.startAt,e.endAt]),[[at(1),at(2)]]);
 const before=await store.listEntries();care=await store.updateEntry(care.id,{...care,endAt:at(3)},care.version);
 assert.deepEqual((await sleeps(store)).map(e=>[e.startAt,e.endAt]),[[at(1),at(2)],[at(3),at(7)]]);
 const undo=await store.getEntryUndo(care.id);assert.ok(undo);
 care=await store.undoEntry(care.id,undo.id);
 assert.deepEqual((await store.listEntries()).map(fields).sort((a,b)=>a.id.localeCompare(b.id)),before.map(fields).sort((a,b)=>a.id.localeCompare(b.id)));
 await store.updateEntry(care.id,{...care,endAt:at(4)},care.version);
 assert.deepEqual((await sleeps(store)).map(e=>[e.startAt,e.endAt]),[[at(1),at(2)],[at(4),at(7)]]);
});

test('Postgres proposal preview rolls back writes and concurrent confirmation applies once',enabled,async t=>{
 const {store,peer}=await diary(t);
 await store.createEntry(sleep);
 const proposal=await store.propose([{type:'create_entry',entry:{activity:'feeding',startAt:at(2),endAt:at(3)}}],'Feed.');
 assert.equal(proposal.sleepChanges?.length,2);assert.equal((await store.listEntries()).length,1);
 const results=await Promise.allSettled([store.confirm(proposal.id),peer.confirm(proposal.id)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal((await store.listEntries()).filter(entry=>entry.activity==='feeding').length,1);
 assert.deepEqual((await sleeps(store)).map(e=>[e.startAt,e.endAt]),[[at(1),at(2)],[at(3),at(7)]]);
 assert.equal((await store.getProposal(proposal.id)).status,'confirmed');
});

test('Postgres stale sleep preview rejects without partial care writes',enabled,async t=>{
 const {store}=await diary(t);await store.createEntry(sleep);
 const proposal=await store.propose([{type:'create_entry',entry:{activity:'nappy',startAt:at(2),endAt:at(3)}}],'Nappy.');
 await store.createEntry({...sleep,startAt:at(0)});
 await assert.rejects(store.confirm(proposal.id),/changed/);
 assert.equal((await store.listEntries()).filter(entry=>entry.activity==='nappy').length,0);
 assert.equal((await store.getProposal(proposal.id)).status,'pending');
});

test('Postgres failed batch confirmation restores prior operations and proposal state',enabled,async t=>{
 const {store}=await diary(t);const task=await store.createCareTask({label:'Air out room'});
 const proposal=await store.propose([{type:'create_entry',entry:{activity:'note',startAt:at(9)}},{type:'set_care',day:'2026-11-13',key:task.key,done:true,version:0}],'Care.');
 await store.removeCareTask(task.key,task.version);
 await assert.rejects(store.confirm(proposal.id),/removed/);
 assert.equal((await store.listEntries()).length,0);assert.equal((await store.getProposal(proposal.id)).status,'pending');
 const recovery=await store.createEntry({activity:'note',startAt:at(10)});assert.equal(recovery.version,1);
});

test('Postgres failed automatic sleep changes roll back entries and source state',enabled,async t=>{
 const {store,database}=await diary(t);await store.createEntry(sleep);
 const before=await store.exportData();
 await database.query(`CREATE FUNCTION fail_split() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.activity='sleep' THEN RAISE EXCEPTION 'split failed'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_split BEFORE UPDATE ON entries FOR EACH ROW EXECUTE FUNCTION fail_split()`);
 await assert.rejects(store.createEntry({activity:'feeding',startAt:at(2),endAt:at(3)}),/split failed/);
 const after=await store.exportData();assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.sleepSources,before.sleepSources);
 await database.query('DROP TRIGGER fail_split ON entries; DROP FUNCTION fail_split()');
 await store.createEntry({activity:'feeding',startAt:at(2),endAt:at(3)});assert.equal((await sleeps(store)).length,2);
});

test('Postgres reconnects after the server closes an idle pooled connection',enabled,async t=>{
 const {store,database}=await diary(t);
 const entry=await store.createEntry({activity:'note',startAt:at(10),notes:'Keep after reconnect.'});
 const client=await database.pool.connect();const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 client.release();
 const closed=new Promise<void>(resolve=>database.pool.once('error',()=>resolve()));
 const admin=new Pool({connectionString:connection,max:1});
 try{await admin.query('SELECT pg_terminate_backend($1)',[pid]);await closed;}
 finally{await admin.end();}
 assert.equal((await store.getEntry(entry.id)).notes,entry.notes);
});

test('Postgres exports hold one snapshot while another device waits to edit sleep',enabled,async t=>{
 const {store,database,peer}=await diary(t);await store.createEntry(sleep);
 const care=await store.createEntry({activity:'nappy',startAt:at(2)});
 const gate=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};};
 const firstRead=gate(),resumeExport=gate(),editLock=gate();
 const query=database.query.bind(database);
 let readsFinished=false,editFinished=false,lockAvailable:boolean|undefined;
 database.query=(async(sql:string,values:unknown[]=[])=>{
  const result=await query(sql,values);
  if(sql==='SELECT state FROM sleep_sources ORDER BY id'){firstRead.release();await resumeExport.promise;}
  if(sql==='SELECT * FROM deleted_entries ORDER BY "deletedAt"')readsFinished=true;
  return result;
 }) as typeof database.query;
 const exported=store.exportData();await firstRead.promise;
 const connect=peer.database.pool.connect.bind(peer.database.pool);
 peer.database.pool.connect=(async()=>{
  const client=await connect(),clientQuery=client.query.bind(client);
  client.query=(async(...args:any[])=>{
   if(args[0]==='SELECT pg_advisory_xact_lock($1,$2)'){
    const probe=await clientQuery('SELECT pg_try_advisory_xact_lock($1,$2) AS available',args[1]);
    lockAvailable=probe.rows[0].available;editLock.release();
   }
   return (clientQuery as (...input:any[])=>unknown)(...args);
  }) as typeof client.query;
  return client;
 }) as typeof peer.database.pool.connect;
 const edited=peer.updateEntry(care.id,{...care,endAt:at(3)},care.version).then(result=>{
  editFinished=true;assert.equal(readsFinished,true);return result;
 });
 try{
  await editLock.promise;
  assert.equal(lockAvailable,false);assert.equal(editFinished,false);assert.equal(readsFinished,false);
 }finally{resumeExport.release();}
 const [snapshot,changed]=await Promise.all([exported,edited]);
 assert.equal(snapshot.entries.find(entry=>entry.id===care.id)?.endAt,null);assert.equal(changed.endAt,at(3));
 for(const source of snapshot.sleepSources)for(const linked of [...source.segments,...source.care]){
  const actual=snapshot.entries.find(entry=>entry.id===linked.id);assert.ok(actual);
  assert.equal(actual.version,linked.version);assert.equal(actual.endAt,linked.endAt);
 }
});
