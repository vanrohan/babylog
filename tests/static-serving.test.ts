import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { createApp } from '../src/server/app.ts';
import {testStore, testAuth} from './postgres-fixture.ts';
import { config } from '../src/server/settings.ts';
function get(base: string, path: string, headers: Record<string, string> = {}) {
    return new Promise<{
        status: number;
        headers: IncomingHttpHeaders;
        body: string;
    }>((resolve, reject) => {
        const request = httpRequest(base + path, { headers }, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(Buffer.from(chunk)));
            response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks).toString() }));
        });
        request.on('error', reject);
        request.end();
    });
}
async function fixture(t: TestContext) {
    const directory = mkdtempSync(join(tmpdir(), 'babylog-static-')), publicDirectory = join(directory, 'public');
    mkdirSync(join(publicDirectory, 'assets'), { recursive: true });
    const oldHtml = '<!doctype html><html><body><script type="module" src="/assets/index-aaaaaaaa.js"></script><link rel="stylesheet" href="/assets/index-aaaaaaaa.css"></body></html>';
    const newHtml = oldHtml.replaceAll('aaaaaaaa', 'bbbbbbbb');
    assert.equal(Buffer.byteLength(oldHtml), Buffer.byteLength(newHtml));
    const fixed = new Date('2020-01-01T00:00:00.000Z');
    const writeHtml = (html: string) => { writeFileSync(join(publicDirectory, 'index.html'), html); utimesSync(join(publicDirectory, 'index.html'), fixed, fixed); };
    writeHtml(oldHtml);
    writeFileSync(join(publicDirectory, 'sw.js'), readFileSync('public/sw.js'));
    writeFileSync(join(publicDirectory, 'assets/index-bbbbbbbb.js'), 'window.currentRelease=true;');
    writeFileSync(join(publicDirectory, 'assets/index-bbbbbbbb.css'), 'body{color:rgb(1,2,3)}');
    let handler = express().use(express.static(publicDirectory));
    const server = createServer((request, response) => handler(request, response));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const old = await get(base, '/');
    assert.equal(old.status, 200);
    assert.ok(old.headers.etag);
    assert.ok(old.headers['last-modified']);
    const store = (await testStore()), auth = (await testAuth(store, { username: 'static-owner', password: 'Synthetic static password 123' }));
    const previous = { directory: config.clientDirectory, origin: config.publicOrigin };
    config.clientDirectory = publicDirectory;
    config.publicOrigin = '';
    writeHtml(newHtml);
    handler = createApp(store, undefined, auth);
    config.clientDirectory = previous.directory;
    config.publicOrigin = previous.origin;
    t.after(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); (await store.close()); rmSync(directory, { recursive: true, force: true }); });
    return { base, old, newHtml };
}
test('same-size release HTML ignores old validators and disables shell revalidation', async (t) => {
    const { base, old, newHtml } = await fixture(t);
    const validators = { 'If-None-Match': String(old.headers.etag), 'If-Modified-Since': String(old.headers['last-modified']), 'Cache-Control': 'max-age=0' };
    for (const path of ['/', '/index.html', '/assistant', '/dashboard']) {
        const response = await get(base, path, validators);
        assert.equal(response.status, 200, path + ' ' + JSON.stringify(response.headers));
        assert.equal(response.body, newHtml, path);
        assert.match(String(response.headers['cache-control']), /(?:^|,)\s*no-store\b/, path);
        assert.equal(response.headers.etag, undefined, path);
        assert.equal(response.headers['last-modified'], undefined, path);
        assert.match(String(response.headers['content-type']), /^text\/html\b/, path);
    }
});
test('worker scripts stay fresh and static assets keep their MIME types without HTML aliases', async (t) => {
    const { base, old } = await fixture(t);
    const worker = await get(base, '/sw.js', { 'If-None-Match': String(old.headers.etag), 'If-Modified-Since': String(old.headers['last-modified']), 'Cache-Control': 'max-age=0' });
    assert.equal(worker.status, 200);
    assert.match(String(worker.headers['cache-control']), /(?:^|,)\s*no-store\b/);
    assert.equal(worker.headers.etag, undefined);
    assert.equal(worker.headers['last-modified'], undefined);
    assert.match(String(worker.headers['content-type']), /(?:java|ecma)script/);
    const script = await get(base, '/assets/index-bbbbbbbb.js'), style = await get(base, '/assets/index-bbbbbbbb.css');
    assert.equal(script.status, 200);
    assert.match(String(script.headers['content-type']), /(?:java|ecma)script/);
    assert.equal(style.status, 200);
    assert.match(String(style.headers['content-type']), /^text\/css\b/);
    for (const path of ['/assets/index-missing1.js', '/assets/index-missing1.css']) {
        const response = await get(base, path);
        assert.equal(response.status, 404);
        assert.doesNotMatch(response.body, /<!doctype|<html/i);
    }
});
