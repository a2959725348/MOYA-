import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsDefaults } from '../server/schema.mjs';

const chat = await import('../cloudflare/chat.mjs').catch(() => null);
const enabled = { skip: !chat };
const encoder = new TextEncoder();
const requestBody = { message: '学习', mode: 'tutor' };
const delta = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const usage = 'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n';
const complete = `${delta('解释步骤')}${usage}data: [DONE]\n\n`;

test('Cloudflare chat exports its native request handler', () => {
  assert.equal(typeof chat?.handleChat, 'function');
});

async function setup(t, ai = {}) {
  const [{ createTestDB }, { D1Store, withStore }, { Vault }] = await Promise.all([
    import('./helpers/d1.mjs'), import('../cloudflare/store.mjs'), import('../cloudflare/vault.mjs'),
  ]);
  const db = await createTestDB();
  t.after(() => db.close());
  const env = { DB: db, VAULT_KEY: Buffer.alloc(32, 7).toString('base64') };
  await withStore(db, async store => {
    const settings = structuredClone(settingsDefaults);
    Object.assign(settings.ai, ai);
    store.set('settings', settings);
    new Vault(store, env.VAULT_KEY).set('ai.apiKey', 'fixture-secret');
  });
  const pending = [];
  const ctx = { waitUntil(promise) { pending.push(promise); } };
  return {
    env, ctx, withStore,
    async records() { return (await D1Store.open(db)).list('chatMessages'); },
    async store() { return D1Store.open(db); },
    async settle() { await Promise.all(pending); },
  };
}

function upstream(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

async function call(state, fetcher = async () => upstream([complete]), body = requestBody, signal, sessionHash) {
  return chat.handleChat(new Request('https://workbench.example/api/study/chat', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), state.env, state.ctx, { body, fetcher, sessionHash });
}

function events(text) {
  return text.trim().split('\n\n').filter(Boolean).map(block => JSON.parse(block.slice(6)));
}

test('successful stream persists text, usage and configured estimated cost', enabled, async t => {
  const state = await setup(t, { inputPrice: 2, outputPrice: 3 });
  const response = await call(state);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /^text\/event-stream/);
  const output = events(await response.text());
  assert.deepEqual(output, [
    { type: 'delta', text: '解释步骤' },
    { type: 'done', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.000035, currency: 'CNY', costSource: 'configured_price_estimate' } },
  ]);
  const records = await state.records();
  assert.deepEqual(records.map(({ role, content }) => ({ role, content })), [
    { role: 'user', content: '学习' }, { role: 'assistant', content: '解释步骤' },
  ]);
  assert.equal(records[1].tokens, 15);
  assert.equal(records[1].cost, 0.000035);
  assert.equal(records[1].currency, 'CNY');
});

test('concurrent requests atomically reserve a one-request daily cap', enabled, async t => {
  const state = await setup(t, { dailyRequestLimit: 1 });
  let calls = 0;
  const fetcher = async () => { calls++; return upstream([complete]); };
  const responses = await Promise.all([call(state, fetcher), call(state, fetcher)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 429]);
  await Promise.all(responses.map(response => response.text()));
  assert.equal(calls, 1);
  assert.equal((await state.store()).get('chatCounter').count, 1);
  assert.equal((await state.records()).length, 2);
});

test('done event is emitted only after the assistant record commits', enabled, async t => {
  const state = await setup(t);
  const reader = (await call(state)).body.getReader();
  let output = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += new TextDecoder().decode(value);
    if (output.includes('"type":"done"')) {
      assert.equal((await state.records()).find(record => record.role === 'assistant')?.content, '解释步骤');
      return;
    }
  }
  assert.fail('Expected a done event');
});

test('partial stream emits an error and saves no assistant answer', enabled, async t => {
  const state = await setup(t);
  const output = events(await (await call(state, async () => upstream([delta('部分回答')]))).text());
  assert.equal(output[0].type, 'delta');
  assert.equal(output.at(-1).type, 'error');
  assert.equal(output.some(event => event.type === 'done'), false);
  assert.deepEqual((await state.records()).map(record => record.role), ['user']);
});

test('CRLF split between chunks preserves SSE boundaries and completion', enabled, async t => {
  const state = await setup(t);
  const chunks = (delta('Split') + 'data: [DONE]\n\n').replaceAll('\n', '\r\n').split(/(?<=\r)/);
  const output = events(await (await call(state, async () => upstream(chunks))).text());
  assert.deepEqual(output, [{ type: 'delta', text: 'Split' }, { type: 'done' }]);
  assert.equal((await state.records())[1].content, 'Split');
});

