import { test } from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import { inferBreastSide } from '../src/activities.ts';
import { breastBalance } from '../src/dashboard.ts';
import {testStore, testAssistantOperations} from './postgres-fixture.ts';
import { entrySchema } from '../src/server/schema.ts';
import type { Entry } from '../src/shared.ts';
const input = { activity: 'feeding', feedingType: 'Breast', startAt: '2026-11-03T09:00:00Z', endAt: '2026-11-03T09:20:00Z', notes: 'Left breast.' };
const entry = (values: Partial<Entry> = {}): Entry => ({ id: 'feed', ...input, status: 'completed', pee: false, poo: false, temperature: null, version: 1, createdAt: input.startAt, updatedAt: input.startAt, ...values });
test('side inference uses clear breast notes and excludes unrelated text and import references', () => {
    for (const [notes, side] of [['Left breast.', 'left'], ['Right side.', 'right'], ['Both breasts.', 'both'], ['Left breast and right breast.', 'both'], ['L', 'left'], ['R', 'right'], ['Source: BabyDiary.pdf, left breast', null], ['Left hospital after feeding.', null], ['20 ml', null], ['Left. Dessert.', 'left'], ['Right. Approximately 15 min.', 'right'], ['Left (links). Corrected start time.', 'left'], ['Left + right, 15 min each.', 'both'], ['Right / left.', 'both'], ['Left first, then right. Feeding: 20 min per side, 40 min total.', 'both'], ['Left. Right is crossed out.', 'left'], ['Not the left breast. Right breast only.', null], ['Left breast?', null], ['Both breasts maybe.', null]] as const)
        assert.equal(inferBreastSide(notes), side);
    assert.equal(entrySchema.parse({ ...input, breastSide: 'right' }).breastSide, 'right');
    assert.equal(entrySchema.parse({ ...input, feedingType: 'Bottle' }).breastSide, null);
    assert.throws(() => entrySchema.parse({ ...input, breastSide: 'invalid' }));
});
test('balance clips midnight, splits Both evenly, separates unknown and untimed feeds, and excludes other types', () => {
    const rows = [entry({ startAt: '2026-11-02T22:50:00Z', endAt: '2026-11-02T23:10:00Z', breastSide: 'both' }), entry({ id: 'right', breastSide: 'right' }), entry({ id: 'unknown', notes: 'No side recorded.' }), entry({ id: 'untimed', endAt: null }), entry({ id: 'bottle', feedingType: 'Bottle' }), entry({ id: 'boundary', startAt: '2026-11-03T23:00:00Z', endAt: '2026-11-03T23:20:00Z' })];
    const result = breastBalance([...rows, rows[0]], '2026-11-03', '2026-11-03');
    assert.deepEqual(result, { days: [{ day: '2026-11-03', left: 5, right: 25, unknown: 20 }], left: 5, right: 25, unknown: 20, untimed: 1, running: 0 });
    const both = breastBalance([rows[0]], '2026-11-02', '2026-11-03');
    assert.deepEqual(both.days.map(d => [d.left, d.right]), [[5, 5], [5, 5]]);
    assert.deepEqual(breastBalance([], '2026-11-03', '2026-11-03').days, [{ day: '2026-11-03', left: 0, right: 0, unknown: 0 }]);
});
test('balance uses real elapsed time through clock changes and only elapsed running time', () => {
    const result = breastBalance([entry({ startAt: '2026-10-25T00:45:00Z', endAt: '2026-10-25T01:15:00Z', breastSide: 'both' })], '2026-10-25', '2026-10-25');
    assert.equal(result.left, 15);
    assert.equal(result.right, 15);
    const active = entry({ status: 'active', endAt: null, breastSide: 'left' });
    assert.equal(breastBalance([active], '2026-11-03', '2026-11-03', new Date('2026-11-03T09:12:00Z')).left, 12);
    assert.equal(breastBalance([active], '2026-11-03', '2026-11-03', new Date('2026-11-03T09:12:00Z')).running, 1);
    const future = breastBalance([active], '2026-11-03', '2026-11-03', new Date('2026-11-03T08:00:00Z'));
    assert.equal(future.left, 0);
});
test('side persists through edits, proposals, deletion, and a database restart', async (t) => {
    const fixtureKey=randomUUID();
    const store = (await testStore(fixtureKey));
    const saved = (await store.createEntry({ ...input, breastSide: 'right' }));
    assert.equal(saved.breastSide, 'right');
    const { breastSide, ...oldClient } = saved;
    const edited = (await store.updateEntry(saved.id, { ...oldClient, notes: 'Left breast. Unrelated note.' }, saved.version));
    assert.equal(edited.breastSide, 'right');
    const preview = (await store.propose([{ type: 'update_entry', id: edited.id, version: edited.version, entry: { ...edited, breastSide: 'both' } }], 'Both sides.'));
    (await store.confirm(preview.id));
    const both = (await store.getEntry(saved.id));
    assert.equal(both.breastSide, 'both');
    await assert.rejects(async () => (await store.updateEntry(saved.id, saved, saved.version)), /changed/);
    (await store.deleteEntry(both.id, both.version));
    const archive = (await store.exportData()).deletedEntries[0].entry;
    assert.equal(archive.breastSide, 'both');
    assert.equal((await store.createEntry(archive)).breastSide, 'both');
    (await store.close());
    const reopened = (await testStore(fixtureKey));
    assert.equal((await reopened.listEntries())[0].breastSide, 'both');
    (await reopened.close());
});
test('explicit unknown sides stay outside balance and corrections and deletion recompute totals', () => {
    const known = entry({ breastSide: 'right' });
    assert.equal(breastBalance([known], '2026-11-03', '2026-11-03').right, 20);
    const unknown = breastBalance([{ ...known, breastSide: null }], '2026-11-03', '2026-11-03');
    assert.equal(unknown.right, 0);
    assert.equal(unknown.left, 0);
    assert.equal(unknown.unknown, 20);
    for (const changed of [{ ...known, feedingType: 'Bottle' }, { ...known, activity: 'walk', feedingType: null }])
        assert.equal(breastBalance([changed], '2026-11-03', '2026-11-03').right, 0);
    assert.equal(breastBalance([], '2026-11-03', '2026-11-03').right, 0);
});
test('assistant requires a side for new Breast feeds and preserves sides during unrelated edits', async (t) => {
    const { assistantOperations } = await import('../src/server/assistant.ts');
    const store = (await testStore());
    t.after(async () => (await store.close()));
    for (const breastSide of ['right', null] as const) {
        const saved = (await store.createEntry({ ...input, breastSide }));
        const { breastSide: omitted, ...fields } = saved;
        const [op] = (await testAssistantOperations([{ type: 'update_entry', id: saved.id, version: saved.version, entry: { ...fields, notes: 'Left breast. Updated note.' } }], store));
        assert.equal((op.entry as any).breastSide, breastSide);
        const preview = (await store.propose([op], 'Update note.'));
        (await store.confirm(preview.id));
        assert.equal((await store.getEntry(saved.id)).breastSide, breastSide);
    }
    const local = { ...input, startAt: '2026-11-03T10:00', endAt: '2026-11-03T10:20' };
    for (const fields of [{ ...local, notes: '' }, { ...local, breastSide: null }])
        await assert.rejects(async () => (await testAssistantOperations([{ type: 'create_entry', entry: fields }], store)), /which breast/);
    const [inferred] = (await testAssistantOperations([{ type: 'create_entry', entry: local }], store));
    const preview = (await store.propose([inferred], 'New feed.'));
    assert.equal((preview.operations[0] as any).entry.breastSide, 'left');
    const bottle = (await store.createEntry({ ...input, feedingType: 'Bottle' }));
    const { breastSide: oldSide, ...bottleFields } = bottle;
    const [correction] = (await testAssistantOperations([{ type: 'update_entry', id: bottle.id, version: bottle.version, entry: { ...bottleFields, feedingType: 'Breast' } }], store));
    const correctionPreview = (await store.propose([correction], 'Correct type.'));
    assert.equal((correctionPreview.operations[0] as any).entry.breastSide, 'left');
    await assert.rejects(async () => (await testAssistantOperations([{ type: 'update_entry', id: bottle.id, version: bottle.version, entry: { ...bottle, feedingType: 'Breast', notes: '' } }], store)), /which breast/);
});
test('explicit feeding totals exclude known breaks without changing source times or notes', () => {
    const feed = entry({ breastSide: 'both', startAt: '2026-11-02T22:30:00Z', endAt: '2026-11-02T23:30:00Z', notes: 'Left first, then right. Feeding: 20 min per side, 40 min total. The interval includes a break.' });
    const before = structuredClone(feed), result = breastBalance([feed], '2026-11-02', '2026-11-03');
    assert.equal(result.left, 20);
    assert.equal(result.right, 20);
    assert.deepEqual(result.days.map(d => d.left), [10, 10]);
    assert.deepEqual(feed, before);
    const shorter = breastBalance([{ ...feed, endAt: '2026-11-02T22:40:00Z' }], '2026-11-02', '2026-11-02');
    assert.equal(shorter.left, 5);
    assert.equal(shorter.right, 5);
});
test('assistant rejects invented sides even when the model supplies a valid side value', async (t) => {
    const { assistantOperations } = await import('../src/server/assistant.ts');
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const op = { type: 'create_entry', entry: { ...input, breastSide: 'both', startAt: '2026-11-03T10:00', endAt: '2026-11-03T10:20' } };
    await assert.rejects(async () => (await testAssistantOperations([op], store, 'Log breastfeeding from 10:00 to 10:20.')), /instruction does not state/);
    await assert.rejects(async () => (await testAssistantOperations([op], store, 'Log breastfeeding on the left breast from 10:00 to 10:20.')), /instruction does not state/);
    await assert.rejects(async () => (await testAssistantOperations([op], store, 'Left breast at 10:00. Right breast at 11:00.')), /instruction does not state/);
    await assert.rejects(async () => (await testAssistantOperations([op], store, 'Nappy with both pee and poo. Log breastfeeding.')), /instruction does not state/);
    assert.equal((await testAssistantOperations([op], store, 'Log breastfeeding. Both breasts equally.')).length, 1);
    assert.equal((await testAssistantOperations([op], store, 'Left and right breast.')).length, 1);
});
