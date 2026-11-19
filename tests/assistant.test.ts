import { test } from 'node:test';
import assert from 'node:assert/strict';
import {testStore, testAssistantOperations, testCurrentSleepTarget} from './postgres-fixture.ts';
const entry = { activity: 'sleep', startAt: '2026-11-03T09:00', endAt: '2026-11-03T12:00', status: 'completed', pee: false, poo: false, temperature: null, notes: '' };
test('assistant sleep uses household wall time in winter and summer', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    let count = 0;
    for (const [date, from, to] of [['2026-11-03', '08', '11'], ['2026-07-03', '07', '10']]) {
        const proposal = (await store.propose((await testAssistantOperations([{ type: 'create_entry', entry: { ...entry, startAt: date + 'T09:00', endAt: date + 'T12:00' } }], store)), 'Sleep.'));
        const op = proposal.operations[0];
        assert(op.type === 'create_entry');
        assert.equal(op.entry.startAt, date + 'T' + from + ':00:00.000Z');
        assert.equal(op.entry.endAt, date + 'T' + to + ':00:00.000Z');
        assert.equal((await store.listEntries()).length, count);
        (await store.confirm(proposal.id));
        count++;
    }
    assert.equal((await store.listEntries()).length, 2);
});
test('assistant rejects offset calculations, invalid dates, spring gaps, and preserves exact unchanged autumn times', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    for (const startAt of ['2026-11-03T09:00:00+02:00', '2026-11-03T08:00:00Z', '2026-02-30T09:00', '2026-03-29T02:30']) {
        await assert.rejects(async () => (await testAssistantOperations([{ type: 'create_entry', entry: { ...entry, startAt } }], store)));
    }
    for (const startAt of ['2026-10-25T00:30:17.123Z', '2026-10-25T01:30:42.123Z']) {
        const old = (await store.createEntry({ ...entry, startAt, endAt: null }));
        const operations = (await testAssistantOperations([{ type: 'update_entry', id: old.id, version: old.version, entry: { ...old, notes: 'Keep time.' } }], store));
        const p = (await store.propose(operations, 'Keep time.'));
        (await store.confirm(p.id));
        assert.equal((await store.getEntry(old.id)).startAt, startAt);
        const local = (await store.propose((await testAssistantOperations([{ type: 'update_entry', id: old.id, version: (await store.getEntry(old.id)).version, entry: { ...old, startAt: '2026-10-25T02:30', notes: 'Local time unchanged.' } }], store)), 'Keep local time.'));
        (await store.confirm(local.id));
        assert.equal((await store.getEntry(old.id)).startAt, startAt);
    }
});
test('assistant converts each overnight endpoint across a clock change and validates the final interval', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const p = (await store.propose((await testAssistantOperations([{ type: 'create_entry', entry: { ...entry, startAt: '2026-10-24T23:00', endAt: '2026-10-25T04:00' } }], store)), 'Overnight sleep.'));
    const op = p.operations[0];
    assert(op.type === 'create_entry');
    assert.equal(Date.parse(op.entry.endAt!) - Date.parse(op.entry.startAt), 6 * 3600000);
    await assert.rejects(async () => (await store.propose((await testAssistantOperations([{ type: 'create_entry', entry: { ...entry, endAt: '2026-11-03T08:00' } }], store)), 'Invalid.')));
});
test('ambiguous autumn changes require an occurrence and validate its offset', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    await assert.rejects(async () => (await testAssistantOperations([{ type: 'create_entry', entry: { ...entry, startAt: '2026-10-25T02:30', endAt: null } }], store)), /occurs twice/);
    for (const [offset, utc] of [['+02:00', '00'], ['+01:00', '01']]) {
        const p = (await store.propose((await testAssistantOperations([{ type: 'create_entry', entry: { ...entry, startAt: '2026-10-25T02:30:00' + offset, endAt: null } }], store)), 'Repeated time.'));
        const op = p.operations[0];
        assert(op.type === 'create_entry');
        assert.equal(op.entry.startAt, '2026-10-25T' + utc + ':30:00.000Z');
    }
    await assert.rejects(async () => (await testAssistantOperations([{ type: 'create_entry', entry: { ...entry, startAt: '2026-10-25T02:30:00+03:00', endAt: null } }], store)));
});
test('ending an active sleep at a repeated wall time requires an explicit occurrence', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const old = (await store.createEntry({ ...entry, startAt: '2026-10-25T00:30:00Z', endAt: null, status: 'active' }));
    const update = (endAt: string) => [{ type: 'update_entry', id: old.id, version: old.version, entry: { ...old, status: 'completed', endAt } }];
    await assert.rejects(async () => (await testAssistantOperations(update('2026-10-25T02:30'), store)), /occurs twice/);
    for (const offset of ['+02:00', '+01:00'])
        await assert.doesNotReject(async () => (await store.propose((await testAssistantOperations(update('2026-10-25T02:30:00' + offset), store)), 'End sleep.')));
});
test('current sleep selection prefers one active record and rejects ambiguous active records', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-03T18:00:00Z') });
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const old = (await store.createEntry({ ...entry, startAt: '2026-11-03T08:00:00Z', endAt: null }));
    const latest = (await store.createEntry({ ...entry, startAt: '2026-11-03T12:00:00Z', endAt: null }));
    await store.database.query("UPDATE entries SET status='completed'");
    assert.equal((await testCurrentSleepTarget(store, 'Set the last sleep end time.'))?.id, latest.id);
    const active = (await store.createEntry({ ...entry, startAt: '2026-11-03T10:00:00Z', endAt: null, status: 'active' }));
    assert.equal((await testCurrentSleepTarget(store, 'The current sleep needs its end.'))?.id, active.id);
    assert.equal((await testCurrentSleepTarget(store, 'Change sleep on another date.')), undefined);
    assert.equal((await testCurrentSleepTarget(store, 'End the last sleep from yesterday.')), undefined);
    (await store.createEntry({ ...entry, startAt: '2026-11-03T11:00:00Z', endAt: null, status: 'active' }));
    assert.equal((await testCurrentSleepTarget(store, 'Set the current sleep end.')), undefined);
    assert.equal((await store.getEntry(old.id)).endAt, null);
});
