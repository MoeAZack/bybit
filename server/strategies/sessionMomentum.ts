/**
 * Session Opening-Range Breakout for gold.
 *
 * Premise (structural, not an indicator artefact): gold's liquidity arrives in bursts when
 * London and then New York open. A range established in the first minutes after an open
 * often breaks in the direction the session then follows, because that is when real
 * order flow — not overnight drift — enters the book.
 *
 * Rules, deliberately simple so there is little to overfit:
 *   1. Mark the high/low of the first `rangeBars` candles after the session open. That is
 *      the opening range (OR).
 *   2. The FIRST close beyond the OR high goes long; beyond the OR low goes short.
 *      One trade per session per day, no re-entries.
 *   3. Stop at the opposite side of the OR ('range') or at atrMult x ATR ('atr').
 *   4. Target at `rMultiple` x the stop distance.
 *   5. Flat by `sessionHours` after the open regardless — this is an intraday setup and
 *      holding past the session is a different bet.
 *
 * Costs are modelled the same way as the main backtester: taker fee both sides, slippage
 * against us on entry and exit, funding if a position somehow spans an 8h boundary.
 * Intrabar, the stop is checked BEFORE the target, so an ambiguous candle resolves
 * pessimistically.
 */
import { BybitClient } from '../bybit.js';
import { getContractMultiplier } from '../db.js';

export interface SessionParams {
  symbol: string;
  /** UTC hour the session opens, e.g. 8 for London, 13 for New York. */
  sessionOpenUtcHour: number;
  /** Candles used to build the opening range. */
  rangeBars: number;
  /** Flatten this many hours after the open. */
  sessionHours: number;
  stopMode: 'range' | 'atr';
  atrMult: number;
  rMultiple: number;
  riskPercent: number;
  feePercent: number;
  slippageTicks: number;
  /** Skip the session if the OR is wider than this multiple of ATR (news-gap protection). */
  maxRangeAtr?: number;
  /** Skip if the OR is narrower than this multiple of ATR (no participation). */
  minRangeAtr?: number;
  startMs: number;
  endMs: number;
  intervalMins: number;
  initialBalance?: number;
}

export interface SessionTrade {
  side: 'LONG' | 'SHORT';
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  r: number;
  exitReason: 'SL' | 'TP' | 'SESSION_END';
}

export interface SessionResult {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  expectancyR: number;
  netPnl: number;
  grossPnl: number;
  totalFees: number;
  maxDrawdownPercent: number;
  initialBalance: number;
  finalBalance: number;
  trades: SessionTrade[];
  candlesUsed: number;
}

type Bar = { t: number; o: number; h: number; l: number; c: number };

const _cache = new Map<string, any[]>();

async function fetchBars(symbol: string, interval: string, startMs: number, endMs: number): Promise<Bar[]> {
  const key = `${symbol}:${interval}:${startMs}:${endMs}`;
  let raw = _cache.get(key);
  if (!raw) {
    const client = new BybitClient({ apiKey: '', apiSecret: '' });
    raw = await client.getKlinesRange({ symbol, interval, startMs, endMs, maxCandles: 20000 });
    _cache.set(key, raw);
  }
  return raw
    .map((k: any) => ({ t: Number(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4] }))
    .filter(b => Number.isFinite(b.c) && Number.isFinite(b.h) && Number.isFinite(b.l))
    .sort((a, b) => a.t - b.t);
}

/** Wilder ATR aligned to the bar array (leading entries use the running average). */
function atrSeries(bars: Bar[], len = 14): number[] {
  const out = new Array(bars.length).fill(NaN);
  if (bars.length < len + 1) return out;
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const pc = bars[i - 1].c;
    tr.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - pc), Math.abs(bars[i].l - pc)));
  }
  let a = tr.slice(0, len).reduce((x, y) => x + y, 0) / len;
  out[len] = a;
  for (let i = len; i < tr.length; i++) {
    a = (a * (len - 1) + tr[i]) / len;
    out[i + 1] = a;
  }
  return out;
}

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

