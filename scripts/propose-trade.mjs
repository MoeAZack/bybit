#!/usr/bin/env node
/**
 * propose-trade.mjs — PATH B: the bot as a disciplined execution layer.
 *
 * You decide the direction and the levels (from your own analysis / the TradingView MTF
 * briefing). This does the part humans reliably get wrong under pressure:
 *   - sizes the position so the stop costs exactly your risk budget, no more
 *   - reads your REAL account equity from the exchange rather than assuming
 *   - computes R-multiples for every target so you see the payoff before committing
 *   - refuses the trade if it breaches position caps, or if the reward is not worth it
 *   - checks the venue is healthy and no position is already open
 *
 * It PROPOSES ONLY. Nothing is sent to the exchange.
 *
 * Usage:
 *   node scripts/propose-trade.mjs --side long --entry 4091 --stop 4068 \
 *        --targets 4104,4117,4166 --risk 1
 *
 * Omit --entry to use the live market price. Omit levels entirely to read them from
 * scripts/levels.json (the same file the `update` briefing reports against).
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const URL_BASE = process.env.SERVICE_URL || 'https://moeby-w47weolqnq-ew.a.run.app';
const PROJECT = process.env.GCP_PROJECT || 'bybit-502622';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const token = process.env.API_TOKEN || execSync(
  `gcloud secrets versions access latest --secret=API_AUTH_TOKEN --project=${PROJECT}`,
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
).trim();
const headers = { 'x-api-token': token, 'Content-Type': 'application/json' };

const get = async (p) => {
  const r = await fetch(`${URL_BASE}${p}`, { headers });
  if (!r.ok) throw new Error(`GET ${p} -> ${r.status}`);
  return r.json();
};

// ── Inputs ───────────────────────────────────────────────────────────────────
let levels = {};
const levelsPath = path.join(__dir, 'levels.json');
if (existsSync(levelsPath)) { try { levels = JSON.parse(readFileSync(levelsPath, 'utf8')); } catch {} }

const side = (arg('side', levels.bias === 'SHORT' ? 'short' : 'long')).toLowerCase();
const riskPct = Number(arg('risk', 1));
const stop = Number(arg('stop', levels.stop));
const targets = (arg('targets') ? arg('targets').split(',') : Object.values(levels.targets || {})).map(Number).filter(Number.isFinite);

const [settings, positions, priceInfo] = await Promise.all([get('/api/settings'), get('/api/positions'), get('/api/price')]);
const entry = Number(arg('entry', priceInfo?.price));

console.log(`\n${'='.repeat(70)}`);
console.log(`TRADE PROPOSAL — ${side.toUpperCase()} ${settings.defaultSymbol}   (proposal only, nothing sent)`);
console.log('='.repeat(70));

const fail = [];
if (!Number.isFinite(entry) || entry <= 0) fail.push('no entry price (market price unavailable and --entry not given)');
if (!Number.isFinite(stop) || stop <= 0) fail.push('no stop price (--stop, or set one in scripts/levels.json)');
if (fail.length) { fail.forEach(f => console.log(`  BLOCKED: ${f}`)); process.exit(1); }

const isLong = side === 'long';
if (isLong && stop >= entry) { console.log(`  BLOCKED: long stop ${stop} must be BELOW entry ${entry}`); process.exit(1); }
if (!isLong && stop <= entry) { console.log(`  BLOCKED: short stop ${stop} must be ABOVE entry ${entry}`); process.exit(1); }

// ── Account ──────────────────────────────────────────────────────────────────
// --equity lets you plan against the account you will ACTUALLY fund, rather than the
// demo balance. Bybit hands out 50,000 USDT on demo; sizing 1% of that is meaningless
// if you are going live with a few hundred.
const equityOverride = Number(arg('equity', NaN));
const liveEquity = positions?.liveAccount?.balance ?? positions?.paperAccount?.balance ?? 0;
const equity = Number.isFinite(equityOverride) ? equityOverride : liveEquity;
const equitySrc = Number.isFinite(equityOverride)
  ? `planning override (live balance is ${liveEquity})`
  : positions?.liveAccount ? `Bybit ${settings.bybitEnvironment}` : 'paper simulator';
const openCount = (positions?.liveAccount?.positions || positions?.paperAccount?.positions || []).length;

console.log(`\nACCOUNT`);
console.log(`  equity            ${equity} USDT   (${equitySrc})`);
console.log(`  open positions    ${openCount}`);
console.log(`  venue             ${settings.activeBroker} / ${settings.bybitEnvironment}`);

// ── Sizing ───────────────────────────────────────────────────────────────────
const stopDist = Math.abs(entry - stop);
const riskDollars = equity * (riskPct / 100);
const mult = 1; // XAUUSDT: 1 contract = 1 oz
const rawQty = riskDollars / (stopDist * mult);
const qty = Math.max(0.001, Math.floor(rawQty * 1000) / 1000); // respect Bybit qtyStep 0.001
const actualRisk = qty * stopDist * mult;
const notional = qty * entry;

console.log(`\nSIZING  (stop costs exactly ${riskPct}% of equity)`);
console.log(`  stop distance     $${stopDist.toFixed(2)} / oz`);
console.log(`  risk budget       $${riskDollars.toFixed(2)}`);
console.log(`  position size     ${qty} oz`);
console.log(`  actual risk       $${actualRisk.toFixed(2)}  (${((actualRisk / equity) * 100).toFixed(2)}% of equity)`);
console.log(`  notional          $${notional.toFixed(2)}`);

// ── Payoff ───────────────────────────────────────────────────────────────────
console.log(`\nTARGETS`);
if (targets.length === 0) {
  console.log('  none supplied — a trade without a target is a trade without a plan');
} else {
  for (const [i, t] of targets.entries()) {
    const dist = isLong ? t - entry : entry - t;
    const r = dist / stopDist;
    const pnl = qty * dist * mult;
    const flag = r < 1 ? '  <-- below 1R' : '';
    console.log(`  TP${i + 1}  ${t}   ${dist >= 0 ? '+' : ''}$${dist.toFixed(2)}/oz   ${r.toFixed(2)}R   P&L $${pnl.toFixed(2)}${flag}`);
  }
}

// ── Discipline checks ────────────────────────────────────────────────────────
console.log(`\nCHECKS`);
const warn = [];
const block = [];

if (settings.isKillSwitchActive) block.push('kill switch is ACTIVE');
if (openCount > 0) block.push(`${openCount} position already open — no stacking`);
if (qty > (settings.maxPositionSize ?? Infinity)) block.push(`size ${qty} exceeds maxPositionSize ${settings.maxPositionSize}`);
if (riskPct > 2) warn.push(`risking ${riskPct}% per trade is aggressive for a ${equity} account`);

const bestR = targets.length ? Math.max(...targets.map(t => (isLong ? t - entry : entry - t) / stopDist)) : 0;
if (targets.length && bestR < 1) block.push(`best target is only ${bestR.toFixed(2)}R — you risk more than you can win`);
else if (targets.length && bestR < 1.5) warn.push(`best target ${bestR.toFixed(2)}R — needs a >${(100 / (1 + bestR)).toFixed(0)}% win rate to break even`);

if (!settings.bybitApiKey || !settings.bybitApiSecret) block.push('no exchange credentials configured');
if (!priceInfo?.price) warn.push('live price unavailable — entry is your supplied value, unverified');

for (const b of block) console.log(`  BLOCK  ${b}`);
for (const w of warn) console.log(`  WARN   ${w}`);
if (!block.length && !warn.length) console.log('  all clear');

console.log(`\n${'='.repeat(70)}`);
if (block.length) {
  console.log('VERDICT: REJECTED — fix the blocks above.');
  process.exit(1);
}
const breakeven = bestR > 0 ? (100 / (1 + bestR)).toFixed(0) : '—';
console.log(`VERDICT: valid. ${qty} oz, risking $${actualRisk.toFixed(2)} to make up to $${(qty * (isLong ? Math.max(...targets) - entry : entry - Math.min(...targets)) * mult).toFixed(2)}.`);
console.log(`Needs a >${breakeven}% win rate at the furthest target to be profitable long run.`);
console.log('Nothing was sent. Execute deliberately from the dashboard.');
