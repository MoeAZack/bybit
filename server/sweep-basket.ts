/**
 * sweep-basket.ts — run a strategy across a decorrelated futures basket, walk-forward.
 *
 *   npx tsx server/sweep-basket.ts                       # default config
 *   npx tsx server/sweep-basket.ts --sl 2.5 --tp 5       # override geometry
 *   npx tsx server/sweep-basket.ts --sweep tp            # compare targets across the basket
 *
 * Read the CONSISTENCY line, not the pooled profit. Pooled profit is dominated by whichever
 * market trended hardest over the window; consistency asks whether the rules worked on
 * markets that have nothing to do with each other.
 */
import { runMultiInstrument } from './multiInstrument.js';
import { StrategyParams } from './backtester.js';

const argOf = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const START = Date.parse('2016-08-01T00:00:00Z');
const END = Date.parse('2026-07-27T00:00:00Z');

const base: Omit<StrategyParams, 'symbol'> = {
  fastEma: Number(argOf('fast', '12')),
  slowEma: Number(argOf('slow', '26')),
  rsiPeriod: 14, rsiOverbought: 70, rsiOversold: 30, atrPeriod: 14,
  atrMultiplierSL: Number(argOf('sl', '2.0')),
  atrMultiplierTP: Number(argOf('tp', '5.0')),
  // Futures commissions are per-contract, not percentage; 0.01% is a fair stand-in for a
  // round turn plus a tick of slippage on liquid contracts.
  feePercent: 0.01,
  // Basis points, not ticks: a fixed tick is only meaningful for one instrument.
  // 1bp per side is realistic for liquid futures.
  slippageTicks: 1,
  slippageBps: 1,
  walkForward: 'none', intervalMins: 1440,
  isVolatilitySizingActive: true, riskPercent: 1.0,
  orderType: 'MARKET', isRegimeFilterActive: false,
};

const sweepKey = argOf('sweep');
const sweeps: { label: string; over: Partial<StrategyParams> }[] = sweepKey === 'tp'
  ? [2, 3, 5, 8].map(v => ({ label: `TP=${v}`, over: { atrMultiplierTP: v } }))
  : sweepKey === 'sl'
    ? [1.5, 2, 3, 4].map(v => ({ label: `SL=${v}`, over: { atrMultiplierSL: v } }))
    : [{ label: `SL=${base.atrMultiplierSL} TP=${base.atrMultiplierTP}`, over: {} }];

for (const s of sweeps) {
  const cfg = { ...base, ...s.over };
  process.stdout.write(`\n${'='.repeat(84)}\n${s.label}   (EMA ${cfg.fastEma}/${cfg.slowEma}, risk ${cfg.riskPercent}%/trade, daily)\n${'='.repeat(84)}\n`);

  const res = await runMultiInstrument({
    base: cfg, startMs: START, endMs: END,
    onProgress: (label, i, n) => process.stdout.write(`\r  testing ${String(i).padStart(2)}/${n}  ${label.padEnd(12)}`),
  });
  process.stdout.write('\r' + ' '.repeat(46) + '\r');

  console.log(`IS  ${new Date(res.isStart).toISOString().slice(0, 10)}..${new Date(res.isEnd).toISOString().slice(0, 10)}`);
  console.log(`OOS ${new Date(res.oosStart).toISOString().slice(0, 10)}..${new Date(res.oosEnd).toISOString().slice(0, 10)}\n`);

  console.log('instrument'.padEnd(14) + 'sector'.padEnd(9) + 'IS-expR'.padStart(9) + 'OOS-expR'.padStart(10) + 'OOS-PF'.padStart(8) + '  tr IS/OOS');
  console.log('-'.repeat(84));
  for (const r of res.runs) {
    if (r.error) { console.log(`${r.label.padEnd(14)}${r.sector.padEnd(9)}  ${r.error.slice(0, 46)}`); continue; }
    const mark = (r.oos!.expectancyR > 0) ? ' +' : '  ';
    console.log(
      r.label.padEnd(14) + r.sector.padEnd(9) +
      r.is!.expectancyR.toFixed(3).padStart(9) +
      r.oos!.expectancyR.toFixed(3).padStart(10) +
      (Number.isFinite(r.oos!.profitFactor) ? r.oos!.profitFactor : 99).toFixed(2).padStart(8) +
      `   ${r.is!.totalTrades}/${r.oos!.totalTrades}${mark}`
    );
  }

  console.log('-'.repeat(84));
  console.log(`pooled expectancy   IS ${res.pooledIsExpectancyR.toFixed(3)}R (${res.pooledIsTrades} trades)   OOS ${res.pooledOosExpectancyR.toFixed(3)}R (${res.pooledOosTrades} trades)`);
  console.log(`CONSISTENCY         ${res.positiveOos}/${res.evaluated} instruments positive out-of-sample  (${(res.consistency * 100).toFixed(0)}%)`);
  console.log(`sectors positive    ${res.sectorsPositive.length ? res.sectorsPositive.join(', ') : 'none'}`);
  console.log(`coin-flip p-value   ${res.binomialP}  ${res.binomialP < 0.05 ? '<- unlikely to be chance' : '(not significant)'}`);

  const verdict =
    res.evaluated === 0 ? 'NO USABLE SAMPLE'
      : res.consistency >= 0.65 && res.pooledOosExpectancyR > 0 && res.binomialP < 0.05 ? 'CANDIDATE — broad, positive, unlikely to be chance'
        : res.pooledOosExpectancyR > 0 ? 'MIXED — positive overall but not broad enough to trust'
          : 'NO EDGE';
  console.log(`VERDICT             ${verdict}`);
}
