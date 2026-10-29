import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { createHandler } from '../server.mjs';
import { readDecisionResponse } from '../public/transport.js';

async function hostedServer(t, { parsedBody = false } = {}) {
  let calls = 0;
  const handler = createHandler({
    deploymentHosts: ['parallel-ticker.vercel.app'],
    decide: async () => {
      calls++;
      return { answers: { stance: { type: 'choice', choice: 'neutral' } }, citations: [] };
    },
  });
  const server = http.createServer(async (req, res) => {
    if (parsedBody) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      req.body = JSON.parse(raw);
    }
    await handler(req, res);
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    calls: () => calls,
    request: ({ headers = {}, body = JSON.stringify({ stock: 'AAPL', market: 'US' }) } = {}) => new Promise((resolve, reject) => {
      const request = http.request(`http://127.0.0.1:${server.address().port}/api/decisions`, {
        method: 'POST',
        headers: { Host: 'parallel-ticker.vercel.app', Origin: 'https://parallel-ticker.vercel.app', 'Content-Type': 'application/json', ...headers },
      }, response => resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers: response.headers })));
      request.on('error', reject);
      request.end(body);
    }),
  };
}

test('hosted handler accepts HTTPS same-origin JSON and streams results with a parsed Vercel body', async t => {
  const app = await hostedServer(t, { parsedBody: true });
  const response = await app.request({ headers: { Accept: 'application/x-ndjson' } });
  assert.equal(response.status, 200);
  const frames = [];
  const result = await readDecisionResponse(response, data => frames.push(data));
  assert.equal(result.stock, 'AAPL');
  assert.equal(result.result.answers.stance.choice, 'neutral');
  assert.equal(frames.at(-1).partial, false);
  assert.equal(app.calls(), 2);
});

test('hosted handler rejects untrusted hosts, origins, and oversized or malformed input before calling Parallel', async t => {
  const app = await hostedServer(t);
  for (const headers of [
    { Host: 'attacker.example' },
    { Origin: 'https://attacker.example' },
    { Origin: 'http://parallel-ticker.vercel.app' },
  ]) assert.equal((await app.request({ headers })).status, 403);
  assert.equal((await app.request({ headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await app.request({ body: 'not json' })).status, 400);
  assert.equal((await app.request({ body: JSON.stringify({ stock: 'A'.repeat(4200), market: 'US' }) })).status, 413);
  assert.equal((await app.request({ body: JSON.stringify({ stock: 'AAPL', market: 'INVALID' }) })).status, 400);
  assert.equal(app.calls(), 0);
});
