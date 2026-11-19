import { test } from 'node:test';
import assert from 'node:assert/strict';
import {testStore} from './postgres-fixture.ts';
import {randomUUID} from 'node:crypto';
const entry = { activity: 'breastfeeding', startAt: '2026-11-03T22:45:00.000Z', endAt: '2026-11-03T23:15:00.000Z', status: 'completed', pee: false, poo: false, temperature: null, notes: 'Settled after feeding.' };
test('create, edit, rename, and delete a shared entry', async () => {
    const s = (await testStore());
    const a = (await s.createEntry(entry));
    assert.equal((await s.getEntry(a.id)).notes, entry.notes);
    const b = (await s.updateEntry(a.id, { ...entry, activity: 'bottle', notes: 'Renamed activity.' }, a.version));
    assert.equal(b.activity, 'feeding');
    assert.equal(b.feedingType, 'Bottle');
    await assert.rejects(async () => (await s.updateEntry(a.id, entry, a.version)), /changed/);
    (await s.deleteEntry(a.id, b.version));
    await assert.rejects(async () => (await s.getEntry(a.id)), /not found/);
    (await s.close());
});
test('validate times, temperature, dates, and complete a running sleep', async () => {
    const s = (await testStore());
    await assert.rejects(async () => (await s.createEntry({ ...entry, endAt: '2026-11-03T21:00:00Z' })));
    await assert.rejects(async () => (await s.createEntry({ ...entry, temperature: Infinity })));
    await assert.rejects(async () => (await s.createEntry({ ...entry, startAt: 'not a date' })));
    const a = (await s.createEntry({ ...entry, activity: 'sleep', status: 'active', endAt: null }));
    const b = (await s.updateEntry(a.id, { ...a, status: 'completed', endAt: '2026-11-04T02:00:00Z' }, a.version));
    assert.equal(b.status, 'completed');
    assert.equal((await s.listEntries('2026-11-04', 'Europe/Berlin')).length, 1);
    (await s.close());
});
test('daily checks remain separate by day and reject stale changes', async () => {
    const s = (await testStore());
    const a = (await s.setCare('2026-11-03', 'vitamin_d', true, 0));
    assert.equal((await s.getCare('2026-11-03')).vitamin_d.done, true);
    assert.equal((await s.getCare('2026-11-04')).vitamin_d.done, false);
    await assert.rejects(async () => (await s.setCare('2026-11-03', 'vitamin_d', false, 0)), /changed/);
    (await s.setCare('2026-11-03', 'vitamin_d', false, a.version));
    assert.equal((await s.getCare('2026-11-03')).vitamin_d.done, false);
    (await s.close());
});
test('assistant proposals do not write before confirmation and cannot repeat', async () => {
    const s = (await testStore());
    const p = (await s.propose([{ type: 'create_entry', entry }], 'Add a feeding.'));
    assert.equal((await s.listEntries()).length, 0);
    (await s.confirm(p.id));
    assert.equal((await s.listEntries()).length, 1);
    await assert.rejects(async () => (await s.confirm(p.id)), /already/);
    (await s.close());
});
test('a stale action rolls back the complete assistant batch', async () => {
    const s = (await testStore());
    const a = (await s.createEntry(entry));
    const p = (await s.propose([{ type: 'create_entry', entry: { ...entry, activity: 'sleep' } }, { type: 'update_entry', id: a.id, version: a.version, entry: { ...entry, notes: 'Assistant edit' } }], 'Two changes.'));
    (await s.updateEntry(a.id, { ...entry, notes: 'Other phone edit' }, a.version));
    await assert.rejects(async () => (await s.confirm(p.id)), /changed/);
    assert.equal((await s.listEntries()).length, 1);
    assert.equal((await s.getEntry(a.id)).notes, 'Other phone edit');
    (await s.close());
});
test('rejected and expired proposals never change the diary', async () => {
    const s = (await testStore());
    const p = (await s.propose([{ type: 'create_entry', entry }], 'Add.'));
    (await s.reject(p.id));
    await assert.rejects(async () => (await s.confirm(p.id)), /cancelled/);
    const old = (await s.propose([{ type: 'create_entry', entry }], 'Add.', new Date(Date.now() - 700000)));
    await assert.rejects(async () => (await s.confirm(old.id)), /expired/);
    assert.equal((await s.listEntries()).length, 0);
    (await s.close());
});
test('Postgres preserves entries, daily checks, and proposals across connections', async (t) => {
    const fixtureKey=randomUUID();
    const first = (await testStore(fixtureKey));
    const saved = (await first.createEntry(entry));
    (await first.setCare('2026-11-03', 'tummy_time', true, 0));
    const proposal = (await first.propose([{ type: 'update_entry', id: saved.id, version: saved.version, entry: { ...entry, notes: 'Pending edit.' } }], 'Edit feeding.'));
    (await first.close());
    const reopened = (await testStore(fixtureKey));
    t.after(async () => (await reopened.close()));
    assert.deepEqual((await reopened.getEntry(saved.id)), saved);
    assert.equal((await reopened.getCare('2026-11-03')).tummy_time.done, true);
    assert.equal((await reopened.getProposal(proposal.id)).status, 'pending');
    (await reopened.confirm(proposal.id));
    assert.equal((await reopened.getEntry(saved.id)).notes, 'Pending edit.');
});
test('two Postgres connections share records and reject stale entry and daily check changes', async (t) => {
    const fixtureKey=randomUUID();
    const phone = (await testStore(fixtureKey)), tablet = (await testStore(fixtureKey));
    t.after(async () => { (await phone.close()); (await tablet.close());  });
    const saved = (await phone.createEntry(entry));
    assert.deepEqual((await tablet.getEntry(saved.id)), saved);
    const tabletCopy = (await tablet.getEntry(saved.id));
    const changed = (await phone.updateEntry(saved.id, { ...saved, activity: 'feeding', feedingType: 'Bottle' }, saved.version));
    await assert.rejects(async () => (await tablet.updateEntry(saved.id, { ...tabletCopy, notes: 'Stale.' }, tabletCopy.version)), /changed/);
    await assert.rejects(async () => (await tablet.deleteEntry(saved.id, tabletCopy.version)), /changed/);
    assert.equal((await tablet.getEntry(saved.id)).feedingType, 'Bottle');
    (await phone.setCare('2026-11-03', 'vitamin_d', true, 0));
    await assert.rejects(async () => (await tablet.setCare('2026-11-03', 'vitamin_d', false, 0)), /changed/);
    (await tablet.deleteEntry(saved.id, changed.version));
    assert.deepEqual((await phone.listEntries()), []);
});
test('proposal validation rejects duplicate and stale targets before saving a proposal', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const saved = (await store.createEntry(entry));
    const deletion = { type: 'delete_entry', id: saved.id, version: saved.version };
    await assert.rejects(async () => (await store.propose([deletion, deletion], 'Duplicate target.')), /one change/);
    await assert.rejects(async () => (await store.propose([{ ...deletion, version: 99 }], 'Stale target.')), /changed/);
    await assert.rejects(async () => (await store.propose([
        { type: 'set_care', day: '2026-11-03', key: 'tummy_time', done: true, version: 0 },
        { type: 'set_care', day: '2026-11-03', key: 'tummy_time', done: false, version: 0 }
    ], 'Duplicate care.')), /one change/);
    assert.equal((await store.listEntries()).length, 1);
});
test('proposal review keeps exact old targets after date edits and deletion', async (t) => {
    const fixtureKey=randomUUID();
    const first = (await testStore(fixtureKey));
    const old = (await first.createEntry({ ...entry, startAt: '2026-01-02T12:00:00Z', endAt: null, notes: 'Original historical record.' }));
    const update = (await first.propose([{ type: 'update_entry', id: old.id, version: old.version, entry: { ...old, startAt: '2026-11-03T12:00:00Z', notes: 'Move to today.' } }], 'Move an old record.'));
    const deletion = (await first.propose([{ type: 'delete_entry', id: old.id, version: old.version }], 'Delete an old record.'));
    assert.deepEqual(update.targets, [old]);
    (await first.deleteEntry(old.id, old.version));
    assert.deepEqual((await first.getProposal(update.id)).targets, [old]);
    assert.deepEqual((await first.getProposal(deletion.id)).targets, [old]);
    (await first.close());
    const reopened = (await testStore(fixtureKey));
    t.after(async () => (await reopened.close()));
    assert.deepEqual((await reopened.getProposal(update.id)).targets, [old]);
    const exported = (await reopened.exportData());
    assert.deepEqual(exported.entries, []);
    assert.deepEqual(exported.deletedEntries[0].entry, old);
    assert.equal(Number.isNaN(Date.parse(String(exported.deletedEntries[0].deletedAt))), false);
    await assert.rejects(async () => (await reopened.confirm(deletion.id)), /not found/);
});
test('a failed proposal rolls back deletion archives and preserves original records', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const first = (await store.createEntry(entry));
    const second = (await store.createEntry({ ...entry, activity: 'sleep' }));
    const proposal = (await store.propose([
        { type: 'delete_entry', id: first.id, version: first.version },
        { type: 'update_entry', id: second.id, version: second.version, entry: { ...second, notes: 'Assistant update.' } }
    ], 'Delete and update.'));
    (await store.updateEntry(second.id, { ...second, notes: 'Another device.' }, second.version));
    await assert.rejects(async () => (await store.confirm(proposal.id)), /changed/);
    assert.deepEqual((await store.getEntry(first.id)), first);
    assert.deepEqual((await store.exportData()).deletedEntries, []);
    (await store.deleteEntry(first.id, first.version));
    assert.deepEqual((await store.exportData()).deletedEntries[0].entry, first);
});
test('missing endpoints start feeding and sleep timers across writes and confirmed proposals', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    for (const activity of ['sleep', 'feeding', 'breastfeeding', 'syringe feeding']) {
        const created = (await store.createEntry({ ...entry, activity, endAt: null, status: 'completed' }));
        assert.equal(created.status, 'active');
        const completed = (await store.updateEntry(created.id, { ...created, endAt: entry.endAt }, created.version));
        assert.equal(completed.status, 'completed');
        const proposal = (await store.propose([{ type: 'update_entry', id: completed.id, version: completed.version, entry: { ...completed, endAt: null } }], 'Restart timer.'));
        assert.equal(proposal.operations[0].type, 'update_entry');
        assert.equal((await store.getEntry(created.id)).status, 'completed');
        (await store.confirm(proposal.id));
        assert.equal((await store.getEntry(created.id)).status, 'active');
    }
    for (const activity of ['nappy', 'bath', 'note', 'walk'])
        assert.equal((await store.createEntry({ ...entry, activity, endAt: null })).status, 'completed');
});
test('old proposal previews cannot confirm a different timer status or partially save a batch', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const proposal = (await store.propose([{ type: 'create_entry', entry: { ...entry, activity: 'bath' } }, { type: 'create_entry', entry: { ...entry, activity: 'sleep', endAt: null } }], 'Old preview.'));
    const old = proposal.operations.map(op => op.type === 'create_entry' && op.entry.activity === 'sleep' ? { ...op, entry: { ...op.entry, status: 'completed' } } : op);
    await store.database.query('UPDATE proposals SET operations=? WHERE id=?', [JSON.stringify(old), proposal.id]);
    await assert.rejects(async () => (await store.confirm(proposal.id)), /older timer rule/);
    assert.equal((await store.listEntries()).length, 0);
    assert.equal((await store.getProposal(proposal.id)).status, 'pending');
});

