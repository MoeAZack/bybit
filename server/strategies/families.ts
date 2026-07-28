/**
 * Strategy families to test through the multi-instrument rig.
 *
 * Chosen to be genuinely DIFFERENT in mechanism, not variations on one idea. EMA-cross has
 * been tested exhaustively and is dead; repeating it with new numbers would only be
 * data-mining. Each of these has a distinct economic rationale:
 *
 *   Time-series momentum  — the most replicated anomaly in futures (Moskowitz/Ooi/Pedersen
 *                           2012). Buy what has gone up over the past year. Included because
 *                           if ANYTHING works on a futures basket, published evidence says
 *                           it is this.
 *   Donchian breakout     — the classic managed-futures/"Turtle" rule. Same trend premise,
 *                           different trigger: price makes a new N-day extreme.
 *   Bollinger fade        — mean reversion. The opposite bet to the two above, so it is a
 *                           real test of direction rather than of parameters.
 *   RSI reversion         — mean reversion with a different oscillator, as a robustness
 *                           check on the Bollinger result.
 *   MA cross (CONTROL)    — the known-negative strategy. Its job is to reproduce the result
 *                           the old engine gave. If the control comes out positive here,
 *                           the new engine is wrong, not the strategy.
 */
import { Strategy, StrategyCtx, Side } from './engine.js';

const ema = (src: number[], len: number): number[] => {
  const out = new Array(src.length).fill(NaN);
  if (src.length < len) return out;
  const k = 2 / (len + 1);
  let e = src.slice(0, len).reduce((a, b) => a + b, 0) / len;
  out[len - 1] = e;
  for (let i = len; i < src.length; i++) { e = src[i] * k + e * (1 - k); out[i] = e; }
  return out;
};

const sma = (src: number[], len: number, i: number): number => {
  if (i < len - 1) return NaN;
  let s = 0; for (let j = i - len + 1; j <= i; j++) s += src[j];
  return s / len;
};

const stdev = (src: number[], len: number, i: number): number => {
  if (i < len - 1) return NaN;
  const m = sma(src, len, i);
  let s = 0; for (let j = i - len + 1; j <= i; j++) s += (src[j] - m) ** 2;
  return Math.sqrt(s / len);
};

const rsiSeries = (src: number[], len: number): number[] => {
  const out = new Array(src.length).fill(NaN);
  if (src.length < len + 1) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= len; i++) { const d = src[i] - src[i - 1]; if (d >= 0) g += d; else l -= d; }
  let ag = g / len, al = l / len;
  out[len] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = len + 1; i < src.length; i++) {
    const d = src[i] - src[i - 1];
    ag = (ag * (len - 1) + (d > 0 ? d : 0)) / len;
    al = (al * (len - 1) + (d < 0 ? -d : 0)) / len;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
};

/** Memoise per-series derived arrays so a sweep does not recompute them per bar. */
function memo<T>(fn: (ctx: StrategyCtx) => T) {
  const cache = new WeakMap<StrategyCtx, T>();
  return (ctx: StrategyCtx): T => {
    let v = cache.get(ctx);
    if (v === undefined) { v = fn(ctx); cache.set(ctx, v); }
    return v;
  };
}

/** Time-series momentum: hold long while the trailing N-bar return is positive. */
export function tsMomentum(lookback: number, targetR?: number): Strategy {
  return {
    name: `TSMOM-${lookback}`, family: 'momentum', warmup: lookback + 1, targetR,
    signal(i, ctx): Side {
      const past = ctx.close[i - lookback];
      if (!Number.isFinite(past) || past <= 0) return null;
      return ctx.close[i] > past ? 'LONG' : 'SHORT';
    },
  };
}

/** Donchian breakout: new N-bar extreme, measured EXCLUDING the current bar. */
export function donchian(lookback: number, targetR?: number): Strategy {
  return {
    name: `DONCH-${lookback}`, family: 'breakout', warmup: lookback + 1, targetR,
    signal(i, ctx): Side {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - lookback; j < i; j++) { // strictly prior bars — no look-ahead
        if (ctx.high[j] > hh) hh = ctx.high[j];
        if (ctx.low[j] < ll) ll = ctx.low[j];
      }
      if (ctx.close[i] > hh) return 'LONG';
      if (ctx.close[i] < ll) return 'SHORT';
      return null;
    },
  };
}

