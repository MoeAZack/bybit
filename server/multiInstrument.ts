/**
 * Multi-instrument walk-forward validation.
 *
 * A daily strategy on one market produces ~4 trades a year. Ten years of gold gave 13
 * out-of-sample trades, which cannot distinguish an edge from luck no matter how good the
 * data is. Running identical rules across a decorrelated basket fixes the sample size AND
 * — the part that actually matters — tests whether the effect is structural.
 *
 * The headline metric here is deliberately NOT pooled profit. Pooled profit is dominated by
 * whichever instrument trended hardest, so one lucky market can carry a worthless strategy.
 * The metric that matters is CONSISTENCY: on how many of the instruments, independently, was
 * out-of-sample expectancy positive? A strategy that works on 11 of 14 uncorrelated markets
 * is telling you something. One that works on 2 and loses on 12 is noise with a good headline.
 */
import { Backtester, StrategyParams, BacktestResult } from './backtester.js';
import { setDataProvider } from './data/index.js';
import { YahooDataProvider, DEFAULT_BASKET } from './data/yahooProvider.js';

export interface InstrumentRun {
  symbol: string;
  label: string;
  sector: string;
  is?: BacktestResult;
  oos?: BacktestResult;
  error?: string;
}

export interface MultiResult {
  runs: InstrumentRun[];
  isStart: number; isEnd: number; oosStart: number; oosEnd: number;
  /** Trade-weighted expectancy across everything that traded. */
  pooledIsExpectancyR: number;
  pooledOosExpectancyR: number;
  pooledIsTrades: number;
  pooledOosTrades: number;
  /** Instruments with positive OOS expectancy / instruments that produced a usable sample. */
  positiveOos: number;
  evaluated: number;
  consistency: number;
  /** Probability of seeing at least this many positives if the strategy were a coin flip. */
  binomialP: number;
  sectorsPositive: string[];
}

/** P(X >= k) for X ~ Binomial(n, 0.5). A crude but honest guard against reading noise. */
function binomialTailP(k: number, n: number): number {
  if (n === 0) return 1;
  const logC = (n: number, r: number) => {
    let s = 0;
    for (let i = 0; i < r; i++) s += Math.log(n - i) - Math.log(i + 1);
    return s;
  };
  let p = 0;
  for (let i = k; i <= n; i++) p += Math.exp(logC(n, i) + n * Math.log(0.5));
  return Math.min(1, p);
}

export async function runMultiInstrument(opts: {
  base: Omit<StrategyParams, 'symbol'>;
  basket?: { symbol: string; label: string; sector: string }[];
  startMs: number;
  endMs: number;
  splitRatio?: number;
  minTrades?: number;
  onProgress?: (label: string, i: number, n: number) => void;
}): Promise<MultiResult> {
  const basket = opts.basket ?? DEFAULT_BASKET;
  const split = Math.min(0.9, Math.max(0.5, opts.splitRatio ?? 0.7));
  const boundary = opts.startMs + Math.floor((opts.endMs - opts.startMs) * split);
  const minTrades = opts.minTrades ?? 8;

  // Every instrument is fetched from Yahoo regardless of any BACKTEST_CSV in the env,
  // so a stale local file cannot silently substitute for one leg of the basket.
  setDataProvider(new YahooDataProvider());

  const runs: InstrumentRun[] = [];
  try {
    for (let i = 0; i < basket.length; i++) {
      const inst = basket[i];
      opts.onProgress?.(inst.label, i + 1, basket.length);
      const params = { ...opts.base, symbol: inst.symbol, intervalMins: 1440 } as StrategyParams;
      try {
        const is = await Backtester.run({ ...params, startMs: opts.startMs, endMs: boundary });
        const oos = await Backtester.run({ ...params, startMs: boundary, endMs: opts.endMs });
        runs.push({ ...inst, is, oos });
      } catch (e: any) {
        runs.push({ ...inst, error: e?.message || String(e) });
      }
    }
  } finally {
    setDataProvider(null);
  }

  const usable = runs.filter(r => r.is && r.oos && r.is.totalTrades >= minTrades && r.oos.totalTrades >= minTrades);

  const weighted = (rs: InstrumentRun[], pick: (r: InstrumentRun) => BacktestResult | undefined) => {
    let n = 0, sum = 0;
    for (const r of rs) {
      const b = pick(r);
      if (!b || !b.totalTrades) continue;
      sum += b.expectancyR * b.totalTrades;
      n += b.totalTrades;
    }
    return { exp: n ? sum / n : 0, trades: n };
  };

  const pooledIs = weighted(usable, r => r.is);
  const pooledOos = weighted(usable, r => r.oos);
  const positives = usable.filter(r => (r.oos!.expectancyR) > 0);

  return {
    runs,
    isStart: opts.startMs, isEnd: boundary, oosStart: boundary, oosEnd: opts.endMs,
    pooledIsExpectancyR: +pooledIs.exp.toFixed(4),
    pooledOosExpectancyR: +pooledOos.exp.toFixed(4),
    pooledIsTrades: pooledIs.trades,
    pooledOosTrades: pooledOos.trades,
    positiveOos: positives.length,
    evaluated: usable.length,
    consistency: usable.length ? +(positives.length / usable.length).toFixed(3) : 0,
    binomialP: +binomialTailP(positives.length, usable.length).toFixed(4),
    sectorsPositive: [...new Set(positives.map(r => r.sector))].sort(),
  };
}
