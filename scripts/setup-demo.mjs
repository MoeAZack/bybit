#!/usr/bin/env node
/**
 * setup-demo.mjs — configure the terminal for Bybit DEMO trading.
 *
 * Applies conservative, validated defaults for a demo shakedown run. Deliberately does
 * NOT write API credentials: you enter those yourself in the Settings UI so they are
 * never stored in shell history, a script, or a git-tracked file.
 *
 * Usage:
 *   node scripts/setup-demo.mjs            # apply demo profile
 *   node scripts/setup-demo.mjs --check    # report current state, change nothing
 *
 * Honours DATA_DIR (same as the server).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const CHECK_ONLY = process.argv.includes('--check');
const DB_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

// Verified against Bybit /v5/market/instruments-info for XAUUSDT (linear) on 2026-07-27:
//   minOrderQty 0.001 | qtyStep 0.001 | tickSize 0.01 | maxLeverage 100
const CONTRACT = { minOrderQty: 0.001, qtyStep: 0.001, tickSize: 0.01 };

/**
 * Demo profile. Rationale for the non-obvious ones:
 *  - isPaperTrading:false + bybitEnvironment:'demo' is what actually exercises the real
 *    signing/order/fill path against api-demo.bybit.com with fake funds. Leaving
 *    isPaperTrading:true would keep orders inside this process and prove nothing.
 *  - autoMode:'approve' surfaces signals for one-click firing. Watch it for a few days
 *    before switching to 'auto'.
 *  - circuit breaker ON at 5%: on Bybit this was previously dead code, so this is the
 *    first run where it actually protects the account.
 *  - defaultOrderSize 0.05 oz: with a ~1.5x ATR stop (~$20 on 1H gold) that risks ~$1
 *    per trade — deliberately small while validating. Scale up only after the demo run.
 */
const DEMO_PROFILE = {
  activeBroker: 'bybit',
  bybitEnvironment: 'demo',
  isPaperTrading: false,
  autoMode: 'approve',
  mt5AutoMode: 'approve',       // legacy key kept in sync so the existing UI toggle matches
  isKillSwitchActive: false,
  isCircuitBreakerActive: true,
  maxDrawdownPercent: 5,
  isHybridStopsActive: true,
  isDynamicSlActive: true,
  atrMultiplier: 1.5,
  stopLossPercent: 1.5,
  takeProfitPercent: 3,
  defaultOrderSize: 0.05,
  defaultSymbol: 'XAUUSDT',
  signalCandleMinutes: 5,
};

const KEEP_MT5 = ['mt5Login', 'mt5Password', 'mt5Server', 'mt5Host', 'mt5GatewayUrl', 'mt5GatewayToken', 'mt5AccountType'];

function main() {
  if (!existsSync(DB_FILE)) {
    console.log(`No db.json at ${DB_FILE}.`);
    console.log('Start the server once (npm run dev) to generate it, then re-run this script.');
    process.exit(1);
  }

  const db = JSON.parse(readFileSync(DB_FILE, 'utf8'));
  const s = db.settings || {};

  const hasKeys = Boolean(s.bybitApiKey && s.bybitApiSecret);

  if (CHECK_ONLY) {
    console.log('\n=== CURRENT STATE ===');
    for (const k of Object.keys(DEMO_PROFILE)) {
      const cur = s[k];
      const want = DEMO_PROFILE[k];
      const ok = JSON.stringify(cur) === JSON.stringify(want);
      console.log(`  ${ok ? 'ok  ' : 'DIFF'} ${k.padEnd(22)} ${JSON.stringify(cur)}${ok ? '' : `  -> want ${JSON.stringify(want)}`}`);
    }
    console.log(`\n  Bybit API credentials: ${hasKeys ? 'PRESENT' : 'NOT SET (you must add these in Settings)'}`);
    console.log(`  Closed trades on record: ${(db.trades || []).length}`);
    console.log(`  Open paper positions   : ${(db.paperAccount?.positions || []).length}`);
    return;
  }

  const before = {};
  for (const k of Object.keys(DEMO_PROFILE)) before[k] = s[k];

  db.settings = { ...s, ...DEMO_PROFILE };

  // MT5 credentials/config are preserved untouched for future prop-firm use.
  for (const k of KEEP_MT5) if (k in s) db.settings[k] = s[k];
  // Never touch credentials from a script.
  db.settings.bybitApiKey = s.bybitApiKey || '';
  db.settings.bybitApiSecret = s.bybitApiSecret || '';

  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');

  console.log('\n=== DEMO PROFILE APPLIED ===');
  for (const k of Object.keys(DEMO_PROFILE)) {
    const from = JSON.stringify(before[k]);
    const to = JSON.stringify(DEMO_PROFILE[k]);
    console.log(`  ${k.padEnd(22)} ${from === to ? `(unchanged) ${to}` : `${from} -> ${to}`}`);
  }
  console.log(`\n  Contract (verified): minOrderQty ${CONTRACT.minOrderQty}, qtyStep ${CONTRACT.qtyStep}, tickSize ${CONTRACT.tickSize}`);
  console.log(`  MT5 settings preserved for prop-firm use.`);

  console.log('\n=== YOU MUST DO THIS YOURSELF ===');
  if (hasKeys) {
    console.log('  Bybit API credentials are already set. Confirm they are DEMO keys');
    console.log('  (generated at bybit.com -> Demo Trading), not live-account keys.');
  } else {
    console.log('  1. Log in to Bybit -> switch to Demo Trading -> create API keys');
    console.log('     Permissions needed: Contracts (Orders + Positions) + Wallet read.');
    console.log('     Do NOT enable Withdrawals.');
    console.log('  2. Open the terminal UI -> Settings -> paste key + secret -> Save.');
    console.log('     (Entered by you in the UI only — never in a script or shell command.)');
  }
  console.log('\n  Then: watch the Pending Signals panel. Approve trades manually for a few');
  console.log('  days before switching autoMode to "auto".');
}

main();
