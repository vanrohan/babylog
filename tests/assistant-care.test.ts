import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { assist } from '../src/server/assistant.ts';
import {testStore} from './postgres-fixture.ts';
import { config } from '../src/server/settings.ts';
const tool = (name: string, args: object) => ({ tool_calls: [{ index: 0, id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
async function modelFixture(t: TestContext, respond: (body: any, call: number) => object | Promise<object>) {
    let calls = 0;
    const server = createServer(async (req, res) => {
        assert.equal(req.url, '/v1/chat/completions');
        assert.equal(req.headers.authorization, 'Bearer test-key');
        let raw = '';
        for await (const chunk of req)
            raw += chunk;
        const delta = await respond(JSON.parse(raw), ++calls);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const chunk = (value: object, reason: string | null) => JSON.stringify({ id: 'care-test', object: 'chat.completion.chunk', created: 0, model: config.model, choices: [{ index: 0, delta: value, finish_reason: reason }] });
        res.end(`data: ${chunk({ role: 'assistant', ...delta }, null)}\n\ndata: ${chunk({}, 'tool_calls')}\n\ndata: [DONE]\n\n`);
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
test('Assistant separates daily check versions from task definition versions', async (t) => {
    const store = (await testStore());
    t.after(async () => (await store.close()));
    const original = (await store.createCareTask({ label: 'Stroll' }));
    const task = (await store.updateCareTask(original.key, { label: 'Go for a stroll' }, original.version));
    const calls = await modelFixture(t, (body, call) => {
        if (call === 1) {
            const prompt = body.messages.map((message: any) => String(message.content)).join('\n');
            const definitions = JSON.parse(prompt.match(/Active daily tasks: (\[[^\n]+\])\./)![1]);
            assert(definitions.some((item: any) => item.key === task.key && item.label === task.label));
            for (const item of definitions)
                assert.deepEqual(Object.keys(item), ['key', 'label']);
            assert.match(prompt, /copy version from that date's care\[key\]\.version/);
            return tool('read_day', { day: '2026-11-03' });
        }
        const result = JSON.parse(body.messages.findLast((message: any) => message.role === 'tool').content);
        for (const item of result.careTasks)
            assert.deepEqual(Object.keys(item), ['key', 'label']);
        assert.equal(result.care[task.key].version, 0);
        return tool('propose_changes', { summary: 'Stroll complete.', operationsJson: JSON.stringify([{ type: 'set_care', day: '2026-11-03', key: task.key, done: true, version: 0, taskVersion: 999 }]) });
    });
    const reply = await assist(store, 'Mark Go for a stroll done on 3 November 2026.', '2026-11-03');
    assert(reply.proposal);
    assert.equal(calls(), 2);
    const op = reply.proposal.operations[0];
    assert(op.type === 'set_care');
    assert.equal(op.version, 0);
    assert.equal(op.taskVersion, task.version);
    assert.equal((await store.getCare('2026-11-03'))[task.key].done, false);
    (await store.confirm(reply.proposal.id));
    assert.equal((await store.getCare('2026-11-03'))[task.key].done, true);
});
for (const change of ['rename', 'remove'] as const)
    test('Assistant rejects a task ' + change + ' during inference', async (t) => {
        const store = (await testStore());
        t.after(async () => (await store.close()));
        const task = (await store.createCareTask({ label: 'Air out apartment' }));
        const calls = await modelFixture(t, async (body, call) => {
            if (call === 1) {
                if (change === 'rename')
                    (await store.updateCareTask(task.key, { label: 'Open windows' }, task.version));
                else
                    (await store.removeCareTask(task.key, task.version));
                return tool('propose_changes', { summary: 'Daily task done.', operationsJson: JSON.stringify([{ type: 'set_care', day: '2026-11-03', key: task.key, done: true, version: 0, taskVersion: task.version + 1 }]) });
            }
            const result = body.messages.findLast((message: any) => message.role === 'tool').content;
            assert.match(result, /daily task (?:changed|was removed)/);
            return tool('ask_question', { question: 'The daily tasks changed. Can you start a new instruction?' });
        });
        const reply = await assist(store, 'Mark Air out apartment done on 3 November 2026.', '2026-11-03');
        assert.equal(reply.proposal, null);
        assert.equal(calls(), 2);
        assert.equal((await store.getCare('2026-11-03'))[task.key].done, false);
        assert.equal(Number((await store.database.query('SELECT COUNT(*) AS n FROM proposals')).rows[0].n), 0);
    });
