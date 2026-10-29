import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStock, buildQuestions, buildRecoveryRequest, callDecisions, parseRpc, unpackDecision } from '../lib/decisions.mjs';
import { choice, predicateReading, scoreReading } from '../public/readings.js';

test('unknown signals get one wider retry, retaining separate age and raw provenance', async () => {
  const unknown = { type: 'choice', choice: 'unknown', probabilities: { unknown: .9 } };
  const calls = [];
  const output = await analyzeStock('RELIANCE', 'NSE', { decide: async request => {
    calls.push(request);
    if (request.state.lookback_days === 90) return { answers: { volume: { type: 'choice', choice: 'rising' }, evidence: { type: 'choice', choice: 'historical' } }, citations: [{ url: 'https://example.com/volume-older' }] };
    if (request.questions.stance) return { answers: { stance: { type: 'choice', choice: 'bullish' }, evidence: { type: 'choice', choice: 'recent' } }, citations: [] };
    return { answers: { volume: unknown, open_interest: { type: 'choice', choice: 'oi_rising' }, evidence: { type: 'choice', choice: 'stale' } }, citations: [] };
  } });
  assert.equal(calls.length, 3);
  assert.deepEqual(Object.keys(calls[2].questions), ['volume', 'evidence']);
  assert.equal(output.result.answers.volume.choice, 'rising');
  assert.equal(output.signalEvidence.volume.choice, 'historical');
  assert.equal(output.signalEvidence.stance.choice, 'recent');
  assert.equal(output.result.answers.open_interest.choice, 'oi_rising');
  assert.equal(output.raw.activity.answers.volume.choice, 'unknown');
  assert.equal(output.raw.retry_volume.answers.volume.choice, 'rising');
  assert.deepEqual(output.recovered, ['volume']);
});

test('a wider check cannot manufacture a signal from an uncited answer or retry a refusal', async () => {
  const calls = [];
  const output = await analyzeStock('TCS', 'NSE', { decide: async request => {
    calls.push(request);
    if (request.state.lookback_days === 90) return { answers: { volume: { type: 'choice', choice: 'normal' } }, citations: [] };
    if (request.questions.stance) return { answers: { rsi: { type: 'refusal' } }, citations: [] };
    return { answers: { volume: { type: 'choice', choice: 'unknown' } }, citations: [] };
  } });
  assert.equal(calls.length, 3);
  assert.equal(output.result.answers.rsi.type, 'refusal');
  assert.equal(output.result.answers.volume.choice, 'unknown');
  assert.deepEqual(output.recovered, []);
});

test('recovery failure retains unknown and does not fail the entire snapshot', async () => {
  const output = await analyzeStock('TCS', 'NSE', { decide: async request => {
    if (request.state.lookback_days === 90) throw new Error('rate limit');
    return { answers: request.questions.stance ? { stance: { type: 'choice', choice: 'unknown' } } : {}, citations: [] };
  } });
  assert.equal(output.result.answers.stance.choice, 'unknown');
  assert.ok(output.raw.retry_stance.error);
});

test('wider lookback changes search dates, not the daily indicator definition', () => {
  const now = new Date('2026-10-29T00:00:00Z');
  const initial = buildQuestions('TCS', 'NSE', now);
  const retry = buildRecoveryRequest('TCS', 'NSE', 'rsi', now);
  assert.equal(initial.state.lookback_days, 30);
  assert.equal(initial.state.evidence_after, '2026-09-29');
  assert.equal(retry.state.lookback_days, 90);
  assert.equal(retry.state.evidence_after, '2026-07-31');
  assert.match(retry.questions.rsi.instructions, /daily 14-period RSI/);
});

test('focused activity evidence stays separate from the technical evidence and original responses', async () => {
  const technical = { answers: { stance: { type: 'choice', choice: 'bearish' }, evidence: { type: 'choice', choice: 'stale' } }, citations: [{ url: 'https://example.com/technical' }] };
  const activity = { answers: { volume: { type: 'choice', choice: 'falling' }, open_interest: { type: 'choice', choice: 'oi_rising' }, evidence: { type: 'choice', choice: 'recent' } }, citations: [{ url: 'https://example.com/oi' }] };
  const calls = [];
  const output = await analyzeStock('HDFC Bank', 'NSE', { decide: async request => { calls.push(request); return request.questions.stance ? technical : activity; } });
  assert.equal(calls.length, 2);
  assert.equal(Object.keys(calls[0].questions).length, 7);
  assert.equal(Object.keys(calls[1].questions).length, 3);
  assert.equal(output.result.answers.evidence.choice, 'stale');
  assert.equal(output.result.answers.activity_evidence.choice, 'recent');
  assert.equal(output.result.answers.open_interest.choice, 'oi_rising');
  assert.deepEqual(output.raw, { technical, activity });
  assert.equal(output.sourceGroups[1].citations[0].url, 'https://example.com/oi');
});

