import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {testStore, testAuth} from './postgres-fixture.ts';
import { createApp } from '../src/server/app.ts';
import { config } from '../src/server/settings.ts';
const credentials = { username: 'household', password: 'Synthetic household password 123' };
async function fixture(t: TestContext, configured = credentials) {
    const store = (await testStore()), auth = (await testAuth(store, configured));
    const server = createApp(store, undefined, auth).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address === 'object');
    t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); (await store.close()); });
    const request = async (path: string, method = 'GET', body?: unknown, cookie = '', origin = '') => {
        const response = await fetch(`http://127.0.0.1:${address.port}/api` + path, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) }, body: body ? JSON.stringify(body) : undefined });
        return { response, data: await response.json() };
    };
    const login = async (cookie = '') => { const result = await request('/auth/login', 'POST', credentials, cookie); assert.equal(result.response.status, 200); return result.response.headers.get('set-cookie')!.split(';')[0]; };
    return { store, auth, request, login };
}
test('anonymous access stays closed; household devices share the diary without account APIs', async (t) => {
    const { request, login } = await fixture(t);
    assert.deepEqual((await request('/health')).data, { ok: true });
    assert.equal((await request('/auth/session')).data.user, null);
    for (const path of ['/entries', '/export', '/care-tasks', '/config'])
        assert.equal((await request(path)).response.status, 401);
    for (const path of ['/assistant', '/transcribe', '/proposals/any/confirm'])
        assert.equal((await request(path, 'POST', {})).response.status, 401);
    const first = await login(), second = await login();
    assert.equal((await request('/entries', 'POST', { activity: 'bath', startAt: '2026-11-17T10:00:00Z' }, first)).response.status, 201);
    assert.equal((await request('/entries', 'GET', undefined, second)).data.length, 1);
    for (const [path, method] of [['/users', 'GET'], ['/users', 'POST'], ['/users/any', 'PUT'], ['/users/any/password', 'POST'], ['/auth/password', 'POST']])
        assert.equal((await request(path, method, method === 'GET' ? undefined : { password: 'unused' }, first)).response.status, 404);
    assert.equal((await request('/auth/login', 'POST', credentials, '', 'https://other.invalid')).response.status, 403);
});
test('login rotates only its device token and HTTPS cookies stay protected', async (t) => {
    const previous = config.publicOrigin;
    config.publicOrigin = 'HTTPS://babylog.example';
    t.after(() => { config.publicOrigin = previous; });
    const { request, login } = await fixture(t), first = await login(), second = await login();
    const rotated = await request('/auth/login', 'POST', credentials, first, 'https://babylog.example');
    assert.equal(rotated.response.status, 200);
    const header = rotated.response.headers.get('set-cookie')!;
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/'])
        assert(header.includes(flag));
    const cookie = header.split(';')[0];
    assert.equal((await request('/entries', 'GET', undefined, first)).response.status, 401);
    assert.equal((await request('/entries', 'GET', undefined, second)).response.status, 200);
    await request('/auth/logout', 'POST', {}, cookie);
    assert.equal((await request('/entries', 'GET', undefined, cookie)).response.status, 401);
    assert.equal((await request('/entries', 'GET', undefined, second)).response.status, 200);
});
test('missing setup stays closed, wrong credentials are generic, and login attempts are limited', async (t) => {
    const empty = await fixture(t, { username: '', password: '' });
    assert.equal((await empty.request('/auth/session')).data.setupRequired, true);
    assert.equal((await empty.request('/auth/login', 'POST', credentials)).response.status, 503);
    const { request, login } = await fixture(t);
    for (let i = 0; i < 10; i++) {
        const wrong = await request('/auth/login', 'POST', { ...credentials, password: 'wrong' });
        assert.equal(wrong.response.status, 401);
        assert.equal(wrong.data.error, 'The username or password is incorrect.');
    }
    const limited = await request('/auth/login', 'POST', credentials);
    assert.equal(limited.response.status, 429);
    assert(Number(limited.response.headers.get('Retry-After')) > 0);
    assert(Number(limited.response.headers.get('Retry-After')) <= 900);
    assert.equal(limited.response.headers.get('set-cookie'), null);
    const spoofed = await fetch(limited.response.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.99', 'X-Real-IP': '198.51.100.5' }, body: JSON.stringify({ ...credentials, username: 'another-user' }) });
    assert.equal(spoofed.status, 429);
    assert(Number(spoofed.headers.get('Retry-After')) > 0);
    assert.equal(spoofed.headers.get('set-cookie'), null);
});
