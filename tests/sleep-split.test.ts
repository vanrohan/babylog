import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresStore as Store } from '../src/server/postgres-store.ts';
import {testStore, failEntryWrites} from './postgres-fixture.ts';
import type { Entry } from '../src/shared.ts';
import {randomUUID} from 'node:crypto';
const at = (hour: number) => `2026-11-13T${String(hour).padStart(2, '0')}:00:00.000Z`;
const sleep = { activity: 'sleep', startAt: at(1), endAt: at(6), notes: 'Original sleep.', pee: true, temperature: 37 };
const care = (activity = 'feeding', start = 2, end: number | null = 3) => ({ activity, startAt: at(start), endAt: end === null ? null : at(end) });
const sleeps = async (s: Store) => (await s.listEntries()).filter(e => e.activity === 'sleep').sort((a, b) => a.startAt.localeCompare(b.startAt));
test('timed care splits sleep and keeps findings once', async () => {
    for (const activity of ['feeding', 'nappy', 'bath']) {
        const s = (await testStore());
        try {
            const original = (await s.createEntry(sleep));
            (await s.createEntry(care(activity)));
            const rows = (await sleeps(s));
            assert.equal(rows.length, 2);
            assert.equal(rows[0].id, original.id);
            assert.equal(rows[0].version, 2);
            assert.deepEqual(rows.map(e => [e.startAt, e.endAt]), [[at(1), at(2)], [at(3), at(6)]]);
            assert.ok(rows.every(e => e.notes === sleep.notes));
            assert.equal(rows.filter(e => e.pee).length, 1);
            assert.equal(rows[1].temperature, null);
        }
        finally {
            (await s.close());
        }
    }
});
test('care without an end stops sleep and adding an end resumes once', async () => {
    for (const activity of ['feeding', 'nappy', 'bath']) {
        const s = (await testStore());
        try {
            (await s.createEntry(sleep));
            const event = (await s.createEntry(care(activity, 2, null)));
            assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), [[at(1), at(2)]]);
            const edit = (await s.updateEntry(event.id, { ...event, notes: 'Care note.' }, event.version));
            assert.equal((await sleeps(s)).length, 1);
            const complete = (await s.updateEntry(edit.id, { ...edit, endAt: at(3) }, edit.version));
            assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), [[at(1), at(2)], [at(3), at(6)]]);
            (await s.updateEntry(complete.id, { ...complete, notes: 'Complete.' }, complete.version));
            assert.equal((await sleeps(s)).length, 2);
            assert.equal((await s.exportData()).sleepSources.length, 1);
        }
        finally {
            (await s.close());
        }
    }
});
test('care edits split all overlaps and leave custom activities unchanged', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry(sleep));
        (await s.createEntry({ ...sleep, startAt: '2026-11-13T01:30:00.000Z', endAt: at(5) }));
        const event = (await s.createEntry(care('walk')));
        assert.equal((await sleeps(s)).length, 2);
        const changed = (await s.updateEntry(event.id, { ...event, activity: 'bath' }, event.version));
        assert.equal((await sleeps(s)).length, 4);
        await assert.rejects(async () => (await s.updateEntry(event.id, care('bath', 4, 5), event.version)), /changed/);
        assert.equal((await sleeps(s)).length, 4);
        (await s.updateEntry(changed.id, { ...changed, startAt: at(4), endAt: at(5) }, changed.version));
        assert.equal((await sleeps(s)).length, 5);
        (await s.deleteEntry(changed.id, changed.version + 1));
        assert.equal((await sleeps(s)).length, 5);
    }
    finally {
        (await s.close());
    }
});
test('boundary care never creates zero duration sleep and covered sleep is archived', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry(sleep));
        (await s.createEntry(care('bath', 0, 1)));
        (await s.createEntry(care('bath', 6, 7)));
        assert.equal((await sleeps(s))[0].version, 1);
        (await s.createEntry(care('bath', 0, 3)));
        assert.equal((await sleeps(s))[0].startAt, at(3));
        (await s.createEntry(care('bath', 5, 7)));
        assert.equal((await sleeps(s))[0].endAt, at(5));
        const id = (await sleeps(s))[0].id;
        (await s.createEntry(care('bath', 3, 5)));
        assert.equal((await sleeps(s)).length, 0);
        assert.ok((await s.database.query('SELECT * FROM deleted_entries WHERE id=?', [id])).rows[0]);
    }
    finally {
        (await s.close());
    }
});
test('active sleep resumes after timed care and midnight keeps exact UTC boundaries', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry({ ...sleep, startAt: '2026-10-24T22:00:17.123Z', endAt: null }));
        (await s.createEntry({ ...care(), startAt: '2026-10-25T00:55:17.123Z', endAt: '2026-10-25T01:10:17.123Z' }));
        const rows = (await sleeps(s));
        assert.equal(rows[0].endAt, '2026-10-25T00:55:17.123Z');
        assert.equal(rows[1].startAt, '2026-10-25T01:10:17.123Z');
        assert.equal(rows[1].status, 'active');
        assert.equal(rows[1].endAt, null);
    }
    finally {
        (await s.close());
    }
});
test('assistant previews sleep changes, rejects stale context, and confirms once', async () => {
    const s = (await testStore());
    try {
        const original = (await s.createEntry(sleep));
        const operations = [{ type: 'create_entry' as const, entry: care() }];
        const preview = (await s.propose(operations, 'Feed.'));
        assert.equal(preview.sleepChanges?.length, 2);
        assert.equal((await sleeps(s)).length, 1);
        assert.ok(preview.sleepTargets?.some(e => e.id === original.id));
        (await s.createEntry({ ...sleep, startAt: at(0) }));
        await assert.rejects(async () => (await s.confirm(preview.id)), /changed/);
        assert.equal((await s.listEntries()).filter(e => e.activity === 'feeding').length, 0);
        const next = (await s.propose(operations, 'Feed.'));
        (await s.confirm(next.id));
        assert.equal((await sleeps(s)).length, 4);
        await assert.rejects(async () => (await s.confirm(next.id)), /already/);
    }
    finally {
        (await s.close());
    }
});
test('assistant batches calculate sleep changes from the final state in either order', async () => {
    for (const reverse of [false, true]) {
        const s = (await testStore());
        try {
            const ops = [{ type: 'create_entry', entry: sleep }, { type: 'create_entry', entry: care('feeding', 2, 4) }, { type: 'create_entry', entry: care('bath', 3, 5) }];
            const p = (await s.propose(reverse ? ops.reverse() : ops, 'Sleep and care.'));
            assert.equal((await s.listEntries()).length, 0);
            (await s.confirm(p.id));
            assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), [[at(1), at(2)], [at(5), at(6)]]);
        }
        finally {
            (await s.close());
        }
    }
});
test('a failed automatic sleep write rolls back care and sleep', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry(sleep));
        const before = (await s.exportData());
        await failEntryWrites(s, 'fail_split', 'UPDATE', 'split failed', "OLD.activity='sleep'");
        await assert.rejects(async () => (await s.createEntry(care())), /split failed/);
        const after = (await s.exportData());
        assert.deepEqual(after.entries, before.entries);
    }
    finally {
        (await s.close());
    }
});
test('an unfinished old feed leaves later separate sleep records unchanged', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry(sleep));
        const later = (await s.createEntry({ ...sleep, startAt: at(7), endAt: at(8) }));
        (await s.createEntry(care('feeding', 4, null)));
        assert.equal((await sleeps(s)).length, 2);
        assert.equal((await sleeps(s))[0].endAt, at(4));
        assert.deepEqual((await s.getEntry(later.id)), later);
    }
    finally {
        (await s.close());
    }
});
test('equal-start care in a batch produces the same sleep result in either order', async () => {
    for (const reverse of [false, true]) {
        const s = (await testStore());
        try {
            (await s.createEntry(sleep));
            const ops = [{ type: 'create_entry', entry: care('feeding', 2, null) }, { type: 'create_entry', entry: care('bath', 2, 3) }];
            const p = (await s.propose(reverse ? ops.reverse() : ops, 'Care.'));
            (await s.confirm(p.id));
            assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), [[at(1), at(2)]]);
        }
        finally {
            (await s.close());
        }
    }
});
test('old sleep without a known duration remains unchanged', async () => {
    const s = (await testStore());
    try {
        const old = (await s.createEntry({ ...sleep, endAt: null }));
        await s.database.query("UPDATE entries SET status='completed' WHERE id=?", [old.id]);
        const before = (await s.getEntry(old.id));
        (await s.createEntry(care()));
        assert.deepEqual((await s.getEntry(old.id)), before);
    }
    finally {
        (await s.close());
    }
});
test('a fully covered new sleep keeps exact details in the automatic deletion preview', async () => {
    const s = (await testStore());
    try {
        const p = (await s.propose([{ type: 'create_entry', entry: sleep }, { type: 'create_entry', entry: care('bath', 0, 7) }], 'Sleep and bath.'));
        const deletion = p.sleepChanges!.find(op => op.type === 'delete_entry')!;
        assert.ok('id' in deletion);
        const target = p.sleepTargets!.find(e => e.id === deletion.id)!;
        assert.equal(target.startAt, sleep.startAt);
        assert.equal(target.endAt, sleep.endAt);
        (await s.confirm(p.id));
        assert.equal((await sleeps(s)).length, 0);
        assert.equal((await s.exportData()).deletedEntries.length, 1);
    }
    finally {
        (await s.close());
    }
});
test('later care interruptions resume in sequence with an active tail', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry({ ...sleep, endAt: null }));
        const nappy = (await s.createEntry(care('nappy', 2, null))), bath = (await s.createEntry(care('bath', 4, null)));
        (await s.updateEntry(nappy.id, { ...nappy, endAt: at(3) }, nappy.version));
        assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), [[at(1), at(2)], [at(3), at(4)]]);
        (await s.updateEntry(bath.id, { ...bath, endAt: at(5) }, bath.version));
        assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), [[at(1), at(2)], [at(3), at(4)], [at(5), null]]);
        assert.equal((await sleeps(s))[2].status, 'active');
    }
    finally {
        (await s.close());
    }
});
test('resume stops at independent sleep and never duplicates an existing interval', async () => {
    for (const end of [3, 5]) {
        const s = (await testStore());
        try {
            (await s.createEntry(sleep));
            const event = (await s.createEntry(care('nappy', 2, null)));
            const other = (await s.createEntry({ ...sleep, startAt: at(4), endAt: at(6) }));
            (await s.updateEntry(event.id, { ...event, endAt: at(end) }, event.version));
            assert.deepEqual((await s.getEntry(other.id)), other);
            assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), end === 3 ? [[at(1), at(2)], [at(3), at(4)], [at(4), at(6)]] : [[at(1), at(2)], [at(4), at(6)]]);
        }
        finally {
            (await s.close());
        }
    }
});
test('resume keeps bounds, skips changed sleep, and supports a fully removed prefix', async () => {
    for (const mode of ['end', 'edit', 'delete', 'same-start']) {
        const s = (await testStore());
        try {
            const original = (await s.createEntry(sleep)), event = (await s.createEntry(care('bath', mode === 'same-start' ? 1 : 2, null)));
            if (mode === 'edit') {
                const prefix = (await s.getEntry(original.id));
                (await s.updateEntry(prefix.id, { ...prefix, notes: 'Manual correction.' }, prefix.version));
            }
            if (mode === 'delete') {
                const prefix = (await s.getEntry(original.id));
                (await s.deleteEntry(prefix.id, prefix.version));
            }
            const result = (await s.updateEntry(event.id, { ...event, endAt: at(mode === 'end' ? 7 : 3) }, event.version));
            if (mode === 'edit' || mode === 'delete') {
                assert.match(result.sleepNotice!, /interrupted sleep changed/);
                assert.equal((await sleeps(s)).length, mode === 'delete' ? 0 : 1);
            }
            else if (mode === 'end')
                assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), [[at(1), at(2)]]);
            else
                assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), [[at(3), at(6)]]);
        }
        finally {
            (await s.close());
        }
    }
});
test('Assistant previews and confirms chained resumes with stable link versions', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry({ ...sleep, endAt: null }));
        const nappy = (await s.createEntry(care('nappy', 2, null))), bath = (await s.createEntry(care('bath', 4, null)));
        const p = (await s.propose([{ type: 'update_entry', id: nappy.id, version: nappy.version, entry: { ...nappy, endAt: at(3) } }], 'End nappy.'));
        assert.ok(p.sleepChanges!.some(op => op.type === 'create_entry' && op.entry.startAt === at(3) && op.entry.endAt === at(4)));
        assert.equal((await sleeps(s)).length, 1);
        (await s.confirm(p.id));
        (await s.updateEntry(bath.id, { ...bath, endAt: at(5) }, bath.version));
        assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), [[at(1), at(2)], [at(3), at(4)], [at(5), null]]);
    }
    finally {
        (await s.close());
    }
});
test('resumption subtracts intervening timed care', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry(sleep));
        const event = (await s.createEntry(care('nappy', 2, null)));
        (await s.createEntry(care('bath', 4, 5)));
        (await s.updateEntry(event.id, { ...event, endAt: at(3) }, event.version));
        assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), [[at(1), at(2)], [at(3), at(4)], [at(5), at(6)]]);
    }
    finally {
        (await s.close());
    }
});
test('unfinished overlapping care blocks restart in either completion order', async () => {
    for (const sameStart of [false, true])
        for (const reverse of [false, true]) {
            const s = (await testStore());
            try {
                (await s.createEntry(sleep));
                const nappy = (await s.createEntry(care('nappy', 2, null))), bath = (await s.createEntry(care('bath', sameStart ? 2 : 3, null)));
                const first = reverse ? bath : nappy, second = reverse ? nappy : bath;
                (await s.updateEntry(first.id, { ...first, endAt: at(reverse ? 5 : 4) }, first.version));
                assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), [[at(1), at(2)]]);
                (await s.updateEntry(second.id, { ...second, endAt: at(reverse ? 4 : 5) }, second.version));
                assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), [[at(1), at(2)], [at(5), at(6)]]);
            }
            finally {
                (await s.close());
            }
        }
});
test('clearing and adding End again replaces only inferred sleep segments', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry(sleep));
        let event = (await s.createEntry(care('nappy', 2, null)));
        event = (await s.updateEntry(event.id, { ...event, endAt: at(3) }, event.version));
        assert.equal((await sleeps(s)).length, 2);
        event = (await s.updateEntry(event.id, { ...event, endAt: null }, event.version));
        assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), [[at(1), at(2)]]);
        (await s.updateEntry(event.id, { ...event, endAt: at(4) }, event.version));
        assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), [[at(1), at(2)], [at(4), at(6)]]);
    }
    finally {
        (await s.close());
    }
});
test('care completion order does not change separated gaps', async () => {
    for (const reverse of [false, true]) {
        const s = (await testStore());
        try {
            (await s.createEntry({ ...sleep, endAt: at(8) }));
            const nappy = (await s.createEntry(care('nappy', 2, null))), bath = (await s.createEntry(care('bath', 4, null)));
            const edits = [{ entry: nappy, end: 3 }, { entry: bath, end: 5 }];
            if (reverse)
                edits.reverse();
            for (const { entry, end } of edits)
                (await s.updateEntry(entry.id, { ...entry, endAt: at(end) }, entry.version));
            assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), [[at(1), at(2)], [at(3), at(4)], [at(5), at(8)]]);
        }
        finally {
            (await s.close());
        }
    }
});
test('failed resume rolls back its source and a retry succeeds', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry(sleep));
        const event = (await s.createEntry(care('nappy', 2, null))), before = (await s.exportData());
        await failEntryWrites(s, 'fail_resume', 'INSERT', 'resume failed', "NEW.activity='sleep'");
        await assert.rejects(async () => (await s.updateEntry(event.id, { ...event, endAt: at(3) }, event.version)), /resume failed/);
        assert.deepEqual((await s.exportData()).sleepSources, before.sleepSources);
        assert.deepEqual((await s.listEntries()), before.entries);
        await s.database.query('DROP TRIGGER fail_resume ON entries');
        (await s.updateEntry(event.id, { ...event, endAt: at(3) }, event.version));
        assert.equal((await sleeps(s)).length, 2);
    }
    finally {
        (await s.close());
    }
});
test('sleep sources survive reopening and moved or removed care keeps its existing gap', async () => {
    const fixtureKey=randomUUID();
    try {
        let s = (await testStore(fixtureKey));
        (await s.createEntry(sleep));
        const event = (await s.createEntry(care('nappy', 2, null)));
        (await s.close());
        s = (await testStore(fixtureKey));
        (await s.updateEntry(event.id, { ...event, endAt: at(3) }, event.version));
        assert.equal((await sleeps(s)).length, 2);
        const current = (await s.getEntry(event.id));
        (await s.updateEntry(current.id, { ...current, startAt: at(4), endAt: at(5) }, current.version));
        assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]), [[at(1), at(2)], [at(3), at(4)], [at(5), at(6)]]);
        assert.equal((await s.exportData()).sleepSources.length, 0);
        (await s.deleteEntry(current.id, current.version + 1));
        assert.equal((await sleeps(s)).length, 3);
        (await s.close());
    }
    finally {

    }
});
test('Assistant rejects changed source state and rolls back a failed restart', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry(sleep));
        const event = (await s.createEntry(care('nappy', 2, null)));
        const operation = { type: 'update_entry', id: event.id, version: event.version, entry: { ...event, endAt: at(3) } };
        const p = (await s.propose([operation], 'End nappy.'));
        const source = (await s.database.query('SELECT * FROM sleep_sources')).rows[0]!;
        await s.database.query('DELETE FROM sleep_sources');
        await assert.rejects(async () => (await s.confirm(p.id)), /changed/);
        assert.equal((await sleeps(s)).length, 1);
        await s.database.query('INSERT INTO sleep_sources VALUES (?,?)', [String(source.id), String(source.state)]);
        const next = (await s.propose([operation], 'End nappy.'));
        await failEntryWrites(s, 'fail_confirm', 'INSERT', 'resume failed', "NEW.activity='sleep'");
        await assert.rejects(async () => (await s.confirm(next.id)), /resume failed/);
        assert.equal((await s.getEntry(event.id)).endAt, null);
        assert.equal((await s.getProposal(next.id)).status, 'pending');
        await s.database.query('DROP TRIGGER fail_confirm ON entries');
        (await s.confirm(next.id));
        assert.equal((await sleeps(s)).length, 2);
    }
    finally {
        (await s.close());
    }
});
test('independent sleep before the source start or before interruption prevents duplicate restart', async () => {
    for (const [start, before] of [[0, false], [1, false], [4, false], [4, true]] as const) {
        const s = (await testStore());
        try {
            (await s.createEntry(sleep));
            let other: Entry | undefined;
            if (before)
                other = (await s.createEntry({ ...sleep, startAt: at(start) }));
            const event = (await s.createEntry(care('nappy', 2, null)));
            if (!before)
                other = (await s.createEntry({ ...sleep, startAt: at(start) }));
            const independent = other!;
            (await s.updateEntry(event.id, { ...event, endAt: at(3) }, event.version));
            assert.deepEqual((await s.getEntry(independent.id)), independent);
            assert.deepEqual((await sleeps(s)).filter(entry => entry.id !== independent.id).map(entry => [entry.startAt, entry.endAt]), start === 4 ? [[at(1), at(2)], [at(3), at(4)]] : [[at(1), at(2)]]);
        }
        finally {
            (await s.close());
        }
    }
});
test('a manual edit in another sleep source prevents a duplicate inferred restart', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry(sleep));
        const nappy = (await s.createEntry(care('nappy', 2, null)));
        const other = (await s.createEntry({ ...sleep, startAt: at(4) }));
        (await s.createEntry(care('bath', 5, null)));
        const prefix = (await s.getEntry(other.id)), manual = (await s.updateEntry(prefix.id, { ...prefix, startAt: at(3) }, prefix.version));
        (await s.updateEntry(nappy.id, { ...nappy, endAt: at(3) }, nappy.version));
        assert.deepEqual((await s.getEntry(manual.id)), manual);
        assert.equal((await sleeps(s)).filter(entry => entry.startAt === at(3) && entry.endAt === at(5)).length, 1);
    }
    finally {
        (await s.close());
    }
});
test('one unfinished care record interrupts and resumes each overlapping sleep source', async () => {
    const s = (await testStore());
    try {
        (await s.createEntry(sleep));
        (await s.createEntry({ ...sleep, startAt: '2026-11-13T01:30:00.000Z', endAt: at(5) }));
        const event = (await s.createEntry(care('nappy', 2, null)));
        assert.equal((await sleeps(s)).length, 2);
        (await s.updateEntry(event.id, { ...event, endAt: at(3) }, event.version));
        assert.deepEqual((await sleeps(s)).map(e => [e.startAt, e.endAt]).sort(), [[at(1), at(2)], ['2026-11-13T01:30:00.000Z', at(2)], [at(3), at(5)], [at(3), at(6)]].sort());
    }
    finally {
        (await s.close());
    }
});
