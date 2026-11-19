import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server/app.ts';
import { PostgresStore as Store } from '../src/server/postgres-store.ts';
import {testStore, testAuth} from './postgres-fixture.ts';
import { config } from '../src/server/settings.ts';
import { AppError } from '../src/server/schema.ts';
import type { AssistantReply, Entry } from '../src/shared.ts';
const entry = { activity: 'nappy', startAt: '2026-11-03T12:00:00.000Z', endAt: null, status: 'completed', pee: true, poo: false, temperature: null, notes: 'API test.' };
const defaults = {
    assist: async (_store: Store, _command: string, _day: string): Promise<AssistantReply> => ({ message: 'Which entry?', proposal: null }),
    transcribe: async (_audio: Buffer) => 'A nappy change at one.',
    speak: async (_text: string) => Buffer.from('RIFFtestWAVE')
};
async function fixture(t: TestContext, services = defaults) {
    const previous = { key: config.openrouterApiKey, stt: config.sttUrl, tts: config.ttsUrl };
    config.openrouterApiKey = 'test-key';
    config.sttUrl = 'http://speech.test/transcribe';
    config.ttsUrl = 'http://speech.test/speech';
    t.after(() => { config.openrouterApiKey = previous.key; config.sttUrl = previous.stt; config.ttsUrl = previous.tts; });
    const store = (await testStore());
    const accounts = (await testAuth(store, { username: 'api-owner', password: 'Synthetic API password 123' }));
    const server = createApp(store, services, accounts).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    t.after(async () => {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        (await store.close());

    });
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'api-owner', password: 'Synthetic API password 123' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const authenticatedFetch = (url: string, init: RequestInit = {}) => fetch(url, { ...init, headers: { ...init.headers, Cookie: cookie } });
    async function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
        const response = await authenticatedFetch(base + '/api' + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
        const data = await response.json();
        return { response, data };
    }
    return { store, base, request, authenticatedFetch };
}
test('daily task settings share custom checks and retain removed task history', async (t) => {
    const { request } = await fixture(t);
    const initial = (await request('/care-tasks')).data;
    assert.equal(initial.find((task: any) => task.key === 'cord').active, false);
    assert.equal((await request('/care-tasks', 'POST', { label: '   ' })).response.status, 400);
    const created = await request('/care-tasks', 'POST', { label: 'Go for a stroll' });
    assert.equal(created.response.status, 201);
    const task = created.data;
    assert.deepEqual((await request('/care/2026-11-03')).data[task.key], { done: false, version: 0 });
    assert.equal((await request('/care/2026-11-03', 'PUT', { key: task.key, done: true, version: 0, taskVersion: task.version })).response.status, 200);
    const renamed = await request('/care-tasks/' + task.key, 'PUT', { label: 'Walk outside', version: task.version });
    assert.equal(renamed.response.status, 200);
    assert.equal(renamed.data.key, task.key);
    assert.equal((await request('/care-tasks/' + task.key, 'PUT', { label: 'Stale label', version: task.version })).response.status, 409);
    assert.equal((await request('/care/2026-11-03', 'PUT', { key: task.key, done: false, version: 1, taskVersion: task.version })).response.status, 409);
    assert.equal((await request('/care-tasks/' + task.key, 'DELETE')).response.status, 400);
    assert.equal((await request('/care-tasks/' + task.key, 'DELETE', { version: renamed.data.version })).response.status, 200);
    assert.equal((await request('/care/2026-11-03', 'PUT', { key: task.key, done: false, version: 1 })).response.status, 409);
    assert.equal((await request('/care/2026-11-03', 'PUT', { key: 'unknown', done: true, version: 0 })).response.status, 404);
    const exported = (await request('/export')).data;
    assert.equal(exported.care.find((row: any) => row.key === task.key).done, 1);
    assert.equal(exported.careTasks.find((row: any) => row.key === task.key).active, false);
    const sameLabel = (await request('/care-tasks', 'POST', { label: 'Walk outside' })).data;
    assert.notEqual(sameLabel.key, task.key);
    assert.equal((await request('/care/2026-11-03')).data[sameLabel.key].done, false);
});
test('HTTP clients share entries, rename activities, reject stale writes, and delete records', async (t) => {
    const { request } = await fixture(t);
    const created = await request('/entries', 'POST', entry);
    assert.equal(created.response.status, 201);
    const a = created.data as Entry;
    assert.equal(a.version, 1);
    const secondDevice = await request('/entries?day=2026-11-03');
    assert.equal(secondDevice.data[0].id, a.id);
    const changed = await request('/entries/' + a.id, 'PUT', { ...a, activity: 'bottle', notes: 'Renamed on phone.' });
    assert.equal(changed.response.status, 200);
    assert.equal(changed.data.activity, 'feeding');
    assert.equal(changed.data.feedingType, 'Bottle');
    assert.equal(changed.data.version, 2);
    assert.equal((await request('/entries/' + a.id, 'PUT', { ...a, notes: 'Old tablet edit.' })).response.status, 409);
    assert.equal((await request('/entries/' + a.id, 'DELETE', { version: a.version })).response.status, 409);
    assert.equal((await request('/entries?day=2026-11-03')).data[0].notes, 'Renamed on phone.');
    assert.equal((await request('/entries/' + a.id, 'DELETE', { version: changed.data.version })).response.status, 200);
    assert.deepEqual((await request('/entries')).data, []);
    assert.equal((await request('/entries/' + a.id, 'PUT', changed.data)).response.status, 404);
    const exported = await request('/export');
    assert.match(exported.response.headers.get('content-disposition') ?? '', /babylog-export.json/);
    assert.deepEqual(exported.data.entries, []);
});
test('HTTP validation rejects invalid dates and data without changing records', async (t) => {
    const { request, base, authenticatedFetch } = await fixture(t);
    for (const input of [
        { ...entry, startAt: 'invalid' },
        { ...entry, endAt: '2026-11-03T11:00:00Z' },
        { ...entry, temperature: 100 },
        { ...entry, status: 'active' },
        { ...entry, pee: 'yes' },
        { ...entry, activity: '' }
    ])
        assert.equal((await request('/entries', 'POST', input)).response.status, 400);
    assert.equal((await request('/entries?day=2026-02-30')).response.status, 400);
    assert.equal((await request('/care/2026-02-30')).response.status, 400);
    const malformed = await authenticatedFetch(base + '/api/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400);
    assert.match((await malformed.json()).error, /invalid data/);
    assert.deepEqual((await request('/entries')).data, []);
    const health = await request('/health');
    assert.deepEqual(health.data, { ok: true });
    assert.equal(health.response.headers.get('cache-control'), 'no-store');
    assert.equal(health.response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await request('/missing')).response.status, 404);
});
test('daily checks use independent dates and versions across HTTP clients', async (t) => {
    const { request } = await fixture(t);
    assert.deepEqual((await request('/care/2026-11-03')).data, { vitamin_d: { done: false, version: 0 }, cord: { done: false, version: 0 }, tummy_time: { done: false, version: 0 }, face_wash: { done: false, version: 0 } });
    assert.equal((await request('/care/2026-11-03', 'PUT', { key: 'vitamin_d', done: true, version: 0 })).response.status, 200);
    assert.equal((await request('/care/2026-11-03', 'PUT', { key: 'vitamin_d', done: false, version: 0 })).response.status, 409);
    assert.equal((await request('/care/2026-11-03', 'PUT', { key: 'tummy_time', done: true, version: 0 })).response.status, 200);
    assert.equal((await request('/care/2026-11-04')).data.vitamin_d.done, false);
    assert.equal((await request('/care/2026-11-03', 'PUT', { key: 'vitamin_d', done: false, version: 1 })).data.version, 2);
    assert.equal((await request('/care/2026-11-03')).data.tummy_time.done, true);
});
test('Pi HTTP proposals require confirmation and reject cancelled, expired, and repeated confirmations', async (t) => {
    const services = { ...defaults, assist: async (store: Store): Promise<AssistantReply> => ({ message: 'Review this entry.', proposal: (await store.propose([{ type: 'create_entry', entry }], 'Add a nappy change.')) }) };
    const { request, store } = await fixture(t, services);
    const ask = () => request('/assistant', 'POST', { command: 'Add a nappy change at 13:00.', day: '2026-11-03' });
    const proposed = await ask();
    assert.equal(proposed.response.status, 200);
    assert.deepEqual((await request('/entries')).data, []);
    const id = proposed.data.proposal.id;
    assert.equal((await request('/proposals/' + id + '/confirm', 'POST')).response.status, 200);
    assert.equal((await request('/entries')).data.length, 1);
    assert.equal((await request('/proposals/' + id + '/confirm', 'POST')).response.status, 409);
    const cancelled = (await ask()).data.proposal.id;
    assert.equal((await request('/proposals/' + cancelled + '/reject', 'POST')).response.status, 200);
    assert.equal((await request('/proposals/' + cancelled + '/confirm', 'POST')).response.status, 409);
    const expired = (await store.propose([{ type: 'create_entry', entry }], 'Old proposal.', new Date(Date.now() - 700000)));
    assert.equal((await request('/proposals/' + expired.id + '/confirm', 'POST')).response.status, 409);
    assert.equal((await request('/entries')).data.length, 1);
    assert.equal((await request('/proposals/unknown/confirm', 'POST')).response.status, 404);
});
test('stale Pi batches roll back entries and daily checks through HTTP', async (t) => {
    const { store, request } = await fixture(t);
    const a = (await store.createEntry(entry));
    const proposal = (await store.propose([
        { type: 'create_entry', entry: { ...entry, activity: 'note' } },
        { type: 'set_care', day: '2026-11-03', key: 'tummy_time', done: true, version: 0 },
        { type: 'delete_entry', id: a.id, version: a.version }
    ], 'Add a note, mark care, and delete an entry.'));
    const edit = await request('/entries/' + a.id, 'PUT', { ...a, notes: 'Other phone edit.' });
    assert.equal(edit.response.status, 200);
    assert.equal((await request('/proposals/' + proposal.id + '/confirm', 'POST')).response.status, 409);
    const rows = (await request('/entries')).data;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].notes, 'Other phone edit.');
    assert.equal((await request('/care/2026-11-03')).data.tummy_time.done, false);
    assert.equal((await store.getProposal(proposal.id)).status, 'pending');
});
test('Pi busy state clears after failure and manual entry stays available', async (t) => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    const started = new Promise<void>(resolve => entered = resolve);
    let calls = 0;
    const services = { ...defaults, assist: async (): Promise<AssistantReply> => {
            calls++;
            if (calls === 1) {
                entered();
                await gate;
                throw new AppError('Pi is unavailable.', 502);
            }
            return { message: 'Which activity?', proposal: null };
        } };
    const { request } = await fixture(t, services);
    const command = { command: 'Add care.', day: '2026-11-03' };
    const first = request('/assistant', 'POST', command);
    await started;
    assert.equal((await request('/assistant', 'POST', command)).response.status, 429);
    assert.equal((await request('/entries', 'POST', entry)).response.status, 201);
    release();
    assert.equal((await first).response.status, 502);
    const retry = await request('/assistant', 'POST', command);
    assert.equal(retry.response.status, 200);
    assert.equal(retry.data.proposal, null);
    assert.equal(calls, 2);
    assert.equal((await request('/assistant', 'POST', { ...command, command: ' ' })).response.status, 400);
});
test('speech HTTP routes pass bytes and text to services and handle missing input', async (t) => {
    let receivedAudio: Buffer = Buffer.alloc(0);
    let receivedText = '';
    const services = { ...defaults,
        transcribe: async (audio: Buffer) => { receivedAudio = audio; return 'A nappy change at one.'; },
        speak: async (text: string) => { receivedText = text; return Buffer.from('RIFFtestWAVE'); }
    };
    const { base, request, authenticatedFetch } = await fixture(t, services);
    const form = new FormData();
    form.append('audio', new Blob(['voice-bytes'], { type: 'audio/webm' }), 'command.webm');
    const transcribed = await authenticatedFetch(base + '/api/transcribe', { method: 'POST', body: form });
    assert.equal(transcribed.status, 200);
    assert.equal((await transcribed.json()).text, 'A nappy change at one.');
    assert.equal(receivedAudio.toString(), 'voice-bytes');
    assert.equal((await authenticatedFetch(base + '/api/transcribe', { method: 'POST', body: new FormData() })).status, 400);
    const spoken = await authenticatedFetch(base + '/api/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: ' Review the entry. ' }) });
    assert.equal(spoken.status, 200);
    assert.match(spoken.headers.get('content-type') ?? '', /audio\/wav/);
    assert.equal(Buffer.from(await spoken.arrayBuffer()).toString(), 'RIFFtestWAVE');
    assert.equal(receivedText, 'Review the entry.');
    assert.equal((await request('/speech', 'POST', { text: '' })).response.status, 400);
    assert.equal((await request('/speech', 'POST', { text: 'x'.repeat(1001) })).response.status, 400);
});
test('speech service failures allow retry and manual entry', async (t) => {
    let sttCalls = 0, ttsCalls = 0;
    const services = { ...defaults,
        transcribe: async () => {
            if (++sttCalls === 1)
                throw new AppError('Speech input is unavailable.', 502);
            return 'Retry transcript.';
        },
        speak: async () => {
            if (++ttsCalls === 1)
                throw new AppError('Speech output is unavailable.', 502);
            return Buffer.from('RIFFretryWAVE');
        }
    };
    const { base, request, authenticatedFetch } = await fixture(t, services);
    const transcription = () => {
        const form = new FormData();
        form.append('audio', new Blob(['voice']), 'voice.webm');
        return authenticatedFetch(base + '/api/transcribe', { method: 'POST', body: form });
    };
    assert.equal((await transcription()).status, 502);
    assert.equal((await request('/speech', 'POST', { text: 'Test.' })).response.status, 502);
    assert.equal((await request('/entries', 'POST', entry)).response.status, 201);
    assert.equal((await transcription()).status, 200);
    const retry = await authenticatedFetch(base + '/api/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Retry.' }) });
    assert.equal(retry.status, 200);
    assert.equal(Buffer.from(await retry.arrayBuffer()).toString(), 'RIFFretryWAVE');
    assert.equal((await request('/entries')).data.length, 1);
});
test('HTTP writes accept the app origin and reject other origins', async (t) => {
    const { base, request, authenticatedFetch } = await fixture(t);
    assert.equal((await request('/entries', 'POST', entry, { Origin: 'https://other.invalid' })).response.status, 403);
    assert.deepEqual((await request('/entries')).data, []);
    assert.equal((await request('/entries', 'POST', entry, { Origin: base })).response.status, 201);
});
test('HTTP updates and deletion reject missing bodies without server errors', async (t) => {
    const { request } = await fixture(t);
    const saved = (await request('/entries', 'POST', entry)).data;
    assert.equal((await request('/entries/' + saved.id, 'PUT')).response.status, 400);
    assert.equal((await request('/entries/' + saved.id, 'DELETE')).response.status, 400);
    assert.equal((await request('/entries')).data.length, 1);
});
test('mixed Pi batches confirm rename, deletion, and daily care together', async (t) => {
    const { store, request } = await fixture(t);
    const first = (await store.createEntry(entry)), second = (await store.createEntry({ ...entry, activity: 'sleep' }));
    const proposal = (await store.propose([
        { type: 'update_entry', id: first.id, version: first.version, entry: { ...first, activity: 'bottle', notes: 'Renamed.' } },
        { type: 'delete_entry', id: second.id, version: second.version },
        { type: 'set_care', day: '2026-11-03', key: 'vitamin_d', done: true, version: 0 }
    ], 'Rename, delete, and check care.'));
    assert.equal((await request('/proposals/' + proposal.id + '/confirm', 'POST')).response.status, 200);
    const rows = (await request('/entries')).data;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].activity, 'feeding');
    assert.equal(rows[0].feedingType, 'Bottle');
    assert.equal(rows[0].version, 2);
    assert.equal((await request('/care/2026-11-03')).data.vitamin_d.done, true);
    assert.deepEqual((await store.exportData()).deletedEntries[0].entry, second);
    assert.equal((await request('/proposals/' + proposal.id + '/confirm', 'POST')).response.status, 409);
});
test('stale daily care rolls back earlier Pi batch operations', async (t) => {
    const { store, request } = await fixture(t);
    const original = (await store.createEntry(entry));
    const proposal = (await store.propose([
        { type: 'delete_entry', id: original.id, version: original.version },
        { type: 'create_entry', entry: { ...entry, activity: 'note' } },
        { type: 'set_care', day: '2026-11-03', key: 'tummy_time', done: true, version: 0 }
    ], 'Delete, add, and check care.'));
    (await store.setCare('2026-11-03', 'tummy_time', true, 0));
    assert.equal((await request('/proposals/' + proposal.id + '/confirm', 'POST')).response.status, 409);
    assert.deepEqual((await store.listEntries()), [original]);
    assert.deepEqual((await store.exportData()).deletedEntries, []);
    assert.equal((await store.getCare('2026-11-03')).tummy_time.version, 1);
    assert.equal((await store.getProposal(proposal.id)).status, 'pending');
});
test('assistant replies receive bounded conversation context and still require proposal confirmation', async (t) => {
    const question = 'Should I use the last sleep?';
    let calls = 0;
    const services = { ...defaults, assist: async (store: Store, command: string, _day: string, conversation: {
            command: string;
            reply: string;
            at: string;
        }[] = []): Promise<AssistantReply> => {
            calls++;
            if (calls === 1) {
                assert.deepEqual(conversation, []);
                return { message: question, proposal: null };
            }
            assert.equal(command, 'Yes.');
            assert.deepEqual(conversation, [{ command: 'End the sleep.', reply: question, at: '2026-11-03T16:00:00Z' }]);
            return { message: 'Review the sleep.', proposal: (await store.propose([{ type: 'create_entry', entry: { ...entry, activity: 'sleep' } }], 'Sleep.')) };
        } };
    const { request, store } = await fixture(t, services);
    const first = await request('/assistant', 'POST', { command: 'End the sleep.', day: '2026-11-03' });
    assert.equal(first.data.message, question);
    assert.match(first.data.interpretedAt, /Z$/);
    const context = [{ command: 'End the sleep.', reply: question, at: '2026-11-03T16:00:00Z' }];
    const second = await request('/assistant', 'POST', { command: 'Yes.', day: '2026-11-03', conversation: context });
    assert(second.data.proposal);
    assert.equal((await store.listEntries()).length, 0);
    assert.equal((await request('/proposals/' + second.data.proposal.id + '/confirm', 'POST', {})).response.status, 200);
    assert.equal((await store.listEntries()).length, 1);
    for (const conversation of [Array(24).fill(context[0]), [{ command: '', reply: question }], [{ command: 'x'.repeat(4001), reply: question }]]) {
        assert.equal((await request('/assistant', 'POST', { command: 'Yes.', day: '2026-11-03', conversation })).response.status, 400);
    }
    assert.equal(calls, 2);
});
test('assistant accepts the last allowed history and rejects the next request before inference', async (t) => {
    let calls = 0;
    const turn = { command: 'Log a bath at 7:45.', reply: 'Which day?', at: '2026-11-06T19:41:00Z' };
    const services = { ...defaults, assist: async (_store: Store, _command: string, _day: string, history: typeof turn[] = []): Promise<AssistantReply> => {
            calls++;
            assert.equal(history.length, 23);
            assert.equal(history[0].command, turn.command);
            return { message: 'Which detail?', proposal: null };
        } };
    const { request, store } = await fixture(t, services);
    assert.equal((await request('/assistant', 'POST', { command: 'Yesterday.', day: '2026-11-06', conversation: Array(23).fill(turn) })).response.status, 200);
    const blocked = await request('/assistant', 'POST', { command: 'PM', day: '2026-11-06', conversation: Array(24).fill(turn) });
    assert.equal(blocked.response.status, 400);
    assert.match(blocked.data.error, /Start a new instruction/);
    assert.equal(calls, 1);
    assert.equal((await store.listEntries()).length, 0);
});
test('Feeding API normalizes legacy inputs, reviews subtype changes, and exports exact feeding details', async (t) => {
    const { request, store } = await fixture(t);
    const created = await request('/entries', 'POST', { ...entry, activity: 'bottle feeding', notes: '30 ml. Keep the source.' });
    assert.equal(created.response.status, 201);
    assert.equal(created.data.activity, 'feeding');
    assert.equal(created.data.feedingType, 'Bottle');
    const saved = created.data;
    const proposal = (await store.propose([{ type: 'update_entry', id: saved.id, version: saved.version, entry: { ...saved, feedingType: 'Syringe' } }], 'Correct feeding subtype.'));
    assert.equal((await request('/entries')).data[0].feedingType, 'Bottle');
    assert.equal(proposal.targets[0].feedingType, 'Bottle');
    assert.equal((await request('/proposals/' + proposal.id + '/confirm', 'POST', {})).response.status, 200);
    const changed = (await request('/entries')).data[0];
    assert.equal(changed.feedingType, 'Syringe');
    assert.equal(changed.notes, saved.notes);
    assert.equal(changed.startAt, saved.startAt);
    assert.equal((await request('/entries/' + saved.id, 'PUT', { ...saved, feedingType: 'Cup' })).response.status, 409);
    for (const invalid of [{ ...changed, activity: 'sleep' }, { ...changed, feedingType: '' }, { ...changed, feedingType: 'x'.repeat(81) }])
        assert.equal((await request('/entries/' + saved.id, 'PUT', invalid)).response.status, 400);
    assert.equal((await request('/entries/' + saved.id, 'PUT', { ...changed, activity: 'walk', feedingType: null, status: 'completed' })).response.status, 200);
    const custom = await request('/entries', 'POST', { ...entry, activity: 'feeding', feedingType: 'Supplemental nursing system' });
    assert.equal(custom.data.feedingType, 'Supplemental nursing system');
    const exported = await request('/export');
    assert.deepEqual(exported.data.entries.find((value: Entry) => value.id === custom.data.id), custom.data);
});
test('retired Siri URLs return 404 without inference, credentials, or diary changes', async (t) => {
    const services = { ...defaults, assist: async (): Promise<AssistantReply> => { throw Error('Inference must not run.'); } };
    const { request, store, base, authenticatedFetch } = await fixture(t, services);
    const saved = (await store.createEntry(entry));
    for (const path of ['/siri/entry', '/siri/setup', '/siri/shortcut/rohan-iphone', '/siri/shortcut/maria-iphone', '/siri/shortcut/ipad']) {
        for (const method of ['GET', 'POST']) {
            const result = await request(path, method, method === 'GET' ? undefined : { requestId: '00000000-0000-4000-8000-000000000001', command: 'Add a nappy now.' });
            assert.equal(result.response.status, 404);
            assert.deepEqual(result.data, { error: 'This page or record was not found.' });
        }
    }
    const setup = await fetch(base + '/siri/setup');
    assert.equal(setup.status, 404);
    assert.match(setup.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual((await store.listEntries()), [saved]);
    assert.equal((await request('/health')).response.status, 200);
});
test('Tummy time and Face wash have independent versions, dates, exports, and confirmed proposals', async (t) => {
    const { request, store } = await fixture(t);
    for (const key of ['tummy_time', 'face_wash'] as const) {
        const initial = (await request('/care/2026-11-03')).data[key];
        assert.deepEqual(initial, { done: false, version: 0 });
        const saved = await request('/care/2026-11-03', 'PUT', { key, done: true, version: 0 });
        assert.equal(saved.response.status, 200);
        assert.deepEqual(saved.data, { done: true, version: 1 });
        assert.equal((await request('/care/2026-11-03', 'PUT', { key, done: false, version: 0 })).response.status, 409);
        assert.deepEqual((await request('/care/2026-11-04')).data[key], { done: false, version: 0 });
    }
    const proposal = (await store.propose([{ type: 'set_care', day: '2026-11-03', key: 'tummy_time', done: false, version: 1 }, { type: 'set_care', day: '2026-11-03', key: 'face_wash', done: false, version: 1 }], 'Clear both checks.'));
    assert.equal((await store.getCare('2026-11-03')).face_wash.done, true);
    assert.equal((await request('/proposals/' + proposal.id + '/confirm', 'POST', {})).response.status, 200);
    assert.deepEqual((await store.getCare('2026-11-03')).tummy_time, { done: false, version: 2 });
    assert.deepEqual((await store.getCare('2026-11-03')).face_wash, { done: false, version: 2 });
    assert.equal((await store.getCare('2026-11-03')).vitamin_d.version, 0);
    assert.equal((await store.getCare('2026-11-03')).cord.version, 0);
    assert.equal((await request('/care/2026-11-03', 'PUT', { key: 'unknown_check', done: true, version: 0 })).response.status, 404);
    assert.equal((await request('/export')).data.care.filter((row: any) => ['tummy_time', 'face_wash'].includes(row.key)).length, 2);
    const stale = (await store.propose([{ type: 'set_care', day: '2026-11-03', key: 'face_wash', done: true, version: 2 }, { type: 'set_care', day: '2026-11-03', key: 'tummy_time', done: true, version: 2 }], 'Mark both done.'));
    (await store.setCare('2026-11-03', 'tummy_time', true, 2));
    await assert.rejects(async () => (await store.confirm(stale.id)), /changed/);
    assert.equal((await store.getCare('2026-11-03')).face_wash.done, false);
});
test('manual edit undo uses server snapshots and rejects old or repeated receipts', async (t) => {
    const { request } = await fixture(t);
    const old = (await request('/entries', 'POST', entry)).data;
    assert.equal((await request('/entries/' + old.id + '/undo')).data.undo, null);
    const edited = (await request('/entries/' + old.id, 'PUT', { ...old, startAt: '2026-11-03T13:00:00.000Z', notes: 'Wrong start.' })).data;
    const undo = (await request('/entries/' + old.id + '/undo')).data.undo;
    assert.equal(undo.changes[0].entry.startAt, old.startAt);
    assert.equal((await request('/entries/' + old.id + '/undo', 'POST', {})).response.status, 400);
    assert.equal((await request('/entries/' + old.id + '/undo', 'POST', { undoId: crypto.randomUUID() })).response.status, 409);
    const restored = await request('/entries/' + old.id + '/undo', 'POST', { undoId: undo.id, entry: { ...old, notes: 'Untrusted.' } });
    assert.equal(restored.response.status, 200);
    assert.equal(restored.data.startAt, old.startAt);
    assert.equal(restored.data.notes, old.notes);
    assert.ok(restored.data.version > edited.version);
    assert.equal((await request('/entries/' + old.id + '/undo', 'POST', { undoId: undo.id })).response.status, 409);
    assert.equal((await request('/entries/' + old.id, 'PUT', edited)).response.status, 409);
});
test('missing Assistant key blocks inference, uploads, and pending confirmations but keeps manual entry', async (t) => {
    const { request, store, base, authenticatedFetch } = await fixture(t, {
        assist: async () => { assert.fail('Disabled inference must not run.'); },
        transcribe: async () => { assert.fail('Disabled transcription must not run.'); },
        speak: async () => { assert.fail('Disabled speech must not run.'); }
    });
    const proposal = (await store.propose([{ type: 'create_entry', entry }], 'Pending before restart.'));
    for (const key of ['', '   ']) {
        config.openrouterApiKey = key;
        const settings = await request('/config');
        assert.equal(settings.data.assistantAvailable, false);
        assert.equal(settings.data.transcriptionAvailable, false);
        assert(!JSON.stringify(settings.data).includes('openrouterApiKey'));
        for (const path of ['/assistant', '/speech', '/proposals/' + proposal.id + '/confirm', '/proposals/' + proposal.id + '/reject']) {
            assert.equal((await request(path, 'POST', {})).response.status, 503);
        }
        const upload = await authenticatedFetch(base + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data' }, body: 'Invalid upload.' });
        assert.equal(upload.status, 503);
    }
    assert.equal((await store.getProposal(proposal.id)).status, 'pending');
    assert.equal((await store.listEntries()).length, 0);
    config.openrouterApiKey = 'private-test-key';
    config.sttUrl = '';
    config.ttsUrl = '';
    const enabled = await request('/config');
    assert.equal(enabled.data.assistantAvailable, true);
    assert.equal(enabled.data.transcriptionAvailable, false);
    assert(!JSON.stringify(enabled.data).includes('private-test-key'));
    assert.equal((await request('/transcribe', 'POST', {})).response.status, 503);
    assert.equal((await request('/speech', 'POST', { text: 'Test.' })).response.status, 503);
    assert.equal((await request('/proposals/' + proposal.id + '/confirm', 'POST', {})).response.status, 200);
    assert.equal((await request('/entries', 'POST', { ...entry, startAt: '2026-11-03T13:00:00.000Z' })).response.status, 201);
});

test('retired reminders and push routes return 404 and expose no configuration or export data', async t => {
    const {request} = await fixture(t);
    for (const [path, method] of [
        ['/reminders', 'GET'], ['/reminders/feeding', 'PUT'],
        ['/push/status', 'POST'], ['/push/subscribe', 'POST'],
        ['/push/unsubscribe', 'POST'], ['/push/test', 'POST']
    ]) assert.equal((await request(path, method, method === 'GET' ? undefined : {})).response.status, 404);
    const settings = (await request('/config')).data;
    for (const key of ['pushReady', 'vapidPublicKey', 'vapidPrivateKey']) assert.equal(key in settings, false);
    const saved = await request('/entries', 'POST', entry);
    assert.equal(saved.response.status, 201);
    const exported = (await request('/export')).data;
    assert.equal(exported.entries[0].id, saved.data.id);
    for (const key of ['reminders', 'subscriptions', 'reminderDeliveries']) assert.equal(key in exported, false);
});

test('keyed entry saves validate requests and replay completed creates and edits',async t=>{
 const {randomUUID}=await import('node:crypto');const {request,authenticatedFetch,base}=await fixture(t);
 const key=randomUUID();
 assert.equal((await fetch(base+'/api/entry-saves/'+key,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entry})})).status,401);
 assert.equal((await request('/entry-saves/invalid','POST',{entry})).response.status,400);
 assert.equal((await request('/entry-saves/'+key,'POST',{id:'invalid',entry})).response.status,400);
 const saved=await request('/entry-saves/'+key,'POST',{entry});assert.equal(saved.response.status,200);
 assert.deepEqual((await request('/entry-saves/'+key,'POST',{entry})).data,saved.data);
 assert.equal((await request('/entry-saves/'+key,'POST',{entry:{...entry,notes:'Changed.'}})).response.status,409);
 const editKey=randomUUID(),edit={...saved.data,notes:'Edited.'};
 const edited=await request('/entry-saves/'+editKey,'POST',{id:saved.data.id,entry:edit});assert.equal(edited.response.status,200);
 assert.deepEqual((await request('/entry-saves/'+editKey,'POST',{id:saved.data.id,entry:edit})).data,edited.data);
 assert.equal((await request('/entries')).data.length,1);
 assert.equal((await authenticatedFetch(base+'/api/health')).status,200);
});

test('closing a transcription request aborts its provider work',async t=>{
 let started!:()=>void,stopped!:()=>void;
 const received=new Promise<void>(resolve=>{started=resolve;}),aborted=new Promise<void>(resolve=>{stopped=resolve;});
 const transcribe=async(_audio:Buffer,_timing?:unknown,_recording?:unknown,signal?:AbortSignal)=>{
  assert(signal);started();return new Promise<string>((_resolve,reject)=>signal.addEventListener('abort',()=>{stopped();reject(signal.reason);},{once:true}));
 };
 const {base,authenticatedFetch}=await fixture(t,{...defaults,transcribe});
 const controller=new AbortController(),form=new FormData();form.append('audio',new Blob(['synthetic audio']),'recording.wav');
 const pending=authenticatedFetch(base+'/api/transcribe',{method:'POST',body:form,signal:controller.signal});
 const rejected=assert.rejects(pending,error=>(error as Error).name==='AbortError');await received;controller.abort();await rejected;
 await aborted;
});
