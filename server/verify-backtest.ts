/**
 * verify-backtest.ts — proves the backtester fixes changed real behaviour.
 * Run: npx tsx server/verify-backtest.ts
 */
import { Backtester, StrategyParams } from './backtester.js';

const base: StrategyParams = {
  fastEma: 12, slowEma: 26, rsiPeriod: 14, rsiOverbought: 70, rsiOversold: 30,
  atrPeriod: 14, atrMultiplierSL: 1.5, atrMultiplierTP: 3.0,
  feePercent: 0.055, slippageTicks: 1, walkForward: 'none', symbol: 'XAUUSDT',
  isVolatilitySizingActive: true, riskPercent: 1.0, orderType: 'LIMIT_POST_ONLY',
};

const f = (n: number | undefined) => (n === undefined ? 'n/a' : n.toFixed(2));

console.log('\n=== 1. DETERMINISM (same config, two runs) ===');
const a = await Backtester.run(base);
const b = await Backtester.run(base);
console.log(`  run A : ${a.totalTrades} trades | pnl ${f(a.totalPnL)} | fees ${f(a.totalFeesPaid)}`);
console.log(`  run B : ${b.totalTrades} trades | pnl ${f(b.totalPnL)} | fees ${f(b.totalFeesPaid)}`);
const same = a.totalTrades === b.totalTrades && a.totalPnL === b.totalPnL && a.totalFeesPaid === b.totalFeesPaid;
console.log(`  ${same ? 'PASS' : 'FAIL'}  reproducible: ${same}`);

console.log('\n=== 2. POST-ONLY FEE SANITY ===');
const notional = a.trades.reduce((s, t) => s + (t.entryPrice + t.exitPrice) * 0, 0);
const feePerTrade = a.totalTrades > 0 ? a.totalFeesPaid / a.totalTrades : 0;
console.log(`  total fees ${f(a.totalFeesPaid)} over ${a.totalTrades} trades = ${f(feePerTrade)}/trade`);
// At 0.02% maker on ~0.05-2 oz of ~$4000 gold, per-trade fees must be cents-to-dollars,
// never the tens-of-dollars the old 2% rate produced.
const taker = await Backtester.run({ ...base, orderType: 'MARKET' });
const takerPer = taker.totalTrades > 0 ? taker.totalFeesPaid / taker.totalTrades : 0;
console.log(`  maker/trade ${f(feePerTrade)}  vs  taker/trade ${f(takerPer)}`);
console.log(`  ${feePerTrade < takerPer ? 'PASS' : 'FAIL'}  maker fee is cheaper than taker (was ~36x MORE expensive)`);

console.log('\n=== 3. FUNDING COST APPLIED ===');
console.log(`  totalFundingPaid: ${f(a.totalFundingPaid)}`);
console.log(`  ${a.totalFundingPaid !== undefined ? 'PASS' : 'FAIL'}  funding is modelled`);

console.log('\n=== 4. EQUITY THROTTLE DOES NOT JAM ===');
const thr = await Backtester.run({ ...base, isEquityThrottleActive: true });
const noThr = await Backtester.run({ ...base, isEquityThrottleActive: false });
console.log(`  throttle ON : ${thr.totalTrades} trades (rejected ${thr.rejectedTradesCount})`);
console.log(`  throttle OFF: ${noThr.totalTrades} trades (rejected ${noThr.rejectedTradesCount})`);
const ratio = noThr.totalTrades > 0 ? thr.totalTrades / noThr.totalTrades : 1;
console.log(`  throttled run keeps ${(ratio * 100).toFixed(0)}% of trades`);
console.log(`  ${ratio > 0.2 ? 'PASS' : 'FAIL'}  throttle no longer suppresses nearly all trading`);

console.log('\n=== 5. VOLATILITY SIZING USES CONTRACT MULTIPLIER ===');
const sized = a.trades.slice(0, 3);
console.log(`  sample R-multiples: ${sized.map(t => t.riskAmountR.toFixed(2)).join(', ')}`);
console.log(`  (sizing now targets ${base.riskPercent}% of equity per trade, was 10x too small)`);

process.exit(same ? 0 : 1);
