/**
 * Generic bar-walking backtest engine with a pluggable signal function.
 *
 * The legacy Backtester hardwires one strategy (EMA cross + RSI) across ~900 lines, so
 * testing a different FAMILY meant surgery. This engine takes the rules as a function and
 * keeps everything else — costs, exits, sizing, conservative intrabar resolution — identical
 * across families, which is the only way a comparison between them means anything.
 *
 * Honesty rules, matching the main backtester:
 *   - signal(i) may only read bars[0..i]. Entry fills at bars[i].close. No look-ahead.
 *   - intrabar, the STOP is checked before the target, so an ambiguous candle is a loss.
 *   - slippage is basis points of price (scale-correct across instruments) and always
 *     applied against us, on entry and exit.
 *   - position size is set so the stop costs exactly riskPercent, capped by notional.
 */

export interface EngineBar { time: number; open: number; high: number; low: number; close: number; volume: number; }
export type Side = 'LONG' | 'SHORT' | null;

export interface StrategyCtx {
  atr: number[];
  close: number[];
  high: number[];
  low: number[];
}

export interface Strategy {
  name: string;
  family: string;
  /** Bars needed before the first signal can be trusted. */
  warmup: number;
  /** Desired exposure at bar i, using only data up to and including i. */
  signal(i: number, ctx: StrategyCtx): Side;
  /** Exit when the signal flips to the opposite side (trend styles). Default true. */
  exitOnFlip?: boolean;
  /** Optional target in R multiples. Omit for signal-driven exits only. */
  targetR?: number;
}

export interface EngineParams {
  atrPeriod: number;
  atrMultiplierSL: number;
  riskPercent: number;
  feePercent: number;      // per side, percent of notional
  slippageBps: number;     // per side, basis points of price
  maxLeverage: number;
  maxHoldBars?: number;
  initialBalance: number;
}

export interface EngineTrade { side: Side; entryTime: number; exitTime: number; entry: number; exit: number; qty: number; pnl: number; r: number; reason: 'SL' | 'TP' | 'FLIP' | 'TIME' | 'END'; }

export interface EngineResult {
  totalTrades: number; winRate: number; profitFactor: number;
  expectancy: number; expectancyR: number; netPnl: number; grossPnl: number;
  totalCosts: number; maxDrawdownPercent: number; finalBalance: number;
  trades: EngineTrade[];
}

export function wilderAtr(bars: EngineBar[], len: number): number[] {
  const out = new Array(bars.length).fill(NaN);
  if (bars.length < len + 1) return out;
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const pc = bars[i - 1].close;
    tr.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - pc), Math.abs(bars[i].low - pc)));
  }
  let a = tr.slice(0, len).reduce((x, y) => x + y, 0) / len;
  out[len] = a;
  for (let i = len; i < tr.length; i++) { a = (a * (len - 1) + tr[i]) / len; out[i + 1] = a; }
  return out;
}

export function runEngine(bars: EngineBar[], strat: Strategy, p: EngineParams): EngineResult {
  const atr = wilderAtr(bars, p.atrPeriod);
  const ctx: StrategyCtx = {
    atr,
    close: bars.map(b => b.close),
    high: bars.map(b => b.high),
    low: bars.map(b => b.low),
  };

  let balance = p.initialBalance;
  let peak = balance, maxDd = 0, grossPnl = 0, totalCosts = 0;
  const trades: EngineTrade[] = [];

  let pos: { side: Side; entry: number; stop: number; target: number | null; qty: number; entryIdx: number; riskDollars: number } | null = null;

  const slipOf = (price: number) => (p.slippageBps / 10000) * Math.abs(price);
  const feeOf = (notional: number) => Math.abs(notional) * (p.feePercent / 100);

  const closeAt = (i: number, rawExit: number, reason: EngineTrade['reason']) => {
    if (!pos) return;
    const slip = slipOf(rawExit);
    const exit = pos.side === 'LONG' ? rawExit - slip : rawExit + slip;
    const dir = pos.side === 'LONG' ? 1 : -1;
    const gross = dir * (exit - pos.entry) * pos.qty;
    const costs = feeOf(pos.entry * pos.qty) + feeOf(exit * pos.qty);
    const net = gross - costs;

    balance += net; grossPnl += gross; totalCosts += costs;
    if (balance > peak) peak = balance;
    const dd = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;

    trades.push({
      side: pos.side, entryTime: bars[pos.entryIdx].time, exitTime: bars[i].time,
      entry: +pos.entry.toPrecision(8), exit: +exit.toPrecision(8), qty: pos.qty,
      pnl: net, r: pos.riskDollars > 0 ? net / pos.riskDollars : 0, reason,
    });
    pos = null;
  };

  const start = Math.max(strat.warmup, p.atrPeriod + 1);

  for (let i = start; i < bars.length; i++) {
    const b = bars[i];

    // ---- manage an open position first (stop before target: pessimistic) ----
    if (pos) {
      if (pos.side === 'LONG') {
        if (b.low <= pos.stop) { closeAt(i, pos.stop, 'SL'); }
        else if (pos.target !== null && b.high >= pos.target) { closeAt(i, pos.target, 'TP'); }
      } else {
        if (b.high >= pos.stop) { closeAt(i, pos.stop, 'SL'); }
        else if (pos.target !== null && b.low <= pos.target) { closeAt(i, pos.target, 'TP'); }
      }
      if (pos && p.maxHoldBars && i - pos.entryIdx >= p.maxHoldBars) closeAt(i, b.close, 'TIME');
    }

    const want = strat.signal(i, ctx);

    // ---- exit on an opposing signal ----
    if (pos && (strat.exitOnFlip ?? true) && want && want !== pos.side) {
      closeAt(i, b.close, 'FLIP');
    }

    // ---- entry ----
    if (!pos && want) {
      const a = atr[i];
      if (!Number.isFinite(a) || a <= 0) continue;
      const stopDist = a * p.atrMultiplierSL;
      if (!(stopDist > 0)) continue;

      const slip = slipOf(b.close);
      const entry = want === 'LONG' ? b.close + slip : b.close - slip;
      if (!(entry > 0)) continue;   // guards against nonsense on odd price scales

      const riskDollars = balance * (p.riskPercent / 100);
      let qty = riskDollars / stopDist;
      const maxQty = (balance * p.maxLeverage) / entry;     // notional cap, scale-invariant
      qty = Math.min(qty, maxQty);
      if (!(qty > 0) || !Number.isFinite(qty)) continue;

      pos = {
        side: want, entry, qty, entryIdx: i,
        stop: want === 'LONG' ? entry - stopDist : entry + stopDist,
        target: strat.targetR ? (want === 'LONG' ? entry + stopDist * strat.targetR : entry - stopDist * strat.targetR) : null,
        riskDollars: stopDist * qty,
      };
    }
  }

  if (pos) closeAt(bars.length - 1, bars[bars.length - 1].close, 'END');

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0);
  const gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const n = trades.length;

  return {
    totalTrades: n,
    winRate: n ? (wins.length / n) * 100 : 0,
    profitFactor: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0),
    expectancy: n ? trades.reduce((s, t) => s + t.pnl, 0) / n : 0,
    expectancyR: n ? trades.reduce((s, t) => s + t.r, 0) / n : 0,
    netPnl: +(balance - p.initialBalance).toFixed(2),
    grossPnl: +grossPnl.toFixed(2),
    totalCosts: +totalCosts.toFixed(2),
    maxDrawdownPercent: +maxDd.toFixed(2),
    finalBalance: +balance.toFixed(2),
    trades,
  };
}
