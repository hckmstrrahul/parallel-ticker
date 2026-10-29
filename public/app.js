import { readDecisionResponse } from './transport.js?v=20261029-5';
import { STOCKS } from './stocks.js?v=20261029-5';
import { validProbability, choice, choiceProbability, predicateReading, scoreReading } from './readings.js?v=20261029-5';
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const percent = n => validProbability(n) ? `${Math.round(n * 100)}%` : '—';
const labels = { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral', unknown: 'Unavailable', recent: 'Recent evidence', stale: '8–30 days', historical: '31–90 days', undated: 'Date unknown', above: 'Above 50-day SMA', below: 'Below 50-day SMA', at: 'At 50-day SMA', overbought: 'Overbought', oversold: 'Oversold', elevated: 'Above average', normal: 'Typical volume', low: 'Below average', rising: 'Volume rising', falling: 'Volume falling', unchanged: 'Unchanged', oi_rising: 'OI rising', oi_falling: 'OI falling', long_buildup: 'Long buildup', short_buildup: 'Short buildup', short_covering: 'Short covering', long_unwinding: 'Long unwinding', mixed: 'Mixed' };
const specs = [
  { key: 'moving_average', name: '50-day SMA', icon: '↗', description: 'Latest close vs. 50-day SMA', absent: 'Needs a matching close and SMA' },
  { key: 'rsi', name: 'RSI (14)', icon: '⌁', description: 'Oversold < 30 · Overbought > 70', absent: 'No verified RSI value found' },
  { key: 'volume', name: 'Volume', icon: '▥', description: 'Reported volume activity', absent: 'No volume comparison found' },
  { key: 'open_interest', name: 'Open interest', icon: '⇅', description: 'Reported derivatives activity', absent: 'No reported OI change found' },
];
let current = null;
let controller = null;
let timer;
let running = false;

function badge(text, tone = 'gray') { return `<span class="tag ${tone}">${escape(text)}</span>`; }
function confidence(answer) {
  if (!validProbability(answer?.confidence)) return '';
  const value = answer.confidence;
  return badge(`${percent(value)} CONFIDENCE`, value >= .8 ? 'green' : value >= .6 ? 'orange' : 'gray');
}
function boolean(answer, name) {
  const { probability: p, value } = predicateReading(answer);
  return `<div class="boolean-item"><div class="boolean-label"><span>${name}</span><strong class="${value.toLowerCase()}">${value}</strong></div>${probabilityBar(p, 'Probability this predicate is true')}</div>`;
}
function probabilityBar(p, title = 'Option probability') {
  const level = !validProbability(p) ? 'unavailable' : p >= .8 ? 'high' : p >= .5 ? 'medium' : 'low';
  const band = { high: 'High · ≥80%', medium: 'Medium · 50–79%', low: 'Low · <50%', unavailable: 'Unavailable' }[level];
  return `<div class="prob-line probability-${level}" title="${title}: ${band}"><div class="prob-track" aria-hidden="true"><span style="width:${validProbability(p) ? p * 100 : 0}%"></span></div><span class="value" title="${title}">${percent(p)}</span></div>`;
}
function bars(score) {
  return Array.from({ length: 32 }, (_, i) => `<i${score !== null && i < Math.round(score / 4 * 32) ? ' class="filled"' : ''}></i>`).join('');
}
function renderOverview(data, loading = false) {
  const answers = data?.result.answers || {};
  const stance = choice(answers.stance);
  const known = ['bullish', 'bearish', 'neutral'].includes(stance);
  const stanceP = choiceProbability(answers.stance);
  const score = scoreReading(answers.strength);
  const title = !data ? loading ? 'Analyzing…' : 'Enter a stock' : known ? labels[stance] : answers.stance?.type === 'refusal' ? 'Unavailable' : 'No clear signal';
  const note = !data ? '' : known ? `${percent(stanceP)} probability` : answers.stance?.type === 'refusal' ? 'No answer returned.' : 'Insufficient evidence.';
  $('overview').innerHTML = `<div class="setup-panel"><div class="panel-top"><span class="panel-title">${data ? escape(data.stock) + ' <span class="muted">/ ' + data.market + '</span>' : 'SETUP'}</span>${!data ? loading ? badge('SEARCHING', 'orange') : '' : answers.stance?.type === 'choice' ? confidence(answers.stance) : badge(answers.stance?.type === 'refusal' ? 'REFUSAL' : 'UNVERIFIED', 'orange')}</div><h2 class="stance ${!data ? 'empty' : ''}">${known ? `<span class="direction">${stance === 'bullish' ? '↗' : stance === 'bearish' ? '↘' : '→'}</span> ` : ''}${escape(title)}</h2><p class="subtext ${known ? 'stance-prob' : ''}">${escape(note)}</p><div class="boolean-row">${boolean(answers.bullish, 'Bullish')}${boolean(answers.bearish, 'Bearish')}</div></div><div class="strength-panel"><div class="panel-top"><span class="panel-title">STRENGTH</span></div><div class="strength-number ${score === null ? 'empty' : ''}">${score === null ? '—' : score.toFixed(1)} <span>/ 4</span></div><div class="meter" role="img" aria-label="${score === null ? 'No score yet' : `Technical strength ${score.toFixed(1)} of 4`}">${bars(score)}</div><div class="meter-labels"><span>BEARISH</span><span>NEUTRAL</span><span>BULLISH</span></div><p class="subtext">${answers.strength?.type === 'refusal' && data ? 'Unavailable' : ''}</p></div>`;
}
function ageLabel(answer) {
  return { recent: '≤7d', stale: '8–30d', historical: '31–90d', undated: 'Undated' }[choice(answer)] || 'Unverified';
}
function distribution(answer) {
  if (answer?.type !== 'choice' || !answer.probabilities) return '';
  const rows = Object.entries(answer.probabilities).filter(([, p]) => validProbability(p)).sort((a, b) => b[1] - a[1]).map(([key, p]) => `<div class="distribution-row"><span class="distribution-label">${escape(labels[key] || key)}</span>${probabilityBar(p)}</div>`).join('');
  return rows ? `<div class="distribution" role="group" aria-label="Option probabilities">${rows}</div>` : '';
}
function renderSignals(data) {
  let available = 0;
  $('signals').innerHTML = specs.map(spec => {
    const answer = data?.result.answers[spec.key];
    const pending = data?.pendingSignals?.includes(spec.key);
    const value = choice(answer);
    const known = value && value !== 'unknown' && labels[value];
    if (known) available++;
    const activity = ['volume', 'open_interest'].includes(spec.key);
    const failed = activity && data?.activityError;
    const quality = data?.signalEvidence?.[spec.key] || data?.result.answers[activity ? 'activity_evidence' : 'evidence'];
    const context = spec.key === 'volume' ? ['rising', 'falling', 'unchanged'].includes(value) ? 'vs. prior session' : 'vs. typical volume' : spec.key === 'open_interest' ? ['oi_rising', 'oi_falling'].includes(value) ? 'OI change, not direction' : 'Futures positioning' : '';
    const probabilities = data && !pending ? distribution(answer) : '';
    const note = known ? context : !data || pending ? '' : failed ? 'Check failed. Try again.' : answer?.type === 'refusal' ? 'No answer returned.' : 'No supported reading found.';
    return `<article class="signal-card"><div class="panel-top"><h3 class="signal-name">${spec.name}</h3>${known ? `<span class="age-tag" title="Age of retrieved observations">${ageLabel(quality)}</span>` : ''}</div><p class="signal-value ${!data ? 'empty' : !known ? 'unknown' : ''}">${!data ? '—' : known ? labels[value] : pending ? 'Checking…' : 'Unavailable'}</p><div class="signal-bottom">${note ? `<p class="signal-description">${note}</p>` : ''}${probabilities}</div></article>`;
  }).join('');
  $('signal-count').textContent = data ? `${available} / 4 AVAILABLE` : '';
}
function renderSources(data) {
  $('source-count').textContent = '';
  if (!data) { $('sources').innerHTML = '<p class="evidence-empty">Sources will appear here.</p>'; return; }
  const sources = data.result.citations.filter(source => { try { return ['https:', 'http:'].includes(new URL(source.url).protocol); } catch { return false; } });
  $('source-count').textContent = `${sources.length} SOURCES`;
  $('sources').innerHTML = sources.length ? sources.map((source, i) => `<article class="source"><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer"><span class="source-number">${String(i + 1).padStart(2, '0')}</span><span class="source-title">${escape(source.title || new URL(source.url).hostname)}<small>${escape(new URL(source.url).hostname)}</small></span><span class="source-arrow" aria-hidden="true">↗</span></a>${Array.isArray(source.excerpts) && source.excerpts.length ? `<details><summary>Excerpt</summary>${data.sourceGroups ? `<p class="source-group">${escape(data.sourceGroups.filter(group => group.citations.some(c => c.url === source.url)).map(group => group.label).join(' / '))}</p>` : ''}${source.excerpts.map(excerpt => `<blockquote>${escape(excerpt)}</blockquote>`).join('')}</details>` : ''}</article>`).join('') : '<p class="evidence-empty">No sources found.</p>';
}
function render(data, loading = false) {
  $('overview').classList.toggle('loading', loading);
  $('signals').classList.toggle('loading', loading);
  $('overview').setAttribute('aria-busy', loading);
  const ages = [choice(data?.result.answers.evidence), ...Object.values(data?.signalEvidence || {}).map(choice)];
  const freshness = !data ? '' : ages.includes('historical') ? 'Includes 31–90d evidence · not live' : ages.includes('stale') ? 'Includes 8–30d evidence · not live' : ages.includes('undated') || ages.includes('unknown') ? 'Some observation dates are unverified' : '';
  $('freshness-note').textContent = freshness;
  $('freshness-note').hidden = !freshness;
  renderOverview(data, loading); renderSignals(data); renderSources(data);
}
function examples() {
  $('examples').innerHTML = [['NSE', 'INDIA'], ['US', 'US']].map(([market, label]) => `<div class="example-group"><span class="example-label">${label}</span><div class="example-buttons">${STOCKS.filter(stock => stock.market === market).map(stock => `<button class="example" type="button" data-stock="${escape(stock.name)}" data-market="${market}" aria-label="Analyze ${escape(stock.name)} on ${market}"${running ? ' disabled' : ''}>${escape(stock.name)}</button>`).join('')}</div></div>`).join('');
}
function setRunning(value) {
  running = value;
  $('analyze').disabled = value;
  $('stock').disabled = value;
  $('market').disabled = value;
  $('cancel').hidden = !value;
  $('analyze').innerHTML = value ? 'ANALYZING…' : 'ANALYZE <span aria-hidden="true">↗</span>';
  examples();
}
async function analyze() {
  const stock = $('stock').value.trim();
  if (!stock || running) return;
  const market = $('market').value;
  current = null;
  controller = new AbortController();
  $('error').hidden = true;
  setRunning(true); render(null, true);
  $('snapshot-meta').textContent = `${stock.toUpperCase()} / ${market}`;
  const start = Date.now();
  $('progress').textContent = 'Checking signals…';
  timer = setInterval(() => {
    const seconds = Math.floor((Date.now() - start) / 1000);
    $('progress').textContent = `${current?.partial ? 'Filling missing signals' : seconds < 15 ? 'Checking signals' : 'Still checking'} · ${seconds}s`;
  }, 1000);
  try {
    const response = await fetch('/api/decisions', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify({ stock, market }), signal: controller.signal });
    await readDecisionResponse(response, data => {
      current = data;
      render(current);
      const time = new Date(data.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      $('snapshot-meta').textContent = `${time}${data.cached ? '' : ` · ${((data.firstElapsedMs || data.elapsedMs) / 1000).toFixed(1)}s`}`;
      $('snapshot-meta').title = 'Time to first signals';
      $('progress').textContent = data.partial ? 'Filling missing signals…' : '';
    });
  } catch (error) {
    if (current) {
      current = { ...current, partial: false, pendingSignals: [] };
      render(current);
      $('progress').textContent = error.name === 'AbortError' ? 'Remaining checks cancelled.' : 'Initial signals shown. Remaining checks unavailable.';
    } else {
      render(null);
      $('snapshot-meta').textContent = 'NO RESULT';
      if (error.name === 'AbortError') $('progress').textContent = 'Cancelled.';
      else { $('error').textContent = error.message || 'Something went wrong. Please try again.'; $('error').hidden = false; $('progress').textContent = ''; }
    }
  } finally {
    clearInterval(timer); controller = null; setRunning(false);
  }
}
$('stock-form').addEventListener('submit', event => { event.preventDefault(); analyze(); });
$('examples').addEventListener('click', event => { const button = event.target.closest('[data-stock]'); if (button && !running) { $('stock').value = button.dataset.stock; $('market').value = button.dataset.market; analyze(); } });
$('market').addEventListener('change', examples);
$('cancel').addEventListener('click', () => controller?.abort());
$('about-button').addEventListener('click', () => { $('about').hidden = !$('about').hidden; $('about-button').setAttribute('aria-expanded', !$('about').hidden); });
const initialQuery = new URLSearchParams(window.location.search);
if (['NSE', 'US'].includes(initialQuery.get('market'))) $('market').value = initialQuery.get('market');
const initialStock = initialQuery.get('stock')?.trim();
if (initialStock && initialStock.length <= 100 && /^[\p{L}\p{N} .&()_:\-]+$/u.test(initialStock)) $('stock').value = initialStock;
examples(); render(null);
if ($('stock').value) analyze();
