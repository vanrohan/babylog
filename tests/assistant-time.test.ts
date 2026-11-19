import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDateTime, resolveSleepInterval } from '../src/server/assistant-time.ts';
import {assistantMessages} from '../src/server/assistant.ts';
import { assistantConversationError, assistantConversationLimit } from '../src/shared.ts';
import {testStore, testAssistantOperations} from './postgres-fixture.ts';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { TestContext } from 'node:test';
import { assist } from '../src/server/assistant.ts';
import { config } from '../src/server/settings.ts';
test('datetime calculator adds elapsed minutes across date boundaries and supports earlier times', () => {
    for (const [from, minutes, expected] of [
        ['2026-11-06T19:45', 10, '2026-11-06T19:55'],
        ['2026-11-06T19:55', 10, '2026-11-06T20:05'],
        ['2026-12-31T23:55', 10, '2027-01-01T00:05'],
        ['2026-12-01T00:05', -10, '2026-11-30T23:55'],
        ['2026-11-06T19:45', 0, '2026-11-06T19:45'],
        ['2026-11-06T19:45', 10080, '2026-11-13T19:45'],
        ['2026-11-06T19:45', -10080, '2026-10-30T19:45'],
    ] as const) {
        const result = calculateDateTime({ from, minutes });
        assert.equal(result.local, expected);
        assert.equal(result.proposalTime, expected);
        assert.equal(result.timeZone, 'Europe/Berlin');
    }
});
test('datetime calculator rejects invalid dates, missing occurrences, offsets, and invalid minute counts', () => {
    for (const from of ['2026-02-30T12:00', '2026-03-29T02:30', '2026-10-25T02:30', '2026-10-25T02:30:00+03:00', '2026-11-06T19:45:00+01:00', '2026-11-06T18:45:00Z']) {
        assert.throws(() => calculateDateTime({ from, minutes: 10 }));
    }
    for (const minutes of [1.5, -10081, 10081, Infinity, NaN, '10', null, undefined])
        assert.throws(() => calculateDateTime({ from: '2026-11-06T19:45', minutes }));
});
test('datetime calculator preserves elapsed time through spring and both autumn occurrences in proposals', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    for (const [from, minutes, expected] of [
        ['2026-03-29T01:55', 10, '2026-03-29T03:05'],
        ['2026-10-25T01:55', 60, '2026-10-25T02:55:00+02:00'],
        ['2026-10-25T01:55', 120, '2026-10-25T02:55:00+01:00'],
        ['2026-10-25T02:55:00+02:00', 10, '2026-10-25T02:05:00+01:00'],
        ['2026-10-25T02:05:00+01:00', -10, '2026-10-25T02:55:00+02:00'],
    ] as const) {
        const result = calculateDateTime({ from, minutes });
        assert.equal(result.proposalTime, expected);
        const proposal = (await store.propose((await testAssistantOperations([{ type: 'create_entry', entry: { activity: 'nappy', startAt: result.proposalTime, endAt: null, status: 'completed', pee: true, poo: false, temperature: null, notes: '' } }], store)), 'Nappy.'));
        const operation = proposal.operations[0];
        assert(operation.type === 'create_entry');
        assert.equal(operation.entry.startAt, result.utc);
    }
    assert.equal((await store.listEntries()).length, 0);
});
test('assistant messages keep chronological roles, original times, and earlier corrections beyond six turns', () => {
    const history = Array.from({ length: 8 }, (_, i) => ({ command: i === 0 ? 'Log a bath at 7:45.' : i === 1 ? 'Yesterday.' : `Clarification ${i}.`, reply: `Question ${i}?`, at: '2026-11-06T19:41:00Z' }));
    const messages = assistantMessages('PM', history, new Date('2026-11-06T23:30:00Z'));
    assert.equal(messages.length, 17);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[1].role, 'assistant');
    assert.match(String(messages[0].content), /2026-11-06T20:41 Europe\/Berlin/);
    assert.match(String(messages[2].content), /Yesterday/);
    assert.match(String(messages[16].content), /2026-11-07T00:30/);
    for (let i = 0; i < messages.length; i++)
        assert.equal(messages[i].role, i % 2 ? 'assistant' : 'user');
});
test('assistant conversation limits preserve the last allowed reply and reject large UTF-8 requests', () => {
    const turn = { command: 'Bath at seven.', reply: 'Which day?', at: '2026-11-06T19:41:00Z' };
    assert.equal(assistantConversationError('Today.', '2026-11-06', Array(assistantConversationLimit - 1).fill(turn)), null);
    assert.match(assistantConversationError('Today.', '2026-11-06', Array(assistantConversationLimit).fill(turn))!, /Start a new instruction/);
    const large = Array(20).fill({ ...turn, command: '\u{1f600}'.repeat(2000) });
    assert.match(assistantConversationError('Today.', '2026-11-06', large)!, /too long/);
});
async function modelFixture(t: TestContext, respond: (body: any, call: number) => object | Promise<object>) {
    let calls = 0;
    const server = createServer(async (req, res) => {
        assert.equal(req.url, '/v1/chat/completions');
        assert.equal(req.headers.authorization, 'Bearer test-key');
        let body = '';
        for await (const chunk of req)
            body += chunk;
        const delta = await respond(JSON.parse(body), ++calls);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const chunk = (value: object, reason: string | null) => JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 0, model: config.model, choices: [{ index: 0, delta: value, finish_reason: reason }] });
        res.end(`data: ${chunk({ role: 'assistant', ...delta }, null)}\n\ndata: ${chunk({}, 'tool_calls' in delta ? 'tool_calls' : 'stop')}\n\ndata: [DONE]\n\n`);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address === 'object');
    const previousKey = config.openrouterApiKey;
    config.openrouterApiKey = 'test-key';
    const old = config.llmBaseUrl;
    config.llmBaseUrl = `http://127.0.0.1:${address.port}/v1`;
    t.after(() => { config.llmBaseUrl = old; config.openrouterApiKey = previousKey; server.closeAllConnections(); server.close(); });
    return () => calls;
}
test('Pi recovers a text-only reply, uses the datetime tool, and returns a proposal without saving', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const toolCall = (name: string, args: object) => ({ tool_calls: [{ index: 0, id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    const calls = await modelFixture(t, (body, call) => {
        assert.equal(body.tool_choice, 'required');
        assert.equal(body.temperature, 0);
        assert.deepEqual(body.tools.map((tool: any) => tool.function.name).sort(), ['ask_question', 'calculate_datetime', 'propose_changes', 'read_day']);
        if (call === 1)
            return { content: 'I recorded the nappy change.' };
        if (call === 2)
            return toolCall('calculate_datetime', { from: '2026-11-06T19:55', minutes: 10 });
        const result = JSON.parse(body.messages.findLast((message: any) => message.role === 'tool').content);
        assert.equal(result.proposalTime, '2026-11-06T20:05');
        return toolCall('propose_changes', { summary: 'Nappy at 20:05.', operationsJson: JSON.stringify([{ type: 'create_entry', entry: { activity: 'nappy', feedingType: null, startAt: result.proposalTime, endAt: null, status: 'completed', pee: true, poo: true, temperature: null, notes: '' } }]) });
    });
    const reply = await assist(store, 'Nappy with pee and poo ten minutes after 19:55.', '2026-11-06', [], new Date('2026-11-06T19:41:00Z'));
    assert(reply.proposal);
    assert.equal(calls(), 3);
    assert.equal((await store.listEntries()).length, 0);
    const operation = reply.proposal.operations[0];
    assert(operation.type === 'create_entry');
    assert.equal(operation.entry.startAt, '2026-11-06T19:05:00.000Z');
});
test('Pi rejects repeated success claims, including claims followed by a question', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const calls = await modelFixture(t, () => ({ content: 'I saved it. Anything else?' }));
    await assert.rejects(() => assist(store, 'Nappy now.', '2026-11-06'), /did not prepare a proposal/);
    assert.equal(calls(), 2);
    assert.equal((await store.listEntries()).length, 0);
});
test('Pi returns a clarification tool result without an internal retry', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const calls = await modelFixture(t, body => {
        assert.equal(body.tool_choice, 'required');
        return { tool_calls: [{ index: 0, id: 'question', type: 'function', function: { name: 'ask_question', arguments: JSON.stringify({ question: 'Which breast: left, right, or both?' }) } }] };
    });
    const reply = await assist(store, 'Breastfeeding now.', '2026-11-06');
    assert.equal(reply.proposal, null);
    assert.match(reply.message, /Which breast/);
    assert.equal(calls(), 1);
});
test('Pi retries a plain question instead of accepting an unstructured response', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const calls = await modelFixture(t, (_body, call) => call === 1 ? { content: 'Which breast?' } : { tool_calls: [{ index: 0, id: 'question', type: 'function', function: { name: 'ask_question', arguments: JSON.stringify({ question: 'Which breast: left, right, or both?' }) } }] });
    const reply = await assist(store, 'Breastfeeding now.', '2026-11-06');
    assert.equal(reply.proposal, null);
    assert.match(reply.message, /Which breast/);
    assert.equal(calls(), 2);
    assert.equal((await store.listEntries()).length, 0);
});
test('simple sleep intervals use the most recent past end and preserve explicit clock forms', () => {
    const now = new Date('2026-11-07T02:23:00Z');
    for (const [command, start, end] of [
        ['Log a sleeping session from 1 to 3.', '2026-11-07T00:00:00.000Z', '2026-11-07T02:00:00.000Z'],
        ['She slept from 11 to 12:10.', '2026-11-06T22:00:00.000Z', '2026-11-06T23:10:00.000Z'],
        ['Sleep from 01:00 to 03:00.', '2026-11-07T00:00:00.000Z', '2026-11-07T02:00:00.000Z'],
        ['Sleep from 1 pm to 3 pm.', '2026-11-06T12:00:00.000Z', '2026-11-06T14:00:00.000Z'],
    ] as const)
        assert.deepEqual(resolveSleepInterval(command, [], now), { startAt: start, endAt: end });
    assert.deepEqual(resolveSleepInterval('Sleep from 11 to 12:10.', [], new Date('2026-11-06T23:20:00Z')), { startAt: '2026-11-06T22:00:00.000Z', endAt: '2026-11-06T23:10:00.000Z' });
});
test('AM corrections override cancelled summaries on the first reply and keep the original request time', () => {
    const conversation = [{ command: 'Log a sleeping session from 1 to 3.', reply: 'Add sleep 2026-11-06 13:00-15:00. Changes cancelled. Nothing is saved.', at: '2026-11-07T02:23:00Z' }];
    const expected = { startAt: '2026-11-07T00:00:00.000Z', endAt: '2026-11-07T02:00:00.000Z' };
    for (const reply of ['AM obviously', 'AM', 'a.m.'])
        assert.deepEqual(resolveSleepInterval(reply, conversation, new Date('2026-11-08T00:30:00Z')), expected);
    assert.deepEqual(resolveSleepInterval('AM', [...conversation, { command: 'AM obviously', reply: conversation[0].reply, at: '2026-11-07T02:24:00Z' }], new Date('2026-11-07T02:25:00Z')), expected);
    assert.deepEqual(resolveSleepInterval('AM', [{ ...conversation[0], command: 'Sleep from 11 pm to 3.' }], new Date()), { startAt: '2026-11-06T22:00:00.000Z', endAt: '2026-11-07T02:00:00.000Z' });
    assert.deepEqual(resolveSleepInterval('PM', [...conversation, { command: 'AM obviously', reply: 'Sleep 01:00-03:00. Changes cancelled.', at: '2026-11-07T02:24:00Z' }], new Date('2026-11-08T00:30:00Z')), { startAt: '2026-11-06T12:00:00.000Z', endAt: '2026-11-06T14:00:00.000Z' });
    assert.deepEqual(resolveSleepInterval('PM', [{ ...conversation[0], command: 'Sleep from 01:00 to 03:00.' }], new Date('2026-11-08T00:30:00Z')), expected);
});
test('simple interval resolution skips dates, edits, batches, unclear replies, and invalid or repeated clock times', () => {
    const now = new Date('2026-11-07T02:23:00Z');
    for (const command of ['Sleep from 1 to 3 today.', 'Sleep from 1 to 3 on 1 November.', 'Edit sleep from 1 to 3.', 'Sleep from 1 to 3 and nappy at 3.', 'Sleep from 1:99 to 3.', 'Sleep from 13 am to 3.'])
        assert.equal(resolveSleepInterval(command, [], now), null, command);
    assert.equal(resolveSleepInterval('Yesterday', [{ command: 'Sleep from 1 to 3.', reply: 'Which day?', at: now.toISOString() }], now), null);
    for (const date of ['2026-10-25T03:30:00Z', '2026-03-29T03:30:00Z'])
        assert.equal(resolveSleepInterval('Sleep from 2:30 to 3:15.', [], new Date(date)), null);
});
test('Pi rejects an incorrect sleep interval before creating a proposal and accepts the corrected tool call', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const calls = await modelFixture(t, async (body, call) => {
        assert.match(body.messages[0].content, /2026-11-07T01:00 through 2026-11-07T03:00/);
        if (call === 2) {
            assert.equal(Number((await store.database.query('SELECT COUNT(*) AS count FROM proposals')).rows[0].count), 0);
            assert.match(JSON.stringify(body.messages), /Use exactly one completed sleep/);
        }
        return { tool_calls: [{ index: 0, id: 'proposal' + call, type: 'function', function: { name: 'propose_changes', arguments: JSON.stringify({ summary: 'Sleep 01:00-03:00.', operationsJson: JSON.stringify([{ type: 'create_entry', entry: { activity: 'sleep', startAt: call === 1 ? '2026-11-06T13:00' : '2026-11-07T01:00', endAt: call === 1 ? '2026-11-06T15:00' : '2026-11-07T03:00', status: 'completed', pee: false, poo: false, temperature: null, notes: '' } }]) }) } }] };
    });
    const reply = await assist(store, 'AM obviously', '2026-10-01', [{ command: 'Log a sleeping session from 1 to 3.', reply: 'Sleep yesterday 13:00-15:00. Changes cancelled.', at: '2026-11-07T02:23:00Z' }], new Date('2026-11-07T02:24:00Z'));
    assert(reply.proposal);
    assert.equal(calls(), 2);
    assert.equal((await store.listEntries()).length, 0);
});
test('OpenRouter errors do not expose the key or change the diary', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const previous = { key: config.openrouterApiKey, url: config.llmBaseUrl };
    config.openrouterApiKey = 'private-error-test-key';
    const server = createServer((_req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid key: private-error-test-key', type: 'authentication_error' } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address === 'object');
    config.llmBaseUrl = `http://127.0.0.1:${address.port}/v1`;
    t.after(() => { config.openrouterApiKey = previous.key; config.llmBaseUrl = previous.url; server.closeAllConnections(); server.close(); });
    await assert.rejects(assist(store, 'Add a bath now.', '2026-11-17'), error => {
        assert(error instanceof Error);
        assert.match(error.message, /unavailable/);
        assert(!error.message.includes('private-error-test-key'));
        return true;
    });
    assert.equal((await store.listEntries()).length, 0);
});
