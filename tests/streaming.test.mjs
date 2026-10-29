import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { readDecisionResponse } from '../public/transport.js';

test('initial signals stream before recovery finishes; final cached results remain readable', { timeout: 5000 }, async t => {
  let releaseRetry;
  const retryGate = new Promise(resolve => { releaseRetry = resolve; });
  let retryFinished = false;
  let calls = 0;
  const server = createServer({ decide: async request => {
    calls++;
    if (request.state.lookback_days === 90) {
      await retryGate;
      retryFinished = true;
      return { answers: { volume: { type: 'choice', choice: 'rising' }, evidence: { type: 'choice', choice: 'historical' } }, citations: [{ url: 'https://example.com/volume' }] };
    }
    return request.questions.stance
      ? { answers: { stance: { type: 'choice', choice: 'bullish' } }, citations: [] }
      : { answers: { volume: { type: 'choice', choice: 'unknown' } }, citations: [] };
  } });
  t.after(() => { releaseRetry(); server.closeAllConnections(); server.close(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/decisions`;
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify({ stock: 'STREAMTEST', market: 'US' }) };
  const response = await fetch(url, options);
  assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
  const frames = [];
  const final = await readDecisionResponse(response, data => {
    frames.push(data);
    if (data.partial) {
      assert.equal(retryFinished, false);
      assert.equal(data.result.answers.stance.choice, 'bullish');
      assert.deepEqual(data.pendingSignals, ['volume']);
      releaseRetry();
    }
  });
  assert.equal(frames.length, 2);
  assert.equal(final.partial, false);
  assert.equal(final.result.answers.volume.choice, 'rising');
  assert.deepEqual(final.pendingSignals, []);
  assert.ok(final.firstElapsedMs <= final.elapsedMs);
  const cached = await readDecisionResponse(await fetch(url, options), () => {});
  assert.equal(cached.cached, true);
  assert.equal(cached.result.answers.volume.choice, 'rising');
  assert.equal(calls, 3);
});

test('stream interruption preserves delivered snapshots and rejects an incomplete final result', async () => {
  const initial = { result: { answers: {} }, partial: true };
  const response = new Response(JSON.stringify({ type: 'snapshot', data: initial }) + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
  const frames = [];
  await assert.rejects(readDecisionResponse(response, data => frames.push(data)), /Connection interrupted/);
  assert.deepEqual(frames, [initial]);
});
