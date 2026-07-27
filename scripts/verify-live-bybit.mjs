#!/usr/bin/env node
/**
 * verify-live-bybit.mjs — end-to-end check of the deployed terminal after Bybit
 * credentials have been entered in the UI.
 *
 * Never prints key material: only booleans, balances, and status text.
 *
 * Usage: node scripts/verify-live-bybit.mjs
 * Env:   SERVICE_URL, API_TOKEN (or GCP_PROJECT to read it from Secret Manager)
 */
import { execSync } from 'node:child_process';

const URL_BASE = process.env.SERVICE_URL || 'https://moeby-w47weolqnq-ew.a.run.app';
const PROJECT = process.env.GCP_PROJECT || 'bybit-502622';

const T = process.env.API_TOKEN || execSync(
  `gcloud secrets versions access latest --secret=API_AUTH_TOKEN --project=${PROJECT}`,
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
).trim();
const headers = { 'x-api-token': T, 'Content-Type': 'application/json' };

let pass = 0, fail = 0, warn = 0;
const ok   = (m) => { console.log(`  PASS  ${m}`); pass++; };
const bad  = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const note = (m) => { console.log(`  WARN  ${m}`); warn++; };

async function get(path) {
  const r = await fetch(`${URL_BASE}${path}`, { headers });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: r.status, json, text };
}

console.log(`\nTarget: ${URL_BASE}`);

// ── 1. Credentials present ────────────────────────────────────────────────────
console.log('\n--- CREDENTIALS ---');
const s = (await get('/api/settings')).json || {};
const hasKeys = Boolean(s.bybitApiKey && s.bybitApiSecret);
hasKeys ? ok('Bybit key + secret are configured') : bad('Bybit credentials still missing');

// ── 2. Config sanity ──────────────────────────────────────────────────────────
console.log('\n--- CONFIG ---');
const expect = {
  activeBroker: 'bybit',
  bybitEnvironment: 'demo',
  isCircuitBreakerActive: true,
  isHybridStopsActive: true,
  isDynamicSlActive: true,
  isKillSwitchActive: false,
};
for (const [k, v] of Object.entries(expect)) {
  s[k] === v ? ok(`${k} = ${JSON.stringify(v)}`) : bad(`${k} = ${JSON.stringify(s[k])}, expected ${JSON.stringify(v)}`);
}
const mode = s.autoMode || s.mt5AutoMode;
mode === 'approve'
  ? ok(`automation = "approve" (signals queue for manual firing)`)
  : note(`automation = ${JSON.stringify(mode)} — "approve" is the safe setting for a first run`);
console.log(`        order size ${s.defaultOrderSize} | ATR x${s.atrMultiplier} | ${s.signalCandleMinutes}m candle | breaker ${s.maxDrawdownPercent}%`);

// ── 3. Live exchange reachability (proves HMAC signing works) ─────────────────
console.log('\n--- BYBIT CONNECTION (signed request) ---');
const pos = await get('/api/positions');
const p = pos.json || {};
if (pos.status !== 200) {
  bad(`/api/positions returned ${pos.status}`);
} else if (p.liveAccountError) {
  bad(`exchange rejected the request: ${p.liveAccountError}`);
} else if (typeof p.liveBalance === 'number' || typeof p.balance === 'number' || p.paperAccount) {
  const bal = p.liveBalance ?? p.balance ?? p.paperAccount?.balance;
  if (typeof p.liveBalance === 'number') {
    ok(`wallet balance read from Bybit: ${p.liveBalance} ${p.currency || 'USDT'} — signing works`);
  } else {
    note(`no live balance field in response; simulator balance ${bal}. Raw keys: ${Object.keys(p).join(', ')}`);
  }
} else {
  note(`unexpected /api/positions shape. Keys: ${Object.keys(p).join(', ')}`);
}
const open = (p.positions || p.livePositions || p.paperAccount?.positions || []).length;
console.log(`        open positions: ${open}`);

// ── 4. Trading readiness ──────────────────────────────────────────────────────
console.log('\n--- TRADING READINESS ---');
const deadman = s.isKillSwitchActive
  || (s.activeBroker === 'bybit' && !s.isPaperTrading && !hasKeys);
deadman
  ? bad('dead-man switch still tripped — entries blocked')
  : ok('dead-man switch released — engine may queue signals');

const sig = await get('/api/signals');
if (sig.status === 200) {
  const list = sig.json?.signals || sig.json || [];
  ok(`signals endpoint reachable (${Array.isArray(list) ? list.length : 0} pending)`);
} else {
  note(`/api/signals returned ${sig.status}`);
}

// ── 5. Data integrity (no fabricated values) ──────────────────────────────────
console.log('\n--- DATA INTEGRITY ---');
const q = (await get('/api/quant/metrics')).json || {};
const synthetic = (typeof q.dxy === 'number' && Math.abs(q.dxy - 104.5) < 0.45)
               && (typeof q.yield10y === 'number' && Math.abs(q.yield10y - 4.25) < 0.13);
synthetic ? bad('macro values sit in the old Math.sin() band — synthetic data may be back')
          : ok(`macro is real or null (dxy=${q.dxy ?? 'null'}, 10y=${q.yield10y ?? 'null'})`);
q.liquidationsUsd === null || q.liquidationsUsd === undefined
  ? ok('liquidationsUsd reported as unknown, not invented')
  : note(`liquidationsUsd = ${q.liquidationsUsd}`);

console.log(`\n=== ${pass} passed, ${fail} failed, ${warn} warnings ===`);
process.exit(fail === 0 ? 0 : 1);
