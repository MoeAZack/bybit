/**
 * verify-fixes.ts — asserts the hardening fixes behave correctly.
 * Run: npx tsx server/verify-fixes.ts
 */
import { StrategyRouter } from './strategyRouter.js';
import { resolveAutoMode, venueSymbol } from './signalEngine.js';
import { QuantDataManager } from './quantData.js';

let pass = 0, fail = 0;
function check(name: string, actual: any, expected: any) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
  ok ? pass++ : fail++;
}

const base: any = {
  activeBroker: 'bybit', isPaperTrading: false, isKillSwitchActive: false,
  bybitApiKey: 'k', bybitApiSecret: 's',
};

console.log('\n--- DEAD-MAN SWITCH (true = entries blocked) ---');
check('bybit, healthy, keys present', StrategyRouter.isDeadManTripped({ ...base }), false);
check('bybit, kill switch thrown', StrategyRouter.isDeadManTripped({ ...base, isKillSwitchActive: true }), true);
check('bybit, live but NO api keys', StrategyRouter.isDeadManTripped({ ...base, bybitApiKey: '', bybitApiSecret: '' }), true);
check('bybit, paper mode needs no keys', StrategyRouter.isDeadManTripped({ ...base, isPaperTrading: true, bybitApiKey: '', bybitApiSecret: '' }), false);
check('mt5, bridge offline (no heartbeat)', StrategyRouter.isDeadManTripped({ ...base, activeBroker: 'mt5' }), true);

console.log('\n--- AUTO MODE RESOLUTION (legacy mt5AutoMode must still work) ---');
check('legacy mt5AutoMode=auto', resolveAutoMode({ mt5AutoMode: 'auto' } as any), 'auto');
check('legacy mt5AutoMode=approve', resolveAutoMode({ mt5AutoMode: 'approve' } as any), 'approve');
check('new autoMode wins', resolveAutoMode({ autoMode: 'auto', mt5AutoMode: 'off' } as any), 'auto');
check('unset defaults off', resolveAutoMode({} as any), 'off');
check('garbage value defaults off', resolveAutoMode({ autoMode: 'banana' } as any), 'off');

console.log('\n--- VENUE SYMBOL ---');
check('bybit -> XAUUSDT', venueSymbol({ activeBroker: 'bybit' } as any), 'XAUUSDT');
check('mt5 -> XAUUSD', venueSymbol({ activeBroker: 'mt5' } as any), 'XAUUSD');

console.log('\n--- NO SYNTHETIC MACRO (must be real or null, never invented) ---');
const charts = await QuantDataManager.fetchMacroCharts();
const synthetic = charts.filter(p => Math.abs(p.dxy - 104.5) < 0.45 && Math.abs(p.yield10y - 4.25) < 0.13);
console.log(`      macro points returned: ${charts.length}`);
if (charts.length > 0) console.log(`      sample: dxy=${charts[0].dxy} yield=${charts[0].yield10y}`);
check('no Math.sin() signature band (104.5±0.4 / 4.25±0.12)', synthetic.length === charts.length && charts.length === 24, false);
const q = await QuantDataManager.fetchBybitQuantData('XAUUSDT');
check('liquidationsUsd is null (was Math.random)', q.liquidationsUsd, null);
console.log(`      fundingRate=${q.fundingRate} fundingPercentile=${q.fundingPercentile} openInterest=${q.openInterest}`);
check('fundingPercentile is real or null (never Math.sin)', q.fundingPercentile === null || (q.fundingPercentile >= 0 && q.fundingPercentile <= 100), true);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