/** Bollinger fade: buy the lower band, sell the upper. Mean reversion. */
export function bollingerFade(period: number, k: number, targetR = 1.5): Strategy {
  return {
    name: `BBFADE-${period}x${k}`, family: 'reversion', warmup: period + 1, targetR,
    exitOnFlip: false,   // reversion exits at its target/stop, not on an opposing signal
    signal(i, ctx): Side {
      const m = sma(ctx.close, period, i), sd = stdev(ctx.close, period, i);
      if (!Number.isFinite(m) || !Number.isFinite(sd) || sd <= 0) return null;
      if (ctx.close[i] < m - k * sd) return 'LONG';
      if (ctx.close[i] > m + k * sd) return 'SHORT';
      return null;
    },
  };
}

/** RSI reversion: buy oversold, sell overbought. */
export function rsiReversion(period: number, lo: number, hi: number, targetR = 1.5): Strategy {
  const get = memo((ctx: StrategyCtx) => rsiSeries(ctx.close, period));
  return {
    name: `RSIREV-${period}/${lo}-${hi}`, family: 'reversion', warmup: period + 2, targetR,
    exitOnFlip: false,
    signal(i, ctx): Side {
      const r = get(ctx)[i];
      if (!Number.isFinite(r)) return null;
      if (r < lo) return 'LONG';
      if (r > hi) return 'SHORT';
      return null;
    },
  };
}

/** CONTROL: the EMA cross already shown to have no edge. Validates the engine. */
export function maCross(fast: number, slow: number, targetR?: number): Strategy {
  const get = memo((ctx: StrategyCtx) => ({ f: ema(ctx.close, fast), s: ema(ctx.close, slow) }));
  return {
    name: `MACROSS-${fast}/${slow}`, family: 'control', warmup: slow + 2, targetR,
    signal(i, ctx): Side {
      const { f, s } = get(ctx);
      if (!Number.isFinite(f[i]) || !Number.isFinite(s[i])) return null;
      return f[i] > s[i] ? 'LONG' : 'SHORT';
    },
  };
}


/**
 * TRUE CONTROL — replicates the legacy Backtester's EMA strategy exactly:
 *   - fires ONLY on the cross bar (a discrete event, not a persistent state)
 *   - applies the RSI filter (long needs rsi < overbought, short needs rsi > oversold)
 *   - never exits on an opposing signal; only SL/TP close the trade
 *
 * The first control I wrote returned LONG whenever fast > slow, which is a permanently
 * in-market stop-and-reverse system — a genuinely different strategy that merely shared a
 * name. It "disagreed" with the legacy engine because it was not the same rules, not
 * because either engine was broken. This one is the real comparison.
 */
export function maCrossDiscrete(fast: number, slow: number, rsiPeriod: number, rsiOB: number, rsiOS: number, targetR: number): Strategy {
  const get = memo((ctx: StrategyCtx) => ({
    f: ema(ctx.close, fast), s: ema(ctx.close, slow), r: rsiSeries(ctx.close, rsiPeriod),
  }));
  return {
    name: `MACROSS-DISC-${fast}/${slow}`, family: 'control', warmup: slow + 2, targetR,
    exitOnFlip: false,
    signal(i, ctx): Side {
      const { f, s, r } = get(ctx);
      if (i < 1) return null;
      if (![f[i], s[i], f[i - 1], s[i - 1], r[i]].every(Number.isFinite)) return null;
      const golden = f[i - 1] <= s[i - 1] && f[i] > s[i];
      const death = f[i - 1] >= s[i - 1] && f[i] < s[i];
      if (golden && r[i] < rsiOB) return 'LONG';
      if (death && r[i] > rsiOS) return 'SHORT';
      return null;   // no signal on non-cross bars
    },
  };
}

export const FAMILY_SUITE: Strategy[] = [
  tsMomentum(252),              // ~12 months, the classic TSMOM horizon
  tsMomentum(126),              // ~6 months
  donchian(55, 6),              // Turtle long-term
  donchian(20, 4),              // Turtle short-term
  bollingerFade(20, 2.0),
  bollingerFade(20, 2.5),
  rsiReversion(14, 30, 70),
  rsiReversion(2, 10, 90),      // Connors-style short-horizon reversion
  maCross(12, 26, 5),                       // always-in-market variant (NOT the legacy rules)
  // TRUE control. targetR is 2.5, NOT 5: the legacy engine sets the target as
  // ATR*atrMultiplierTP (5*ATR) against a stop of ATR*atrMultiplierSL (2*ATR), i.e. 2.5R.
  // This engine measures the target in R directly, so passing 5 would double the target
  // distance and is not the same strategy.
  maCrossDiscrete(12, 26, 14, 70, 30, 2.5),
];
