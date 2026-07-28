/**
 * sweep-families.ts — test whole strategy FAMILIES across the decorrelated basket,
 * walk-forward, with identical costs and exits so the comparison is fair.
 *
 *   npx tsx server/sweep-families.ts
 *
 * Read CONSISTENCY, not pooled profit. And note the CONTROL row: MACROSS is the strategy
 * already shown to have no edge by the legacy engine. If it comes out positive here, the
 * new engine is broken and every other row is untrustworthy.
 */
import { YahooDataProvider, DEFAULT_BASKET } from './data/yahooProvider.js';
import { runEngine, EngineParams, EngineBar } from './strategies/engine.js';
import { FAMILY_SUITE } from './strategies/families.js';

const START = Date.parse('2016-08-01T00:00:00Z');
const END = Date.parse('2026-07-27T00:00:00Z');
const SPLIT = 0.7;
const BOUNDARY = START + Math.floor((END - START) * SPLIT);

const params: EngineParams = {
  atrPeriod: 14,
  atrMultiplierSL: 2.0,
  riskPercent: 1.0,
  feePercent: 0.01,     // per side; stand-in for a futures round turn
  slippageBps: 1,       // per side, scale-correct
  maxLeverage: 10,
  initialBalance: 10000,
};

const binomialTailP = (k: number, n: number): number => {
  if (n === 0) return 1;
  const logC = (n: number, r: number) => { let s = 0; for (let i = 0; i < r; i++) s += Math.log(n - i) - Math.log(i + 1); return s; };
  let p = 0;
  for (let i = k; i <= n; i++) p += Math.exp(logC(n, i) + n * Math.log(0.5));
  return Math.min(1, p);
};

const provider = new YahooDataProvider();

// Fetch once, reuse for every family — same bars for every strategy keeps it a fair test.
console.log('loading basket...');
const data = new Map<string, EngineBar[]>();
for (const inst of DEFAULT_BASKET) {
  try {
    data.set(inst.symbol, await provider.getBars(inst.symbol, 1440, START, END) as EngineBar[]);
  } catch (e: any) {
    console.log(`  ${inst.label}: ${e.message.slice(0, 60)}`);
  }
}
console.log(`loaded ${data.size}/${DEFAULT_BASKET.length} instruments\n`);
console.log(`IS  ${new Date(START).toISOString().slice(0, 10)}..${new Date(BOUNDARY).toISOString().slice(0, 10)}`);
console.log(`OOS ${new Date(BOUNDARY).toISOString().slice(0, 10)}..${new Date(END).toISOString().slice(0, 10)}\n`);

console.log('strategy'.padEnd(22) + 'family'.padEnd(11) + 'IS-expR'.padStart(9) + 'OOS-expR'.padStart(10) + 'consistency'.padStart(13) + 'p'.padStart(8) + '  OOS trades');
console.log('-'.repeat(92));

type Row = { s: string; fam: string; isE: number; oosE: number; pos: number; n: number; p: number; trades: number };
const rows: Row[] = [];

for (const strat of FAMILY_SUITE) {
  let isSum = 0, isN = 0, oosSum = 0, oosN = 0, pos = 0, evaluated = 0;

  for (const inst of DEFAULT_BASKET) {
    const bars = data.get(inst.symbol);
    if (!bars) continue;
    const isBars = bars.filter(b => b.time <= BOUNDARY);
    const oosBars = bars.filter(b => b.time >= BOUNDARY);
    if (isBars.length < strat.warmup + 30 || oosBars.length < strat.warmup + 30) continue;

    const a = runEngine(isBars, strat, params);
    const b = runEngine(oosBars, strat, params);
    if (a.totalTrades < 8 || b.totalTrades < 5) continue;

    isSum += a.expectancyR * a.totalTrades; isN += a.totalTrades;
    oosSum += b.expectancyR * b.totalTrades; oosN += b.totalTrades;
    evaluated++;
    if (b.expectancyR > 0) pos++;
  }

  if (evaluated === 0) { console.log(strat.name.padEnd(22) + strat.family.padEnd(11) + '  (no usable sample)'); continue; }

  const isE = isN ? isSum / isN : 0;
  const oosE = oosN ? oosSum / oosN : 0;
  const p = binomialTailP(pos, evaluated);
  rows.push({ s: strat.name, fam: strat.family, isE, oosE, pos, n: evaluated, p, trades: oosN });

  console.log(
    strat.name.padEnd(22) + strat.family.padEnd(11) +
    isE.toFixed(3).padStart(9) + oosE.toFixed(3).padStart(10) +
    `${pos}/${evaluated}`.padStart(9) + `${((pos / evaluated) * 100).toFixed(0)}%`.padStart(5) +
    p.toFixed(3).padStart(8) + `   ${oosN}` + (oosE > 0 && p < 0.05 ? '  <<<' : '')
  );
}

console.log('-'.repeat(92));
// The DISCRETE control is the one that mirrors the legacy rules; the always-in-market
// MACROSS variant is a different strategy and must not be used as the reference.
const ctrl = rows.find(r => r.s.includes('DISC')) ?? rows.find(r => r.fam === 'control');
if (ctrl) {
  console.log(`CONTROL CHECK: ${ctrl.s} OOS ${ctrl.oosE.toFixed(3)}R, ${ctrl.pos}/${ctrl.n} positive`);
  // Legacy engine, same rules, same basket: IS -0.383R / OOS -0.244R, 3/13 positive.
  const LEGACY_OOS = -0.244;
  const gap = Math.abs(ctrl.oosE - LEGACY_OOS);
  console.log(`  legacy engine on the same rules: ${LEGACY_OOS}R  |  gap ${gap.toFixed(3)}R`);
  console.log(gap < 0.10
    ? '  Control reproduces the legacy result — engine validated, rows above are trustworthy.'
    : '  ENGINE NOT VALIDATED: the control does not reproduce the legacy result. The two engines differ in some way not yet identified, so every row above is provisional and must NOT be treated as a finding until the gap is explained.');
}

const winners = rows.filter(r => r.fam !== 'control' && r.oosE > 0 && r.isE > 0 && r.p < 0.05 && r.pos / r.n >= 0.6);
console.log(`\n${'='.repeat(92)}`);
if (winners.length === 0) {
  const best = rows.filter(r => r.fam !== 'control').sort((a, b) => b.oosE - a.oosE)[0];
  console.log('NO FAMILY PASSES. Best out-of-sample:');
  if (best) console.log(`  ${best.s} — ${best.oosE.toFixed(3)}R, ${best.pos}/${best.n} instruments (p=${best.p.toFixed(3)})`);
  console.log('  A family passes only if it is positive in BOTH windows, positive on >=60% of');
  console.log('  instruments, and unlikely to be chance (p<0.05).');
} else {
  console.log('CANDIDATES (positive both windows, broad, p<0.05):');
  for (const w of winners) console.log(`  ${w.s.padEnd(22)} IS ${w.isE.toFixed(3)}R -> OOS ${w.oosE.toFixed(3)}R | ${w.pos}/${w.n} instruments | p=${w.p.toFixed(4)} | ${w.trades} OOS trades`);
  console.log('\nA candidate is not a system. Next: a third unseen window, then live shadow mode.');
}
