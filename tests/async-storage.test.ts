import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { createServer } from 'node:http';
import {testStore, testAuth} from './postgres-fixture.ts';
import { createApp } from '../src/server/app.ts';
import { AppError } from '../src/server/schema.ts';
import { assist } from '../src/server/assistant.ts';
import { config } from '../src/server/settings.ts';
import type { DiaryStore, HouseholdAuthentication } from '../src/server/storage.ts';
const credentials = { username: 'household', password: 'Synthetic async password 123' };
const entry = { activity: 'bath', startAt: '2026-11-03T10:00:00.000Z', endAt: null, status: 'completed', pee: false, poo: false, temperature: null, notes: 'Async fixture.' };
function asynchronous<T extends object>(source: T): T {
    const overrides = new Map<PropertyKey, unknown>();
    return new Proxy(source, { get(target, key) {
            if (overrides.has(key))
                return overrides.get(key);
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? async (...args: unknown[]) => { await setImmediate(); return value.apply(target, args); } : value;
        }, set(_target, key, value) { overrides.set(key, value); return true; } });
}
async function fixture(t: TestContext) {
    const original = (await testStore());
    const accounts = (await testAuth(original, credentials));
    const store: DiaryStore = asynchronous(original);
    const auth: HouseholdAuthentication = asynchronous(accounts);
    const server = createApp(store, undefined, auth).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}/api`;
    t.after(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); (await original.close()); });
    async function request(path: string, method = 'GET', body?: unknown, cookie = '') {
        const response = await fetch(base + path, { method, headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { response, data: await response.json() };
    }
    async function login() { const result = await request('/auth/login', 'POST', credentials); assert.equal(result.response.status, 200); return result.response.headers.get('set-cookie')!.split(';')[0]; }
    return { original, accounts, store, auth, request, login };
}
test('async authentication blocks anonymous and expired sessions before diary reads', async (t) => {
    const { original, accounts, request, login } = await fixture(t);
    let reads = 0;
    const listEntries = original.listEntries.bind(original);
    original.listEntries = (...args) => { reads++; return listEntries(...args); };
    const anonymous = await request('/entries');
    assert.equal(anonymous.response.status, 401);
    assert.equal(reads, 0);
    const cookie = await login();
    assert.equal((await request('/entries', 'GET', undefined, cookie)).response.status, 200);
    assert.equal(reads, 1);
    (await accounts.logout(cookie.slice('babylog_session='.length)));
    const expired = await request('/entries', 'GET', undefined, cookie);
    assert.equal(expired.response.status, 401);
    assert.equal(reads, 1);
    assert.equal((await request('/auth/session', 'GET', undefined, cookie)).data.user, null);
    accounts.session = () => { throw new AppError('Authentication is temporarily unavailable.', 503); };
    const failed = await request('/entries', 'GET', undefined, cookie);
    assert.equal(failed.response.status, 503);
    assert.equal(reads, 1);
});
test('async HTTP storage resolves writes, stale errors, undo, task rename, and exports', async (t) => {
    const { request, login } = await fixture(t);
    const first = await login(), second = await login();
    const created = await request('/entries', 'POST', entry, first);
    assert.equal(created.response.status, 201);
    assert.equal(typeof created.data.id, 'string');
    const saved = created.data;
    assert.equal((await request('/entries', 'GET', undefined, second)).data[0].id, saved.id);
    const edited = await request('/entries/' + saved.id, 'PUT', { ...saved, notes: 'Changed from the second device.' }, second);
    assert.equal(edited.response.status, 200);
    assert.equal(edited.data.version, 2);
    assert.equal((await request('/entries/' + saved.id, 'PUT', { ...saved, notes: 'Stale.' }, first)).response.status, 409);
    const receipt = (await request('/entries/' + saved.id + '/undo', 'GET', undefined, first)).data.undo;
    const restored = await request('/entries/' + saved.id + '/undo', 'POST', { undoId: receipt.id }, first);
    assert.equal(restored.response.status, 200);
    assert.equal(restored.data.notes, entry.notes);
    const task = (await request('/care-tasks', 'POST', { label: 'Walk outside' }, first)).data;
    const renamed = (await request('/care-tasks/' + task.key, 'PUT', { label: 'Morning walk', version: task.version }, second)).data;
    assert.equal(renamed.label, 'Morning walk');
    assert.equal(renamed.version, 2);
    const checked = await request('/care/2026-11-03', 'PUT', { key: task.key, done: true, version: 0, taskVersion: renamed.version }, first);
    assert.deepEqual(checked.data, { done: true, version: 1 });
    assert.equal((await request('/care-tasks/' + task.key, 'DELETE', { version: renamed.version }, second)).response.status, 200);
    const exported = (await request('/export', 'GET', undefined, first)).data;
    assert.equal(exported.entries[0].notes, entry.notes);
    assert.equal(exported.careTasks.find((row: any) => row.key === task.key).active, false);
    assert.equal(exported.care.find((row: any) => row.key === task.key).done, 1);
    assert.equal((await request('/entries/' + saved.id, 'DELETE', { version: restored.data.version }, second)).response.status, 200);
    assert.deepEqual((await request('/entries', 'GET', undefined, first)).data, []);
});
test('async Assistant reads resolved records and preserves exact unchanged times until confirmation', async (t) => {
    const original = (await testStore());
    t.after(async () => (await original.close()));
    const saved = (await original.createEntry({ ...entry, startAt: '2026-10-25T01:30:29.123Z' }));
    const store: DiaryStore = asynchronous(original);
    let calls = 0;
    const server = createServer(async (req, res) => {
        let raw = '';
        for await (const chunk of req)
            raw += chunk;
        const body = JSON.parse(raw);
        calls++;
        const name = calls === 1 ? 'read_day' : 'propose_changes';
        if (calls === 2) {
            const result = JSON.parse(body.messages.findLast((message: any) => message.role === 'tool').content);
            assert.equal(result.entries[0].id, saved.id);
            assert.equal(result.entries[0].startAt, '2026-10-25T02:30');
            assert.equal(result.care.vitamin_d.version, 0);
        }
        const args = calls === 1 ? { day: '2026-10-25' } : { summary: 'Update bath note.', operationsJson: JSON.stringify([{ type: 'update_entry', id: saved.id, version: saved.version, entry: { ...saved, startAt: '2026-10-25T02:30', notes: 'Keep exact time.' } }]) };
        const delta = { tool_calls: [{ index: 0, id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
        const chunk = (value: object, reason: string | null) => JSON.stringify({ id: 'async-assistant', object: 'chat.completion.chunk', created: 0, model: config.model, choices: [{ index: 0, delta: value, finish_reason: reason }] });
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(`data: ${chunk({ role: 'assistant', ...delta }, null)}\n\ndata: ${chunk({}, 'tool_calls')}\n\ndata: [DONE]\n\n`);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address === 'object');
    const previous = { key: config.openrouterApiKey, url: config.llmBaseUrl };
    config.openrouterApiKey = 'synthetic-key';
    config.llmBaseUrl = `http://127.0.0.1:${address.port}/v1`;
    t.after(() => { config.openrouterApiKey = previous.key; config.llmBaseUrl = previous.url; server.closeAllConnections(); server.close(); });
    const reply = await assist(store, 'Change the bath note on 25 October 2026.', '2026-10-25');
    assert(reply.proposal);
    assert.equal(calls, 2);
    assert.equal((await original.getEntry(saved.id)).notes, entry.notes);
    const operation = reply.proposal.operations[0];
    assert.equal(operation.type, 'update_entry');
    if (operation.type === 'update_entry')
        assert.equal(operation.entry.startAt, saved.startAt);
    await store.confirm(reply.proposal.id);
    assert.equal((await original.getEntry(saved.id)).notes, 'Keep exact time.');
    assert.equal((await original.getEntry(saved.id)).startAt, saved.startAt);
});