test('fresh diaries omit reminder tables and diary edits leave legacy tables untouched', async t => {
    const store = await testStore();
    t.after(() => store.close());
    const legacy = ['reminders', 'subscriptions', 'reminder_deliveries', 'household_push', 'reminder_runs'];
    const tables = (await store.database.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema()")).rows;
    for (const name of legacy) assert.equal(tables.some(row => row.tablename === name), false);
    for (const name of legacy) {
        await store.database.query(`CREATE TABLE ${name} (marker TEXT)`);
        await store.database.query(`INSERT INTO ${name} VALUES ('legacy record')`);
    }
    const query = store.database.query.bind(store.database);
    const queries: string[] = [];
    t.mock.method(store.database, 'query', async (sql: string, values?: unknown[]) => {
        queries.push(sql);
        return query(sql, values);
    });
    await store.initialize();
    const saved = await store.createEntry(entry);
    const changed = await store.updateEntry(saved.id, {...saved, notes: 'Changed.'}, saved.version);
    const receipt = (await store.getEntryUndo(changed.id))!;
    const restored = await store.undoEntry(changed.id, receipt.id);
    assert.equal(restored.notes, entry.notes);
    await store.deleteEntry(restored.id, restored.version);
    assert.equal((await store.exportData()).deletedEntries[0].entry.id, saved.id);
    assert.equal(queries.some(sql => /\b(reminders|subscriptions|reminder_deliveries|household_push|reminder_runs)\b/i.test(sql)), false);
    for (const name of legacy) assert.deepEqual((await query(`SELECT * FROM ${name}`)).rows, [{marker: 'legacy record'}]);
});
