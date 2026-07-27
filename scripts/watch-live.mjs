#!/usr/bin/env node
/**
 * watch-live.mjs — stream new webhook/execution log entries from the deployed terminal.
 *
 * One line per new event, so you can watch the bot trade in real time. Never prints
 * credentials.
 *
 * Usage: node scripts/watch-live.mjs [--interval 20]
 * Env:   SERVICE_URL, API_TOKEN (or GCP_PROJECT to read it from Secret Manager)
 */
import { execSync } from 'node:child_process';

const URL_BASE = process.env.SERVICE_URL || 'https://moeby-w47weolqnq-ew.a.run.app';
const PROJECT = process.env.GCP_PROJECT || 'bybit-502622';
const idx = process.argv.indexOf('--interval');
const INTERVAL = (idx > -1 ? Number(process.argv[idx + 1]) : 20) * 1000;

const T = process.env.API_TOKEN || execSync(
  `gcloud secrets versions access latest --secret=API_AUTH_TOKEN --project=${PROJECT}`,
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
).trim();
const headers = { 'x-api-token': T };

const seen = new Set();
let primed = false;

const short = (s, n = 150) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);

async function poll() {
  let logs = [];
  let signals = [];
  try {
    const [lr, sr] = await Promise.all([
      fetch(`${URL_BASE}/api/logs`, { headers }),
      fetch(`${URL_BASE}/api/signals`, { headers }),
    ]);
    if (lr.ok) { const j = await lr.json(); logs = j.logs || j || []; }
    if (sr.ok) { const j = await sr.json(); signals = j.signals || j || []; }
  } catch {
    return; // transient network failure; keep watching
  }

  const events = [];
  for (const l of Array.isArray(logs) ? logs : []) {
    if (!l?.id || seen.has(l.id)) continue;
    seen.add(l.id);
    if (primed) {
      const tag = l.status === 'success' ? 'EXEC' : l.status === 'execution_failed' ? 'BLOCKED' : String(l.status || '?').toUpperCase();
      events.push(`[${tag}] ${String(l.action || '').toUpperCase()} ${l.quantity ?? ''} ${l.symbol ?? ''} @ ${l.price ?? '-'} | ${short(l.message)}`);
    }
  }
  for (const s of Array.isArray(signals) ? signals : []) {
    const key = `sig:${s.id}`;
    if (!s?.id || seen.has(key)) continue;
    seen.add(key);
    if (primed) events.push(`[SIGNAL:${s.status}] ${String(s.side || '').toUpperCase()} ${s.quantity} ${s.symbol} @ ${s.price} | ${short(s.reason, 90)}`);
  }

  if (!primed) {
    primed = true;
    console.log(`watching ${URL_BASE} (${seen.size} existing entries ignored) — new events follow`);
    return;
  }
  for (const e of events.reverse()) console.log(e);
}

await poll();
setInterval(poll, INTERVAL);
