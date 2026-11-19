import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entrySchema } from '../src/server/schema.ts';
import {testStore, testAssistantOperations} from './postgres-fixture.ts';
import { entryLabel } from '../src/activities.ts';
const input = { activity: 'feeding', feedingType: 'Breast', startAt: '2026-11-03T22:45:13.000Z', endAt: '2026-11-03T23:15:29.000Z', status: 'completed', pee: true, poo: false, temperature: 36.8, notes: '20 ml. Source: original row.' };
test('feeding aliases normalize while explicit types, unknown types, and unrelated names stay distinct', () => {
    for (const [activity, feedingType] of [['breastfeeding', 'Breast'], [' Breast Feeding ', 'Breast'], ['bottle', 'Bottle'], ['bottle feeding', 'Bottle'], ['syringe feeding', 'Syringe'], ['cup feeding', 'Cup'], ['tube feeding', 'Tube'], ['Feeding', null]] as const) {
        const parsed = entrySchema.parse({ ...input, activity, feedingType: null });
        assert.equal(parsed.activity, 'feeding');
        assert.equal(parsed.feedingType, feedingType);
    }
    assert.equal(entrySchema.parse({ ...input, feedingType: ' syringe ' }).feedingType, 'Syringe');
    assert.equal(entrySchema.parse({ ...input, feedingType: 'Supplemental nursing system' }).feedingType, 'Supplemental nursing system');
    assert.equal(entrySchema.parse({ ...input, activity: 'feeding advice', feedingType: null }).activity, 'feeding advice');
    for (const activity of ['constructor', '__proto__']) {
        const parsed = entrySchema.parse({ ...input, activity, feedingType: null });
        assert.equal(parsed.feedingType, null);
        assert.equal(entryLabel(parsed), activity);
    }
    assert.throws(() => entrySchema.parse({ ...input, activity: 'sleep' }));
    assert.throws(() => entrySchema.parse({ ...input, activity: 'breastfeeding', feedingType: 'Bottle' }));
    assert.throws(() => entrySchema.parse({ ...input, feedingType: 'x'.repeat(81) }));
    for (const feedingType of ['Breast', 'Bottle', 'Syringe', null])
        assert.equal(entrySchema.parse({ ...input, feedingType, endAt: null, status: 'active' }).status, 'active');
    assert.equal(entryLabel({ activity: 'feeding', feedingType: 'Syringe' }), 'Feeding (Syringe)');
});
test('feeding edits, proposals, deletion, and recovery preserve the type and reject stale changes', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const saved = (await store.createEntry(input));
    const proposal = (await store.propose([{ type: 'update_entry', id: saved.id, version: saved.version, entry: { ...saved, feedingType: 'Bottle' } }], 'Change feeding type.'));
    assert.equal((await store.getEntry(saved.id)).feedingType, 'Breast');
    (await store.confirm(proposal.id));
    const bottle = (await store.getEntry(saved.id));
    assert.equal(bottle.feedingType, 'Bottle');
    await assert.rejects(async () => (await store.updateEntry(saved.id, { ...saved, feedingType: 'Syringe' }, saved.version)), /changed/);
    const { feedingType, ...olderClient } = bottle;
    const retained = (await store.updateEntry(bottle.id, { ...olderClient, notes: 'Older client note.' }, bottle.version));
    assert.equal(retained.feedingType, 'Bottle');
    const cleared = (await store.updateEntry(retained.id, { ...retained, feedingType: null }, retained.version));
    assert.equal(cleared.feedingType, null);
    const sleep = (await store.updateEntry(cleared.id, { ...cleared, activity: 'sleep', feedingType: null }, cleared.version));
    assert.equal(sleep.feedingType, null);
    const syringe = (await store.updateEntry(sleep.id, { ...sleep, activity: 'feeding', feedingType: 'Syringe' }, sleep.version));
    const converted = (await testAssistantOperations([{ type: 'update_entry', id: syringe.id, version: syringe.version, entry: { ...syringe, feedingType: undefined, notes: 'New note.' } }], store));
    assert.equal((converted[0].entry as any).feedingType, 'Syringe');
    (await store.deleteEntry(syringe.id, syringe.version));
    const archive = (await store.exportData()).deletedEntries[0].entry;
    assert.equal(archive.feedingType, 'Syringe');
    assert.equal((await store.createEntry(archive)).feedingType, 'Syringe');
});
