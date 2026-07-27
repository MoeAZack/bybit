/**
 * sweep-walkforward.ts — does ANY config in this strategy family have positive
 * out-of-sample expectancy?
 *
 * Fits on the in-sample window, scores on a later window it never saw, and reports the
 * in-sample -> out-of-sample degradation so overfitted configs are visible.
 *
 * Run: npx tsx server/sweep-walkforward.ts
 */
import { optimize, RankMetric } from './optimizer.js';
import { StrategyParams } from './backtester.js';

const base: StrategyParams = {
  fastEma: 12, slowEma: 26, rsiPeriod: 14, rsiOverbought: 70, rsiOversold: 30,
  atrPeriod: 14, atrMultiplierSL: 1.5, atrMultiplierTP: 3.0,
  feePercent: 0.055, slippageTicks: 1, walkForward: 'none', symbol: 'XAUUSDT',
  isVolatilitySizingActive: true, riskPercent: 1.0, orderType: 'MARKET',
};

const RANK: RankMetric = 'expectancyR';

const scenarios: { label: string; base: Partial<StrategyParams>; sweeps: Record<string, number[]> }[] = [
  {
    label: 'A. Stop/target geometry (no regime filter)',
    base: { isRegimeFilterActive: false },
    sweeps: { atrMultiplierSL: [1.0, 1.5, 2.5], atrMultiplierTP: [2.0, 3.0, 5.0] },
  },
  {
    label: 'B. Same geometry, ADX regime filter ON',
    base: { isRegimeFilterActive: true, adxThreshold: 25 },
    sweeps: { atrMultiplierSL: [1.0, 1.5, 2.5], atrMultiplierTP: [2.0, 3.0, 5.0] },
  },
  {
    label: 'C. Trend-speed (EMA pair), regime filter ON',
    base: { isRegimeFilterActive: true, adxThreshold: 25 },
    sweeps: { fastEma: [8, 12, 21], slowEma: [26, 50] },
  },
  {
    label: 'D. Maker fees (post-only) instead of taker',
    base: { isRegimeFilterActive: true, adxThreshold: 25, orderType: 'LIMIT_POST_ONLY' as const },
    sweeps: { atrMultiplierTP: [2.0, 3.0, 5.0] },
  },
];

const pct = (n: number | undefined) => (n === undefined ? '   n/a' : `${(n * 100).toFixed(0)}%`.padStart(6));
const num = (n: number | undefined, d = 3) => (n === undefined ? 'n/a' : n.toFixed(d));

let bestOverall: { label: string; swept: any; oos: number; is: number; trades: number } | null = null;

for (const sc of scenarios) {
  console.log(`\n${'='.repeat(78)}\n${sc.label}\n${'='.repeat(78)}`);
  const out = await optimize({ ...base, ...sc.base } as StrategyParams, sc.sweeps, RANK, 12);

  if (out.window && sc === scenarios[0]) {
    console.log(`IS  ${new Date(out.window.isStart).toISOString().slice(0, 10)} -> ${new Date(out.window.isEnd).toISOString().slice(0, 10)}`);
    console.log(`OOS ${new Date(out.window.oosStart).toISOString().slice(0, 10)} -> ${new Date(out.window.oosEnd).toISOString().slice(0, 10)}\n`);
  }

  if (out.ranked.length === 0) {
    console.log('  (no config produced >=5 trades in both windows)');
    continue;
  }

  console.log('  config'.padEnd(38) + 'IS-expR'.padStart(9) + 'OOS-expR'.padStart(10) + 'degr'.padStart(8) + 'risk'.padStart(8) + '  trades');
  for (const r of out.ranked.slice(0, 6)) {
    const cfg = Object.entries(r.sweptValues).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(
      `  ${cfg}`.padEnd(38) +
      num(r.inSample?.expectancyR).padStart(9) +
      num(r.metrics.expectancyR).padStart(10) +
      pct(r.degradation).padStart(8) +
      String(r.overfitRisk).padStart(8) +
      `  ${r.inSample?.totalTrades}/${r.metrics.totalTrades}`
    );
    if (r.metrics.expectancyR > (bestOverall?.oos ?? -Infinity)) {
      bestOverall = { label: sc.label, swept: r.sweptValues, oos: r.metrics.expectancyR, is: r.inSample?.expectancyR ?? 0, trades: r.metrics.totalTrades };
    }
  }
}

console.log(`\n${'='.repeat(78)}\nVERDICT\n${'='.repeat(78)}`);
if (!bestOverall) {
  console.log('No config produced a usable sample.');
} else if (bestOverall.oos > 0) {
  console.log(`Best OUT-OF-SAMPLE expectancy: ${bestOverall.oos.toFixed(3)}R`);
  console.log(`  scenario : ${bestOverall.label}`);
  console.log(`  config   : ${JSON.stringify(bestOverall.swept)}`);
  console.log(`  IS ${bestOverall.is.toFixed(3)}R -> OOS ${bestOverall.oos.toFixed(3)}R over ${bestOverall.trades} OOS trades`);
  console.log('\nPositive, but treat with suspicion until it survives a THIRD unseen window.');
} else {
  console.log(`Best out-of-sample expectancy across every config tested: ${bestOverall.oos.toFixed(3)}R`);
  console.log(`  (${bestOverall.label} / ${JSON.stringify(bestOverall.swept)})`);
  console.log('\nEvery configuration loses money out of sample. This is a strategy-family');
  console.log('problem, not a parameter problem — no amount of tuning fixes a negative edge.');
}