test('activity request failure preserves technical answers without inventing a refusal or false value', async () => {
  const output = await analyzeStock('TCS', 'NSE', { decide: async request => {
    if (request.questions.volume) throw new Error('rate limited');
    return { answers: { bullish: { type: 'noul', noul: .8 } }, citations: [] };
  } });
  assert.equal(output.result.answers.bullish.noul, .8);
  assert.equal(output.result.answers.volume, undefined);
  assert.equal(output.result.answers.open_interest, undefined);
  assert.ok(output.activityError);
});

test('each answer remains independent of a separate stale-evidence classification', () => {
  const answers = { evidence: { type: 'choice', choice: 'stale' }, bullish: { type: 'noul', noul: .65 }, strength: { type: 'score', score: 1.93 }, rsi: { type: 'choice', choice: 'neutral' } };
  assert.deepEqual(predicateReading(answers.bullish), { probability: .65, value: 'TRUE' });
  assert.equal(scoreReading(answers.strength), 1.93);
  assert.equal(choice(answers.rsi), 'neutral');
  assert.deepEqual(predicateReading({ type: 'refusal' }), { probability: null, value: 'UNKNOWN' });
  assert.equal(scoreReading({ type: 'refusal' }), null);
  assert.equal(scoreReading({ type: 'score', score: 0 }), 0);
  assert.deepEqual(predicateReading({ type: 'noul', noul: 0 }), { probability: 0, value: 'FALSE' });
});

test('TCS is qualified with full company and exchange in every retrieval question', () => {
  const request = buildQuestions('TCS', 'NSE');
  assert.equal(request.state.stock, 'Tata Consultancy Services Limited (NSE: TCS)');
  for (const q of Object.values(request.questions)) assert.ok(q.instructions.startsWith('For Tata Consultancy Services Limited (NSE: TCS):'));
});

test('SSE replies ignore notifications and support CRLF and multiline data', () => {
  const text = 'event: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":2,"result":{"ok":true}}\r\n\r\n';
  assert.deepEqual(parseRpc(text, 2).result, { ok: true });
});
test('refusals and missing confidence are preserved without invented values', () => {
  const data = { answers: { bullish: { type: 'refusal' }, stance: { type: 'choice', choice: 'unknown', probabilities: { unknown: .9, bullish: .1 } } }, citations: [] };
  assert.deepEqual(unpackDecision({ content: [{ type: 'text', text: JSON.stringify(data) }] }), data);
  assert.equal(unpackDecision({ structuredContent: data }).answers.stance.confidence, undefined);
});
test('tool-level free quota errors surface as 429', () => {
  assert.throws(() => unpackDecision({ isError: true, content: [{ type: 'text', text: 'Rate limit exceeded' }] }), e => e.status === 429);
});
test('MCP lifecycle propagates sessions and calls only free web_decisions', async () => {
  const calls = [];
  const result = { answers: { bullish: { type: 'noul', noul: .2 } }, citations: [] };
  const fakeFetch = async (url, options) => {
    const request = JSON.parse(options.body); calls.push({ url, options, request });
    if (request.method === 'initialize') return new Response(JSON.stringify({ id: 1, result: { protocolVersion: '2025-03-26' } }), { headers: { 'mcp-session-id': 'test-session' } });
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return new Response(`event: message\ndata: ${JSON.stringify({ id: 2, result: { structuredContent: result } })}\n\n`);
  };
  const args = buildQuestions('RELIANCE', 'NSE', new Date('2026-10-28T10:00:00Z'));
  assert.deepEqual(await callDecisions(args, { fetchImpl: fakeFetch }), result);
  assert.deepEqual(calls.map(c => c.request.method), ['initialize', 'notifications/initialized', 'tools/call']);
  assert.equal(calls[2].request.params.name, 'web_decisions');
  assert.equal(calls[2].options.headers['Mcp-Session-Id'], 'test-session');
  assert.ok(calls.every(c => !c.options.headers.Authorization && !c.options.headers['x-api-key']));
  assert.equal(args.state.as_of, '2026-10-28T10:00:00.000Z');
});
