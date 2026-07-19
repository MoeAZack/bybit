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

export interface OptimizeResult {
  params: StrategyParams;
  sweptValues: Record<string, number>;   // just the params that varied, for compact display
  metrics: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    expectancy: number;
    expectancyR: number;
    netPnl: number;
  };
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

export async function optimize(
  base: StrategyParams,
  sweeps: Record<string, number[]>,
  rankBy: RankMetric,
  maxCombos = 40,
): Promise<{ ranked: OptimizeResult[]; ran: number; capped: boolean }> {
  const grid = buildGrid(sweeps, maxCombos);
  const capped = Object.values(sweeps).reduce((n, arr) => n * Math.max(1, arr.length), 1) > grid.length;

  const results: OptimizeResult[] = [];
  for (const swept of grid) {
    const params: StrategyParams = { ...base, ...swept };
    try {
      const r = await Backtester.run(params);
      results.push({
        params,
        sweptValues: swept,
        metrics: {
          totalTrades: r.totalTrades,
          winRate: r.winRate,
          profitFactor: r.profitFactor,
          expectancy: r.expectancy,
          expectancyR: r.expectancyR,
          netPnl: netPnlOf(r),
        },
      });
    } catch (e: any) {
      // A single failing config (e.g. too few trades) should not abort the sweep.
      console.warn('[Optimizer] config failed:', swept, e?.message || e);
    }
  }

  const score = (m: OptimizeResult['metrics']): number => {
    switch (rankBy) {
      case 'expectancy': return m.expectancy;
      case 'profitFactor': return m.profitFactor;
      case 'winRate': return m.winRate;
      case 'netPnl': return m.netPnl;
      case 'expectancyR':
      default: return m.expectancyR;
    }
  };

  // Rank best-first, but ignore degenerate configs that took almost no trades.
  const ranked = results
    .filter(r => r.metrics.totalTrades >= 5)
    .sort((a, b) => score(b.metrics) - score(a.metrics));

  return { ranked, ran: results.length, capped };
}
