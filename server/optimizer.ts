/**
 * Parameter optimizer.
 *
 * Sweeps a grid of strategy parameters through the real-data Backtester and ranks the
 * results. This is the engine behind "adjustable, not static": it finds which parameter
 * sets actually performed on historical gold, instead of trusting hand-picked defaults.
 *
 * It only reads history and scores configs — it never touches live execution. Applying a
 * winning config is a separate, deliberate step on the client.
 */
import { Backtester, StrategyParams, BacktestResult } from './backtester.js';

export type RankMetric = 'expectancyR' | 'expectancy' | 'profitFactor' | 'winRate' | 'netPnl';

export interface OptimizeMetrics {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  expectancyR: number;
  netPnl: number;
}

export interface OptimizeResult {
  params: StrategyParams;
  sweptValues: Record<string, number>;   // just the params that varied, for compact display
  /** Out-of-sample metrics — what the ranking is based on. */
  metrics: OptimizeMetrics;
  /** In-sample metrics, for comparison against `metrics`. */
  inSample?: OptimizeMetrics;
  /**
   * Fractional drop from in-sample to out-of-sample on the ranking metric.
   * 0 = held up perfectly, 1 = the entire edge vanished out of sample, >1 = it inverted.
   * Anything above ~0.5 usually means the config was fitted to noise.
   */
  degradation?: number;
  overfitRisk?: 'low' | 'medium' | 'high';
}

// Cartesian product of the swept parameter ranges, hard-capped so a runaway grid cannot
// spawn thousands of backtests.
function buildGrid(sweeps: Record<string, number[]>, maxCombos: number): Record<string, number>[] {
  const keys = Object.keys(sweeps).filter(k => Array.isArray(sweeps[k]) && sweeps[k].length > 0);
  let combos: Record<string, number>[] = [{}];
  for (const key of keys) {
    const next: Record<string, number>[] = [];
    for (const combo of combos) {
      for (const val of sweeps[key]) {
        next.push({ ...combo, [key]: val });
        if (next.length > maxCombos) break;
      }
    }
    combos = next;
    if (combos.length > maxCombos) {
      combos = combos.slice(0, maxCombos);
      break;
    }
  }
  return combos;
}

function netPnlOf(r: BacktestResult): number {
  // BacktestResult exposes expectancy per trade and trade count; net = expectancy * trades.
  return (r.expectancy || 0) * (r.totalTrades || 0);
}

const metricsOf = (r: BacktestResult): OptimizeMetrics => ({
  totalTrades: r.totalTrades,
  winRate: r.winRate,
  profitFactor: r.profitFactor,
  expectancy: r.expectancy,
  expectancyR: r.expectancyR,
  netPnl: netPnlOf(r),
});

const score = (m: OptimizeMetrics, rankBy: RankMetric): number => {
  switch (rankBy) {
    case 'expectancy': return m.expectancy;
    case 'profitFactor': return m.profitFactor;
    case 'winRate': return m.winRate;
    case 'netPnl': return m.netPnl;
    case 'expectancyR':
    default: return m.expectancyR;
  }
};

/**
 * Sweep a parameter grid with WALK-FORWARD validation.
 *
 * The previous implementation optimized and evaluated on the same candles, so the winner was
 * simply whichever config best fitted that period's noise — the textbook way to produce a
 * backtest that looks excellent and loses money live. Now each config is fitted on an
 * in-sample window and scored on a later out-of-sample window it never saw. Ranking uses the
 * OUT-OF-SAMPLE result, and the in-sample→out-of-sample degradation is reported so an
 * overfitted config is visible rather than flattering.
 *
 * @param splitRatio fraction of the window used for in-sample fitting (default 0.7).
 */
export async function optimize(
  base: StrategyParams,
  sweeps: Record<string, number[]>,
  rankBy: RankMetric,
  maxCombos = 40,
  opts: { walkForward?: boolean; splitRatio?: number; startMs?: number; endMs?: number } = {},
): Promise<{ ranked: OptimizeResult[]; ran: number; capped: boolean; walkForward: boolean; window?: { isStart: number; isEnd: number; oosStart: number; oosEnd: number } }> {
  const grid = buildGrid(sweeps, maxCombos);
  const capped = Object.values(sweeps).reduce((n, arr) => n * Math.max(1, arr.length), 1) > grid.length;

  const useWf = opts.walkForward !== false;
  // Default window: the last 6 months, matching the Backtester's own default.
  const endMs = opts.endMs ?? Date.parse('2026-06-30T23:59:59Z');
  const startMs = opts.startMs ?? Date.parse('2026-01-01T00:00:00Z');
  const split = Math.min(0.9, Math.max(0.5, opts.splitRatio ?? 0.7));
  const boundary = startMs + Math.floor((endMs - startMs) * split);

  const results: OptimizeResult[] = [];
  for (const swept of grid) {
    const params: StrategyParams = { ...base, ...swept };
    try {
      if (!useWf) {
        const r = await Backtester.run(params);
        results.push({ params, sweptValues: swept, metrics: metricsOf(r) });
        continue;
      }

      const isRun = await Backtester.run({ ...params, startMs, endMs: boundary });
      const oosRun = await Backtester.run({ ...params, startMs: boundary, endMs });
      const inSample = metricsOf(isRun);
      const outSample = metricsOf(oosRun);

      const isScore = score(inSample, rankBy);
      const oosScore = score(outSample, rankBy);
      const degradation = isScore > 0 ? (isScore - oosScore) / Math.abs(isScore) : (oosScore >= 0 ? 0 : 1);
      const overfitRisk: OptimizeResult['overfitRisk'] =
        degradation > 0.5 ? 'high' : degradation > 0.25 ? 'medium' : 'low';

      results.push({ params, sweptValues: swept, metrics: outSample, inSample, degradation, overfitRisk });
    } catch (e: any) {
      // A single failing config (e.g. too few trades) should not abort the sweep.
      console.warn('[Optimizer] config failed:', swept, e?.message || e);
    }
  }

  // Rank best-first on out-of-sample performance. Require a meaningful sample in BOTH
  // windows — a config with 3 out-of-sample trades tells you nothing.
  const ranked = results
    .filter(r => r.metrics.totalTrades >= 5 && (!r.inSample || r.inSample.totalTrades >= 5))
    .sort((a, b) => score(b.metrics, rankBy) - score(a.metrics, rankBy));

  return {
    ranked,
    ran: results.length,
    capped,
    walkForward: useWf,
    window: useWf ? { isStart: startMs, isEnd: boundary, oosStart: boundary, oosEnd: endMs } : undefined,
  };
}