test('empty, invalid and error streams cannot save completed answers', enabled, async t => {
  for (const source of ['', 'data: [DONE]\n\n', 'data: invalid\n\n', 'data: {"error":{"message":"fixture-secret"}}\n\n']) {
    const state = await setup(t);
    const text = await (await call(state, async () => upstream([source]))).text();
    assert.equal(events(text).at(-1).type, 'error');
    assert.equal(text.includes('fixture-secret'), false);
    assert.deepEqual((await state.records()).map(record => record.role), ['user']);
  }
});

test('upstream HTTP errors return sanitized JSON and consume the reservation', enabled, async t => {
  const state = await setup(t, { dailyRequestLimit: 1 });
  const response = await call(state, async () => new Response('private fixture-secret diagnostics', { status: 401 }));
  assert.equal(response.status, 502);
  assert.match(response.headers.get('Content-Type'), /application\/json/);
  assert.equal((await response.text()).includes('fixture-secret'), false);
  assert.equal((await state.records()).length, 0);
  assert.equal((await call(state)).status, 429);
});

test('recorded estimated daily budget blocks the next call without another reservation', enabled, async t => {
  const state = await setup(t, { dailyBudget: 0.00003, inputPrice: 2, outputPrice: 3 });
  await (await call(state)).text();
  const response = await call(state);
  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, 'ESTIMATED_BUDGET_REACHED');
  assert.equal((await state.store()).get('chatCounter').count, 1);
});

test('body validation rejects oversized or unknown input before a reservation', enabled, async t => {
  const state = await setup(t);
  for (const body of [{ message: 'x'.repeat(12001), mode: 'tutor' }, { ...requestBody, apiKey: 'x' }, { ...requestBody, mode: 'unknown' }]) {
    const response = await call(state, async () => assert.fail('Invalid body reached upstream'), body);
    assert.equal(response.status, 400);
  }
  assert.equal((await state.store()).get('chatCounter'), null);
});

test('goal instructions and bounded history preserve the original request contract', enabled, async t => {
  const state = await setup(t, { model: 'fixture-model', maxTokens: 1024 });
  await state.withStore(state.env.DB, async store => {
    store.save('goals', { title: '英语考试', subjects: ['阅读', '写作'] }, 'goal-1');
    for (let i = 0; i < 10; i++) store.save('chatMessages', { role: i % 2 ? 'assistant' : 'user', content: `${i}${'x'.repeat(4500)}` });
  });
  let sent;
  const fetcher = async (url, options) => {
    sent = JSON.parse(options.body);
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer fixture-secret');
    return upstream([complete]);
  };
  await (await call(state, fetcher, { ...requestBody, goalId: 'goal-1' })).text();
  assert.equal(sent.model, 'fixture-model');
  assert.equal(sent.max_tokens, 1024);
  assert.deepEqual(sent.stream_options, { include_usage: true });
  assert.equal(sent.messages.length, 10);
  assert.match(sent.messages[0].content, /学习目标：英语考试；科目：阅读、写作/);
  assert.equal(sent.messages[1].content[0], '2');
  assert.equal(sent.messages[1].content.length, 4000);
  assert.deepEqual(sent.messages.at(-1), { role: 'user', content: '学习' });
});

test('concurrent completed streams retry only persistence and never replay paid calls', enabled, async t => {
  const state = await setup(t);
  let paidCalls = 0;
  const fetcher = async () => { paidCalls++; return upstream([complete]); };
  const responses = await Promise.all([call(state, fetcher), call(state, fetcher)]);
  const outputs = await Promise.all(responses.map(response => response.text()));
  assert.equal(outputs.every(output => events(output).at(-1).type === 'done'), true);
  assert.equal(paidCalls, 2);
  const records = await state.records();
  assert.equal(records.filter(record => record.role === 'user').length, 2);
  assert.equal(records.filter(record => record.role === 'assistant').length, 2);
});

test('output and total upstream byte limits reject oversized streams', enabled, async t => {
  for (const source of [delta('x'.repeat(30001)) + 'data: [DONE]\n\n', ':' + 'x'.repeat(2_000_000) + '\n\n']) {
    const state = await setup(t);
    const output = events(await (await call(state, async () => upstream([source]))).text());
    assert.equal(output.at(-1).type, 'error');
    assert.equal(output.some(event => event.type === 'done'), false);
    assert.deepEqual((await state.records()).map(record => record.role), ['user']);
  }
});

