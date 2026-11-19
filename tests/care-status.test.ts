import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestCareStart, elapsedCareTime } from '../src/care-status.ts';
import {testStore} from './postgres-fixture.ts';
test('current care uses latest past starts across days and feeding types', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    (await store.createEntry({ activity: 'feeding', feedingType: 'Breast', startAt: '2026-11-03T22:00:00Z', endAt: '2026-11-03T22:20:00Z' }));
    (await store.createEntry({ activity: 'feeding', feedingType: 'Cup', startAt: '2026-11-03T23:00:00Z', status: 'active' }));
    (await store.createEntry({ activity: 'nappy', startAt: '2026-11-04T00:00:00Z', pee: true }));
    (await store.createEntry({ activity: 'feeding', startAt: '2026-11-04T02:00:00Z' }));
    const now = Date.parse('2026-11-04T01:30:00Z');
    const latest = latestCareStart((await store.listEntries()), 'feeding', now)!;
    assert.equal(latest.feedingType, 'Cup');
    assert.equal(elapsedCareTime(latest.startAt, now), '2h 30m');
    assert.equal(elapsedCareTime(latestCareStart((await store.listEntries()), 'nappy', now)!.startAt, now), '1h 30m');
    assert.equal(latestCareStart([], 'feeding', now), null);
});
test('elapsed care time uses real minutes across clock changes and long gaps', () => {
    assert.equal(elapsedCareTime('2026-10-25T00:30:00Z', Date.parse('2026-10-25T02:00:00Z')), '1h 30m');
    assert.equal(elapsedCareTime('2026-03-29T00:30:00Z', Date.parse('2026-03-29T02:00:00Z')), '1h 30m');
    assert.equal(elapsedCareTime('2026-11-01T00:00:00Z', Date.parse('2026-11-03T03:05:00Z')), '51h 5m');
});
