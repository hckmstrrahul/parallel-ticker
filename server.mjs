import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { analyzeStock, callDecisions, DecisionError } from './lib/decisions.mjs';

const publicDir = new URL('./public/', import.meta.url);
const TTL = 5 * 60_000;
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/readings.js': ['readings.js', 'text/javascript; charset=utf-8'], '/stocks.js': ['stocks.js', 'text/javascript; charset=utf-8'], '/transport.js': ['transport.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };

export function createHandler({ decide = callDecisions, deploymentHosts = [] } = {}) {
  const cache = new Map();
  let active = 0;
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const host = req.headers.host || '';
    const hosted = deploymentHosts.length > 0;
    const allowedHost = hosted ? deploymentHosts.includes(host) : /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    if (!allowedHost) return json(res, 403, { error: 'This host is not allowed.' });
    const origin = `${hosted ? 'https' : 'http'}://${host}`;
    const url = new URL(req.url, origin);
    if (req.method === 'POST' && url.pathname === '/api/decisions') {
      if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: 'Cross-origin requests are not allowed.' });
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Send a JSON request.' });
      if (Number(req.headers['content-length']) > 4096) return json(res, 413, { error: 'The request is too large.' });
      let body = '';
      try {
        if (req.body !== undefined) {
          body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        } else {
          for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body) > 4096) return json(res, 413, { error: 'The request is too large.' });
          }
        }
        if (Buffer.byteLength(body) > 4096) return json(res, 413, { error: 'The request is too large.' });
        let input;
        try { input = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON request.' }); }
        const stock = typeof input?.stock === 'string' ? input.stock.trim().replace(/\s+/g, ' ') : '';
        if (!stock || stock.length > 100 || !/^[\p{L}\p{N} .&()_:\-]+$/u.test(stock)) return json(res, 400, { error: 'Enter a stock name or ticker, up to 100 characters.' });
        if (!['NSE', 'US'].includes(input.market)) return json(res, 400, { error: 'Choose NSE India or US markets.' });
        const key = `${input.market}:${stock.toLowerCase()}`;
        const saved = cache.get(key);
        if (saved && Date.now() - saved.timestamp < TTL) return json(res, 200, { ...saved.data, cached: true });
        if (active >= 2) return json(res, 429, { error: 'Two decisions are already running. Please wait for one to finish.' });
        const controller = new AbortController();
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        active++;
        try {
          const start = performance.now();
          const streaming = req.headers.accept?.includes('application/x-ndjson');
          let firstElapsedMs;
          const envelope = (analysis, partial = false) => ({ stock, market: input.market, checkedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start), firstElapsedMs: firstElapsedMs || Math.round(performance.now() - start), cached: false, partial, ...analysis });
          const send = (type, data) => {
            if (res.destroyed) return;
            if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
            res.write(JSON.stringify({ type, data }) + '\n');
          };
          const analysis = await analyzeStock(stock, input.market, {
            decide, signal: controller.signal,
            onProgress: partial => {
              firstElapsedMs ||= Math.round(performance.now() - start);
              if (streaming) send('snapshot', envelope(partial, true));
            },
          });
          const data = envelope(analysis);
          if (cache.size >= 100) cache.delete(cache.keys().next().value);
          cache.set(key, { timestamp: Date.now(), data });
          if (!res.destroyed) {
            if (streaming) { send('result', data); res.end(); }
            else json(res, 200, data);
          }
        } finally { active--; }
      } catch (error) {
        if (res.destroyed) return;
        const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
        const message = timedOut ? 'This decision took too long. Please try again.' : error instanceof DecisionError ? error.message : 'Could not connect to Parallel. Check your connection and try again.';
        if (res.headersSent) res.end(JSON.stringify({ type: 'error', error: message }) + '\n');
        else json(res, timedOut ? 504 : error instanceof DecisionError ? error.status : 502, { error: message });
      }
      return;
    }
    if (req.method === 'GET' && files[url.pathname]) {
      const [file, type] = files[url.pathname];
      try { const data = await readFile(new URL(file, publicDir)); res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(data); }
      catch { json(res, 500, { error: 'The app could not load.' }); }
      return;
    }
    json(res, 404, { error: 'Not found.' });
  };
}

export function createServer(options) {
  return http.createServer(createHandler(options));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  createServer().listen(port, '127.0.0.1', () => console.log(`parallel-ticker · http://localhost:${port}\nFree Parallel Decisions · no API key required`));
}
