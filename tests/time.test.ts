import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateTimeInput, dayInput, inputToIso } from '../src/time.ts';
import { localDay, daySchema } from '../src/server/schema.ts';
import {testStore} from './postgres-fixture.ts';
test('household time conversion uses Berlin offsets in winter and summer', () => {
    for (const [local, utc] of [
        ['2026-01-15T13:45', '2026-01-15T12:45:00.000Z'],
        ['2026-07-15T13:45', '2026-07-15T11:45:00.000Z'],
        ['2026-03-29T01:30', '2026-03-29T00:30:00.000Z'],
        ['2026-03-29T03:30', '2026-03-29T01:30:00.000Z'],
        ['2026-10-25T01:30', '2026-10-24T23:30:00.000Z'],
        ['2026-10-25T03:30', '2026-10-25T02:30:00.000Z']
    ]) {
        assert.equal(inputToIso(local), utc);
        assert.equal(dateTimeInput(utc), local);
    }
    assert.equal(dayInput('2026-07-15T22:15:00Z'), '2026-07-16');
    assert.equal(localDay(new Date('2026-01-15T23:15:00Z'), 'Europe/Berlin'), '2026-01-16');
});
test('nonexistent spring time fails and repeated autumn time resolves to a valid occurrence', () => {
    assert.throws(() => inputToIso('2026-03-29T02:30'), /does not exist/);
    const repeated = inputToIso('2026-10-25T02:30');
    assert(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z'].includes(repeated));
    assert.equal(dateTimeInput(repeated), '2026-10-25T02:30');
    assert.equal(dateTimeInput('2026-10-25T00:30:00Z'), '2026-10-25T02:30');
    assert.equal(dateTimeInput('2026-10-25T01:30:00Z'), '2026-10-25T02:30');
    assert.throws(() => inputToIso('bad input'));
    assert.throws(() => daySchema.parse('2026-02-30'));
});
test('day queries include midnight and DST spans but exclude unrelated dates', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const spring = (await store.createEntry({ activity: 'sleep', startAt: '2026-03-28T22:30:00Z', endAt: '2026-03-29T02:30:00Z' }));
    const autumn = (await store.createEntry({ activity: 'sleep', startAt: '2026-10-24T21:30:00Z', endAt: '2026-10-25T03:30:00Z' }));
    for (const day of ['2026-03-28', '2026-03-29'])
        assert.equal((await store.listEntries(day))[0].id, spring.id);
    for (const day of ['2026-10-24', '2026-10-25'])
        assert.equal((await store.listEntries(day))[0].id, autumn.id);
    assert.deepEqual((await store.listEntries('2026-03-30')), []);
    assert.deepEqual((await store.listEntries('2026-10-26')), []);
    assert.equal(Date.parse(spring.endAt!) - Date.parse(spring.startAt), 4 * 60 * 60000);
    assert.equal(Date.parse(autumn.endAt!) - Date.parse(autumn.startAt), 6 * 60 * 60000);
});
test('an active sleep spans the household midnight until it ends', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-04T00:30:00Z') });
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const sleep = (await store.createEntry({ activity: 'sleep', startAt: '2026-11-03T22:30:00Z', status: 'active' }));
    assert.equal((await store.listEntries('2026-11-03'))[0].id, sleep.id);
    assert.equal((await store.listEntries('2026-11-04'))[0].id, sleep.id);
    assert.deepEqual((await store.listEntries('2026-11-05')), []);
    (await store.updateEntry(sleep.id, { ...sleep, status: 'completed', endAt: '2026-11-03T22:45:00Z' }, sleep.version));
    assert.deepEqual((await store.listEntries('2026-11-04')), []);
});
test('unchanged autumn inputs preserve both original UTC timestamps', () => {
    for (const original of ['2026-10-25T00:30:17.123Z', '2026-10-25T01:30:42.987Z']) {
        const local = dateTimeInput(original);
        assert.equal(local, '2026-10-25T02:30');
        assert.equal(inputToIso(local, 'Europe/Berlin', original), original);
    }
    assert.equal(inputToIso('2026-10-25T03:30', 'Europe/Berlin', '2026-10-25T00:30:17.123Z'), '2026-10-25T02:30:00.000Z');
    assert.throws(() => inputToIso('2026-02-30T12:00'));
});