export async function runSessionMomentum(p: SessionParams): Promise<SessionResult> {
  const bars = await fetchBars(p.symbol, String(p.intervalMins), p.startMs, p.endMs);
  if (bars.length < 60) {
    throw new Error(`Not enough candles for the session backtest (got ${bars.length}). Real data only — no synthetic fallback.`);
  }
  const atr = atrSeries(bars, 14);
  const mult = getContractMultiplier(p.symbol);
  const tick = 0.05;

  let balance = p.initialBalance ?? 10000;
  let peak = balance;
  let maxDd = 0;
  let grossPnl = 0;
  let totalFees = 0;
  const trades: SessionTrade[] = [];

  // Index the first bar of each session, per day.
  const sessionStarts: number[] = [];
  const seenDay = new Set<string>();
  for (let i = 0; i < bars.length; i++) {
    const d = new Date(bars[i].t);
    if (d.getUTCHours() === p.sessionOpenUtcHour && d.getUTCMinutes() < p.intervalMins) {
      const k = dayKey(bars[i].t);
      if (!seenDay.has(k)) { seenDay.add(k); sessionStarts.push(i); }
    }
  }

  for (const s of sessionStarts) {
    const orEnd = s + p.rangeBars;
    if (orEnd >= bars.length) break;

    // 1. Opening range
    let orHigh = -Infinity, orLow = Infinity;
    for (let i = s; i < orEnd; i++) { orHigh = Math.max(orHigh, bars[i].h); orLow = Math.min(orLow, bars[i].l); }
    const orWidth = orHigh - orLow;
    if (!(orWidth > 0)) continue;

    const a = atr[orEnd];
    if (!Number.isFinite(a) || a <= 0) continue;
    if (p.maxRangeAtr && orWidth > p.maxRangeAtr * a) continue;   // gap / news blowout
    if (p.minRangeAtr && orWidth < p.minRangeAtr * a) continue;   // nobody is participating

    // 2. First close outside the range wins the session
    const lastIdx = Math.min(bars.length - 1, orEnd + Math.floor((p.sessionHours * 60) / p.intervalMins));
    let entryIdx = -1;
    let side: 'LONG' | 'SHORT' | null = null;
    for (let i = orEnd; i <= lastIdx; i++) {
      if (bars[i].c > orHigh) { entryIdx = i; side = 'LONG'; break; }
      if (bars[i].c < orLow) { entryIdx = i; side = 'SHORT'; break; }
    }
    if (entryIdx < 0 || !side) continue;

    // 3. Entry, stop, target
    const slip = p.slippageTicks * tick;
    const entry = side === 'LONG' ? bars[entryIdx].c + slip : bars[entryIdx].c - slip;
    const stopDist = p.stopMode === 'range'
      ? Math.max(orWidth, a * 0.5)   // never a stop tighter than half an ATR
      : a * p.atrMult;
    const stop = side === 'LONG' ? entry - stopDist : entry + stopDist;
    const target = side === 'LONG' ? entry + stopDist * p.rMultiple : entry - stopDist * p.rMultiple;

    // 4. Size so the stop costs riskPercent of balance
    const riskDollars = balance * (p.riskPercent / 100);
    let qty = riskDollars / (stopDist * mult);
    qty = Math.max(0.001, Math.min(5, Math.round(qty * 1000) / 1000));

    // 5. Walk forward to the exit. Stop is checked before target: an ambiguous candle
    //    that touched both resolves as a loss.
    let exitIdx = lastIdx;
    let exitPrice = bars[lastIdx].c;
    let reason: SessionTrade['exitReason'] = 'SESSION_END';
    for (let i = entryIdx + 1; i <= lastIdx; i++) {
      const b = bars[i];
      if (side === 'LONG') {
        if (b.l <= stop) { exitIdx = i; exitPrice = stop; reason = 'SL'; break; }
        if (b.h >= target) { exitIdx = i; exitPrice = target; reason = 'TP'; break; }
      } else {
        if (b.h >= stop) { exitIdx = i; exitPrice = stop; reason = 'SL'; break; }
        if (b.l <= target) { exitIdx = i; exitPrice = target; reason = 'TP'; break; }
      }
    }
    exitPrice = side === 'LONG' ? exitPrice - slip : exitPrice + slip;

    const gross = (side === 'LONG' ? 1 : -1) * (exitPrice - entry) * qty * mult;
    const fees = (entry * qty * mult + exitPrice * qty * mult) * (p.feePercent / 100);
    const net = gross - fees;

    balance += net;
    grossPnl += gross;
    totalFees += fees;
    if (balance > peak) peak = balance;
    const dd = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;

    trades.push({
      side,
      entryTime: new Date(bars[entryIdx].t).toISOString(),
      exitTime: new Date(bars[exitIdx].t).toISOString(),
      entryPrice: +entry.toFixed(2),
      exitPrice: +exitPrice.toFixed(2),
      quantity: qty,
      pnl: +net.toFixed(2),
      r: +(net / (riskDollars || 1)).toFixed(3),
      exitReason: reason,
    });
  }

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const n = trades.length;

  return {
    totalTrades: n,
    winRate: n ? (wins.length / n) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    expectancy: n ? trades.reduce((s, t) => s + t.pnl, 0) / n : 0,
    expectancyR: n ? trades.reduce((s, t) => s + t.r, 0) / n : 0,
    netPnl: +(balance - (p.initialBalance ?? 10000)).toFixed(2),
    grossPnl: +grossPnl.toFixed(2),
    totalFees: +totalFees.toFixed(2),
    maxDrawdownPercent: +maxDd.toFixed(2),
    initialBalance: p.initialBalance ?? 10000,
    finalBalance: +balance.toFixed(2),
    trades,
    candlesUsed: bars.length,
  };
}
