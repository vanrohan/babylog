import { test } from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testStore, failEntryWrites} from './postgres-fixture.ts';
import type { Entry } from '../src/shared.ts';
const at = (hour: number) => `2026-11-15T${String(hour).padStart(2, '0')}:00:00.000Z`;
const sleep = { activity: 'sleep', startAt: at(1), endAt: at(7), notes: 'Original sleep.' };
const fields = (entry: Entry) => { const { version, updatedAt, ...value } = entry; return value; };
test('undo survives restart and restores all fields with exact autumn timestamps once', async () => {
    const fixtureKey=randomUUID();
    let s = (await testStore(fixtureKey));
    try {
        const old = (await s.createEntry({ activity: 'walk', startAt: '2026-10-25T00:55:17.123Z', endAt: '2026-10-25T01:10:18.123Z', notes: 'Original notes.', pee: true, temperature: 36.8 }));
        assert.equal((await s.getEntryUndo(old.id)), null);
        const edited = (await s.updateEntry(old.id, { ...old, activity: 'outside', startAt: '2026-10-25T01:00:00.000Z', notes: 'Changed.', pee: false, poo: true, temperature: null }, old.version));
        const undo = (await s.getEntryUndo(old.id))!;
        assert.equal(undo.changes.length, 1);
        (await s.close());
        s = (await testStore(fixtureKey));
        const restored = (await s.undoEntry(old.id, undo.id));
        assert.deepEqual(fields(restored), fields(old));
        assert.ok(restored.version > edited.version);
        assert.equal((await s.getEntryUndo(old.id)), null);
        await assert.rejects(async () => (await s.undoEntry(old.id, undo.id)), /no longer available/);
        await assert.rejects(async () => (await s.updateEntry(old.id, edited, edited.version)), /changed/);
    }
    finally {
        (await s.close());

    }
});
test('undo restores automatic sleep changes and source links for a later completion', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry(sleep));
        let care = (await s.createEntry({ activity: 'nappy', startAt: at(2) }));
        const before = (await s.listEntries());
        care = (await s.updateEntry(care.id, { ...care, endAt: at(3) }, care.version));
        assert.equal((await s.listEntries()).length, 3);
        const undo = (await s.getEntryUndo(care.id))!;
        assert.equal(undo.sleepChanges, 1);
        care = (await s.undoEntry(care.id, undo.id));
        assert.deepEqual((await s.listEntries()).map(fields).sort((a, b) => a.id.localeCompare(b.id)), before.map(fields).sort((a, b) => a.id.localeCompare(b.id)));
        (await s.updateEntry(care.id, { ...care, endAt: at(4) }, care.version));
        assert.deepEqual((await s.listEntries()).filter(e => e.activity === 'sleep').map(e => [e.startAt, e.endAt]).sort(), [[at(1), at(2)], [at(4), at(7)]]);
    }
    finally {
        (await s.close());
    }
});
test('undo restores a fully deleted sleep and rejects stale automatic sleep changes', async () => {
    for (const conflict of [false, true]) {
        const s = (await testStore());
        try {
            const original = (await s.createEntry(sleep)), care = (await s.createEntry({ activity: 'bath', startAt: at(0), endAt: at(1) }));
            (await s.updateEntry(care.id, { ...care, endAt: at(8) }, care.version));
            const undo = (await s.getEntryUndo(care.id))!;
            assert.equal((await s.exportData()).deletedEntries.length, 1);
            if (conflict) {
                (await s.createEntry({ ...sleep, startAt: at(4), endAt: at(5) }));
                const before = (await s.exportData());
                await assert.rejects(async () => (await s.undoEntry(care.id, undo.id)), /changed/);
                assert.deepEqual((await s.listEntries()), before.entries);
            }
            else {
                (await s.undoEntry(care.id, undo.id));
                assert.deepEqual(fields((await s.getEntry(original.id))), fields(original));
                assert.equal((await s.exportData()).deletedEntries.length, 0);
            }
        }
        finally {
            (await s.close());
        }
    }
});
test('undo rejects changed targets but permits unrelated diary writes and checks', async () => {
    const s = (await testStore());
    try {
        const old = (await s.createEntry({ activity: 'walk', startAt: at(10) }));
        const edited = (await s.updateEntry(old.id, { ...old, startAt: at(11) }, old.version));
        const undo = (await s.getEntryUndo(old.id))!;
        const other = (await s.createEntry({ activity: 'note', startAt: at(12) }));
        (await s.updateEntry(other.id, { ...other, notes: 'Unrelated.' }, other.version));
        (await s.setCare('2026-11-15', 'vitamin_d', true, 0));
        (await s.undoEntry(old.id, undo.id));
        assert.equal((await s.getEntry(old.id)).startAt, old.startAt);
        const current = (await s.getEntry(old.id));
        (await s.updateEntry(old.id, { ...current, notes: 'First.' }, current.version));
        const stale = (await s.getEntryUndo(old.id))!;
        const latest = (await s.getEntry(old.id));
        (await s.updateEntry(old.id, { ...latest, notes: 'Second.' }, latest.version));
        await assert.rejects(async () => (await s.undoEntry(old.id, stale.id)), /no longer available/);
        assert.equal((await s.getEntry(old.id)).notes, 'Second.');
        await assert.rejects(async () => (await s.undoEntry(edited.id, 'missing')), /no longer available/);
    }
    finally {
        (await s.close());
    }
});
test('undo rolls back all changes on failure and preserves the receipt for retry', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry(sleep));
        const care = (await s.createEntry({ activity: 'nappy', startAt: at(2) }));
        (await s.updateEntry(care.id, { ...care, endAt: at(3) }, care.version));
        const undo = (await s.getEntryUndo(care.id))!, before = (await s.exportData());
        await failEntryWrites(s, 'fail_undo', 'DELETE', 'undo failed', "OLD.activity='sleep'");
        await assert.rejects(async () => (await s.undoEntry(care.id, undo.id)), /undo failed/);
        assert.deepEqual((await s.listEntries()), before.entries);
        assert.deepEqual((await s.exportData()).sleepSources, before.sleepSources);
        assert.equal((await s.getEntryUndo(care.id))!.id, undo.id);
        await s.database.query('DROP TRIGGER fail_undo ON entries');
        (await s.undoEntry(care.id, undo.id));
    }
    finally {
        (await s.close());
    }
});
test('undo permits unrelated sleep and care on another day', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry(sleep));
        const care = (await s.createEntry({ activity: 'bath', startAt: at(2), endAt: at(3) }));
        (await s.updateEntry(care.id, { ...care, endAt: at(4) }, care.version));
        const undo = (await s.getEntryUndo(care.id))!;
        (await s.createEntry({ activity: 'sleep', startAt: '2026-11-16T01:00:00.000Z', endAt: '2026-11-16T07:00:00.000Z' }));
        (await s.createEntry({ activity: 'nappy', startAt: '2026-11-16T08:00:00.000Z' }));
        (await s.undoEntry(care.id, undo.id));
        assert.equal((await s.getEntry(care.id)).endAt, care.endAt);
    }
    finally {
        (await s.close());
    }
});
test('undo rejects changed sleep segments without changing any related state', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry(sleep));
        const care = (await s.createEntry({ activity: 'nappy', startAt: at(2) }));
        (await s.updateEntry(care.id, { ...care, endAt: at(3) }, care.version));
        const undo = (await s.getEntryUndo(care.id))!;
        const segment = (await s.listEntries()).find(e => e.activity === 'sleep' && e.startAt === at(3))!;
        (await s.updateEntry(segment.id, { ...segment, notes: 'Another device.' }, segment.version));
        const before = (await s.exportData());
        await assert.rejects(async () => (await s.undoEntry(care.id, undo.id)), /changed/);
        const { exportedAt: ignored, ...after } = (await s.exportData()), { exportedAt: previous, ...expected } = before;
        assert.deepEqual(after, expected);
    }
    finally {
        (await s.close());
    }
});
test('undo restores a changed sleep segment and active Breast feeding', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry(sleep));
        let feed = (await s.createEntry({ activity: 'feeding', feedingType: 'Breast', breastSide: 'left', startAt: at(2) }));
        const before = await s.listEntries();
        feed = (await s.updateEntry(feed.id, { ...feed, endAt: at(3), feedingType: 'Syringe', breastSide: null }, feed.version));
        feed = (await s.updateEntry(feed.id, { ...feed, endAt: at(4) }, feed.version));
        const second = (await s.getEntryUndo(feed.id))!;
        (await s.undoEntry(feed.id, second.id));
        assert.equal((await s.listEntries()).find(e => e.activity === 'sleep' && e.startAt === at(3))!.endAt, at(7));
        const current = (await s.getEntry(feed.id));
        (await s.updateEntry(feed.id, { ...current, endAt: null, feedingType: 'Breast', breastSide: 'left' }, current.version));
        const active = (await s.getEntry(feed.id));
        (await s.updateEntry(active.id, { ...active, startAt: at(3), endAt: at(4) }, active.version));
        const restored = (await s.undoEntry(active.id, (await s.getEntryUndo(active.id))!.id));
        assert.equal(restored.status, 'active');
        assert.equal(restored.feedingType, 'Breast');
        assert.equal(restored.breastSide, 'left');
        assert.equal(restored.endAt, null);
        assert.deepEqual((await s.listEntries()).map(fields).sort((a, b) => a.id.localeCompare(b.id)), before.map(fields).sort((a, b) => a.id.localeCompare(b.id)));
    }
    finally {
        (await s.close());
    }
});
test('undo never renews a sleep link made stale by an earlier manual edit', async () => {
    const s = (await testStore());
    try {
        const original = (await s.createEntry(sleep)), care = (await s.createEntry({ activity: 'nappy', startAt: at(2) }));
        let segment = (await s.getEntry(original.id));
        segment = (await s.updateEntry(segment.id, { ...segment, notes: 'First correction.' }, segment.version));
        (await s.updateEntry(segment.id, { ...segment, notes: 'Second correction.' }, segment.version));
        (await s.undoEntry(segment.id, (await s.getEntryUndo(segment.id))!.id));
        const result = (await s.updateEntry(care.id, { ...care, endAt: at(3) }, care.version));
        assert.match(result.sleepNotice!, /interrupted sleep changed/);
        assert.equal((await s.getEntry(segment.id)).notes, 'First correction.');
        assert.equal((await s.listEntries()).filter(entry => entry.activity === 'sleep').length, 1);
    }
    finally {
        (await s.close());
    }
});