test('client cancellation aborts and cancels upstream without persisting a partial answer', enabled, async t => {
  const state = await setup(t);
  let signal, upstreamCancelled = false;
  const response = await call(state, async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(encoder.encode(delta('partial'))); },
      cancel() { upstreamCancelled = true; },
    }));
  });
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /partial/);
  await reader.cancel();
  await state.settle();
  assert.equal(signal.aborted, true);
  assert.equal(upstreamCancelled, true);
  assert.deepEqual((await state.records()).map(record => record.role), ['user']);
});

test('a hung upstream fetch times out after sixty seconds and keeps the daily reservation', enabled, async t => {
  const state = await setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let start, signal;
  const started = new Promise(resolve => { start = resolve; });
  const pending = call(state, async (_url, options) => {
    signal = options.signal;
    start();
    return new Promise(() => {});
  });
  await started;
  t.mock.timers.tick(59999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  const response = await pending;
  assert.equal(response.status, 502);
  assert.equal(signal.aborted, true);
  assert.equal((await state.store()).get('chatCounter').count, 1);
  assert.equal((await state.records()).length, 0);
});

test('an aborted request signal stops upstream and saves no user or assistant record', enabled, async t => {
  const state = await setup(t);
  const controller = new AbortController();
  let start;
  const started = new Promise(resolve => { start = resolve; });
  const pending = call(state, async () => { start(); return new Promise(() => {}); }, requestBody, controller.signal);
  await started;
  controller.abort();
  assert.equal((await pending).status, 502);
  assert.equal((await state.records()).length, 0);
});

test('the Shanghai day counter resets and provider-specific legacy credentials work', enabled, async t => {
  const state = await setup(t, { dailyRequestLimit: 1 });
  const { Vault } = await import('../cloudflare/vault.mjs');
  await state.withStore(state.env.DB, async store => {
    store.set('chatCounter', { day: '2000-01-01', count: 100 });
    const vault = new Vault(store, state.env.VAULT_KEY);
    vault.clear('ai.apiKey');
    vault.set('deepseek.apiKey', 'legacy-fixture');
  });
  const response = await call(state, async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer legacy-fixture');
    return upstream([complete]);
  });
  assert.equal(events(await response.text()).at(-1).type, 'done');
  const counter = (await state.store()).get('chatCounter');
  assert.equal(counter.count, 1);
  assert.notEqual(counter.day, '2000-01-01');
});

test('a timeout while final persistence resolves still emits a terminal stream error', enabled, async t => {
  const state = await setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const originalBatch = state.env.DB.batch.bind(state.env.DB);
  let writes = 0, saved, release;
  const persisted = new Promise(resolve => { saved = resolve; });
  const latency = new Promise(resolve => { release = resolve; });
  // Run the real SQL, then delay its result as a remote D1 response would.
  state.env.DB.batch = async statements => {
    const result = await originalBatch(statements);
    if (statements[0]._sql.startsWith('UPDATE cloudflare_meta') && ++writes === 3) {
      saved();
      await latency;
    }
    return result;
  };
  const output = (await call(state)).text();
  await persisted;
  t.mock.timers.tick(60000);
  release();
  assert.equal(events(await output).at(-1).type, 'error');
});

test('a revoked or expired session cannot reserve a request or contact the paid provider', enabled, async t => {
  const state = await setup(t);
  await state.withStore(state.env.DB, store => store.addSession('expired-session', Date.now() - 1));
  let paidCalls = 0;
  for (const hash of ['revoked-session', 'expired-session', null]) {
    const response = await call(state, async () => { paidCalls++; return upstream([complete]); }, requestBody, undefined, hash);
    assert.equal(response.status, 401);
  }
  assert.equal(paidCalls, 0);
  assert.equal((await state.store()).get('chatCounter'), null);
  assert.equal((await state.records()).length, 0);
});

test('reservation CAS retry rechecks a session revoked by the winning database writer', enabled, async t => {
  const state = await setup(t);
  const hash = 'concurrent-session';
  await state.withStore(state.env.DB, store => store.addSession(hash, Date.now() + 60000));
  const originalBatch = state.env.DB.batch.bind(state.env.DB);
  let revoked = false, paidCalls = 0;
  state.env.DB.batch = async statements => {
    if (!revoked && statements[0]._sql.startsWith('UPDATE cloudflare_meta')) {
      revoked = true;
      await state.withStore(state.env.DB, store => store.deleteSession(hash));
    }
    return originalBatch(statements);
  };
  const response = await call(state, async () => { paidCalls++; return upstream([complete]); }, requestBody, undefined, hash);
  assert.equal(response.status, 401);
  assert.equal(revoked, true);
  assert.equal(paidCalls, 0);
  assert.equal((await state.store()).get('chatCounter'), null);
  assert.equal((await state.records()).length, 0);
});
