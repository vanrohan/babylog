import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testStore} from './postgres-fixture.ts';

const entry={activity:'nappy',startAt:'2026-11-03T10:00:17.123Z',endAt:'2026-11-03T10:10:18.456Z',notes:'Keep exact times.'};

test('concurrent save replays apply the entry and sleep changes once across connections',async()=>{
 const store=await testStore('save-replay'),peer=await testStore('save-replay');
 await store.createEntry({activity:'sleep',startAt:'2026-11-03T09:00:00Z',endAt:'2026-11-03T11:00:00Z'});
 const key=randomUUID();
 const [first,second]=await Promise.all([store.saveEntry(key,entry),peer.saveEntry(key,{...entry})]);
 assert.deepEqual(first,second);assert.equal(first.startAt,entry.startAt);assert.equal(first.endAt,entry.endAt);
 assert.equal((await store.listEntries()).filter(row=>row.activity==='nappy').length,1);
 assert.equal((await store.listEntries()).filter(row=>row.activity==='sleep').length,2);
 const snapshot=await store.exportData();
 const restarted=await testStore('save-replay');assert.deepEqual(await restarted.saveEntry(key,entry),first);
 assert.deepEqual((await restarted.exportData()).entries,snapshot.entries);
 assert.deepEqual((await restarted.exportData()).sleepSources,snapshot.sleepSources);
 assert.equal('entrySaves' in snapshot,false);
});

test('edit replay returns its receipt before stale checks and preserves one Undo receipt',async()=>{
 const store=await testStore(),original=await store.createEntry(entry),key=randomUUID();
 const input={...original,notes:'Changed notes.'};
 const saved=await store.saveEntry(key,input,original.id),undo=await store.getEntryUndo(original.id);
 assert.ok(undo);assert.equal(saved.version,2);
 assert.deepEqual(await store.saveEntry(key,input,original.id),saved);
 assert.deepEqual(await store.getEntryUndo(original.id),undo);
 await assert.rejects(store.saveEntry(randomUUID(),input,original.id),/changed on another device/);
 assert.deepEqual(await store.getEntry(original.id),saved);
});

test('changed requests conflict and replay never recreates a deleted entry',async()=>{
 const store=await testStore(),key=randomUUID(),saved=await store.saveEntry(key,entry);
 await assert.rejects(store.saveEntry(key,{...entry,notes:'New draft.'}),/already completed with different values/);
 await assert.rejects(store.saveEntry(key,{...saved,notes:'Edit.'},saved.id),/already completed with different values/);
 await store.deleteEntry(saved.id,saved.version);
 assert.deepEqual(await store.saveEntry(key,entry),saved);assert.deepEqual(await store.listEntries(),[]);
});

test('a failed receipt rolls back the entry and sleep changes and permits the same save retry',async()=>{
 const store=await testStore(),key=randomUUID();
 await store.createEntry({activity:'sleep',startAt:'2026-11-03T09:00:00Z',endAt:'2026-11-03T11:00:00Z'});
 const before=await store.exportData();
 await store.database.query(`CREATE FUNCTION fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'receipt failed'; END $$;
 CREATE TRIGGER fail_receipt BEFORE INSERT ON entry_saves FOR EACH ROW EXECUTE FUNCTION fail_receipt()`);
 await assert.rejects(store.saveEntry(key,entry),/receipt failed/);
 const after=await store.exportData();assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.sleepSources,before.sleepSources);
 assert.equal((await store.database.query('SELECT COUNT(*) AS count FROM entry_saves')).rows[0].count,'0');
 await store.database.query('DROP TRIGGER fail_receipt ON entry_saves; DROP FUNCTION fail_receipt()');
 await store.saveEntry(key,entry);assert.equal((await store.listEntries()).filter(row=>row.activity==='nappy').length,1);
});

test('a failed edit receipt preserves the entry version and prior Undo receipt before retry',async()=>{
 const store=await testStore(),original=await store.createEntry(entry);
 const current=await store.updateEntry(original.id,{...original,notes:'First edit.'},original.version);
 const priorUndo=await store.getEntryUndo(original.id),key=randomUUID(),input={...current,notes:'Second edit.'};
 await store.database.query(`CREATE FUNCTION fail_edit_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'edit receipt failed'; END $$;
 CREATE TRIGGER fail_edit_receipt BEFORE INSERT ON entry_saves FOR EACH ROW EXECUTE FUNCTION fail_edit_receipt()`);
 await assert.rejects(store.saveEntry(key,input,current.id),/edit receipt failed/);
 assert.deepEqual(await store.getEntry(current.id),current);assert.deepEqual(await store.getEntryUndo(current.id),priorUndo);
 await store.database.query('DROP TRIGGER fail_edit_receipt ON entry_saves; DROP FUNCTION fail_edit_receipt()');
 const saved=await store.saveEntry(key,input,current.id),undo=await store.getEntryUndo(current.id);
 assert.equal(saved.version,current.version+1);assert.equal(saved.notes,input.notes);assert.ok(undo);assert.notEqual(undo.id,priorUndo?.id);
 assert.deepEqual(await store.saveEntry(key,input,current.id),saved);assert.deepEqual(await store.getEntryUndo(current.id),undo);
});
