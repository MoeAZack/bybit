#!/usr/bin/env node
/**
 * apply-live-demo.mjs — push the safe demo profile to the DEPLOYED service.
 *
 * The Cloud Run instance keeps db.json on a mounted GCS bucket, so settings survive
 * deploys. A fresh build therefore does NOT reset an unsafe live configuration — this
 * script does that explicitly.
 *
 * Does NOT touch API credentials (the server preserves them on partial updates).
 *
 * Usage:
 *   node scripts/apply-live-demo.mjs            # show current live settings only
 *   node scripts/apply-live-demo.mjs --apply    # apply the safe profile + clear seed state
 *
 * Env: SERVICE_URL, API_TOKEN (or GCP_PROJECT to read the token from Secret Manager).
 */
import { execSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const URL_BASE = process.env.SERVICE_URL || 'https://moeby-w47weolqnq-ew.a.run.app';
const PROJECT = process.env.GCP_PROJECT || 'bybit-502622';

function token() {
  if (process.env.API_TOKEN) return process.env.API_TOKEN;
  return execSync(
    `gcloud secrets versions access latest --secret=API_AUTH_TOKEN --project=${PROJECT}`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).trim();
}

// Safe first-run profile. autoMode is driven by mt5AutoMode (the server's resolveAutoMode
// falls back to it), and 'approve' means signals queue for one-click firing rather than
// firing themselves — important, because the signal loop is now venue-agnostic.
const PROFILE = {
  activeBroker: 'bybit',
  bybitEnvironment: 'demo',
  mt5AutoMode: 'approve',
  isCircuitBreakerActive: true,
  maxDrawdownPercent: 5,
  defaultOrderSize: 0.05,
  signalCandleMinutes: 5,
  isHybridStopsActive: true,
  isKillSwitchActive: false,
};

const SHOW = [
  'activeBroker', 'bybitEnvironment', 'isPaperTrading', 'mt5AutoMode',
  'isCircuitBreakerActive', 'maxDrawdownPercent', 'isHybridStopsActive',
  'isDynamicSlActive', 'atrMultiplier', 'defaultOrderSize', 'signalCandleMinutes',
  'isKillSwitchActive',
];

const T = token();
const headers = { 'x-api-token': T, 'Content-Type': 'application/json' };

async function getSettings() {
  const r = await fetch(`${URL_BASE}/api/settings`, { headers });
  if (!r.ok) throw new Error(`GET /api/settings -> ${r.status}`);
  return r.json();
}

function print(label, s) {
  console.log(`\n=== ${label} ===`);
  for (const k of SHOW) console.log(`  ${k.padEnd(24)} ${JSON.stringify(s[k])}`);
  console.log(`  ${'bybitKeysPresent'.padEnd(24)} ${Boolean(s.bybitApiKey && s.bybitApiSecret)}`);
}

const before = await getSettings();
print('LIVE SETTINGS (before)', before);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write the profile above.');
  process.exit(0);
}

const res = await fetch(`${URL_BASE}/api/settings`, {
  method: 'POST', headers, body: JSON.stringify(PROFILE),
});
console.log(`\nPOST /api/settings -> ${res.status}`);

for (const path of ['/api/paper/reset', '/api/logs/clear']) {
  const r = await fetch(`${URL_BASE}${path}`, { method: 'POST', headers });
  console.log(`POST ${path} -> ${r.status}`);
}

const after = await getSettings();
print('LIVE SETTINGS (after)', after);

const bad = Object.entries(PROFILE).filter(([k, v]) => JSON.stringify(after[k]) !== JSON.stringify(v));
if (bad.length) {
  console.log('\nDID NOT TAKE:', bad.map(([k, v]) => `${k} (want ${JSON.stringify(v)}, got ${JSON.stringify(after[k])})`).join(', '));
  process.exit(1);
}
console.log('\nAll profile values applied.');
console.log(after.bybitApiKey && after.bybitApiSecret
  ? 'Bybit credentials present — signals will queue for your approval.'
  : 'No Bybit credentials yet: the dead-man switch blocks all trading until you add demo keys in Settings.');
