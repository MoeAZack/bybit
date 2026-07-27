#!/usr/bin/env node
/**
 * set-shadow.mjs — put strategy modules into SHADOW mode on the deployed service.
 *
 * Shadow = the engine still evaluates and records every signal (side, size, SL/TP) but
 * never sends an order. Used to build a real out-of-sample record on live data at zero risk.
 *
 * Usage:
 *   node scripts/set-shadow.mjs                 # show current state
 *   node scripts/set-shadow.mjs --on trend      # shadow the trend module
 *   node scripts/set-shadow.mjs --off trend     # take it back out of shadow
 *
 * Verifies the deployed build actually supports the flag before claiming success — an older
 * revision silently ignores it, which would look identical to it working.
 */
import { execSync } from 'node:child_process';

const URL_BASE = process.env.SERVICE_URL || 'https://moeby-w47weolqnq-ew.a.run.app';
const PROJECT = process.env.GCP_PROJECT || 'bybit-502622';

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const on = argOf('on');
const off = argOf('off');

const token = process.env.API_TOKEN || execSync(
  `gcloud secrets versions access latest --secret=API_AUTH_TOKEN --project=${PROJECT}`,
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
).trim();
const headers = { 'x-api-token': token, 'Content-Type': 'application/json' };

const getSettings = async () => {
  const r = await fetch(`${URL_BASE}/api/settings`, { headers });
  if (!r.ok) throw new Error(`GET /api/settings -> ${r.status}`);
  return r.json();
};

const before = await getSettings();
const current = before.shadowModules || [];
console.log(`\nservice   : ${URL_BASE}`);
console.log(`automation: ${before.autoMode || before.mt5AutoMode}`);
console.log(`shadow now: ${current.length ? current.join(', ') : '(none)'}`);

if (!on && !off) {
  console.log('\nDry run. Use --on <module> or --off <module>.');
  process.exit(0);
}

const next = new Set(current);
if (on) next.add(on);
if (off) next.delete(off);
const want = [...next];

const res = await fetch(`${URL_BASE}/api/settings`, {
  method: 'POST', headers, body: JSON.stringify({ shadowModules: want }),
});
console.log(`\nPOST /api/settings -> ${res.status}`);

const after = await getSettings();
const got = after.shadowModules || [];
const applied = JSON.stringify([...got].sort()) === JSON.stringify([...want].sort());

console.log(`shadow set: ${got.length ? got.join(', ') : '(none)'}`);
if (!applied) {
  console.log('\nFAILED — the deployed build did not persist shadowModules.');
  console.log('That means it predates the gate fix; the module is NOT shadowed and would still trade.');
  process.exit(1);
}

console.log('\nOK. Signals from the shadowed module are recorded and NOT executed.');

// Shadow only records while the engine is actually evaluating. runSignalEngine returns on
// `autoMode === 'off'` BEFORE reaching the shadow gate, so with automation off the flag is
// set but completely inert — no signals, no logs, nothing to review later.
const mode = after.autoMode || after.mt5AutoMode || 'off';
if (mode === 'off') {
  console.log('\nWARNING: automation is OFF, so the engine never evaluates and shadow will');
  console.log('record NOTHING. Set it to "auto" (shadow still blocks execution) or "approve".');
  process.exit(2);
}
console.log(`Automation is "${mode}" — the engine evaluates each candle and shadow intercepts.`);
console.log('Watch with: node scripts/watch-live.mjs   (look for [SHADOW:...] lines)');
