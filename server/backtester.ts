import { ClosedTrade, getContractMultiplier } from './db.js';
import { BybitClient } from './bybit.js';
import { calculateBollingerBands, calculateSessionVWAP } from './indicators.js';
import { isWithinTier1Blackout } from './newsCalendar.js';

// Raw-kline cache. A single backtest fetches months of history (~40 paginated calls); an
// optimizer sweep runs dozens of backtests over the SAME window, so without caching it
// re-fetches identical data every time. Keyed by symbol+interval+window, short TTL because
// only the most recent candle changes within a window.
const _klineCache = new Map<string, { at: number; klines: any[] }>();
const KLINE_CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchKlinesCached(client: BybitClient, symbol: string, interval: string, startMs: number, endMs: number): Promise<any[]> {
  const key = `${symbol}:${interval}:${startMs}:${endMs}`;
  const hit = _klineCache.get(key);
  if (hit && Date.now() - hit.at < KLINE_CACHE_TTL_MS) return hit.klines;
  const klines = await client.getKlinesRange({ symbol, interval, startMs, endMs, maxCandles: 20000 });
  _klineCache.set(key, { at: Date.now(), klines });
  return klines;
}

function calculateEMA(prices: number[], period: number): number[] {
  const ema: number[] = [];
  if (prices.length === 0) return ema;
  const k = 2 / (period + 1);
  let currentEma = prices[0];
  ema.push(currentEma);
  for (let i = 1; i < prices.length; i++) {
    currentEma = prices[i] * k + currentEma * (1 - k);
    ema.push(currentEma);
  }
  return ema;
}

function calculateRSI(prices: number[], period: number): number[] {
  const rsi: number[] = [];
  if (prices.length < 2) {
    return new Array(prices.length).fill(50);
  }
  let gains = 0;
  let losses = 0;

  const initialPeriod = Math.min(period, prices.length - 1);
  for (let i = 1; i <= initialPeriod; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / (initialPeriod || 1);
  let avgLoss = losses / (initialPeriod || 1);
  
  for (let i = 0; i <= initialPeriod; i++) {
    rsi.push(50);
  }

  for (let i = initialPeriod + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    let gain = diff > 0 ? diff : 0;
    let loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss > 0 ? avgGain / avgLoss : 0;
    const rsiVal = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
    rsi.push(rsiVal);
  }
  
  while (rsi.length < prices.length) {
    rsi.push(50);
  }
  return rsi;
}

function calculateATR(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const atr: number[] = [];
  if (highs.length === 0) return atr;
  
  const tr: number[] = [highs[0] - lows[0]];
  for (let i = 1; i < highs.length; i++) {
    const tr1 = highs[i] - lows[i];
    const tr2 = Math.abs(highs[i] - closes[i - 1]);
    const tr3 = Math.abs(lows[i] - closes[i - 1]);
    tr.push(Math.max(tr1, tr2, tr3));
  }

  let currentAtr = tr[0];
  atr.push(currentAtr);
  
  for (let i = 1; i < tr.length; i++) {
    currentAtr = (currentAtr * (period - 1) + tr[i]) / period;
    atr.push(currentAtr);
  }
  return atr;
}

function calculateADXArray(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const adxArray: number[] = new Array(highs.length).fill(22);
  if (highs.length < period * 2) {
    return adxArray;
  }

  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const curHigh = highs[i];
    const curLow = lows[i];
    const prevClose = closes[i - 1];
    const prevHigh = highs[i - 1];
    const prevLow = lows[i - 1];

    const tr1 = curHigh - curLow;
    const tr2 = Math.abs(curHigh - prevClose);
    const tr3 = Math.abs(curLow - prevClose);
    tr.push(Math.max(tr1, tr2, tr3));

    const upMove = curHigh - prevHigh;
    const downMove = prevLow - curLow;

    let dmPlus = 0;
    let dmMinus = 0;

    if (upMove > downMove && upMove > 0) {
      dmPlus = upMove;
    }
    if (downMove > upMove && downMove > 0) {
      dmMinus = downMove;
    }

    plusDM.push(dmPlus);
    minusDM.push(dmMinus);
  }

  let smoothedTR = 0;
  let smoothedPlusDM = 0;
  let smoothedMinusDM = 0;

  for (let i = 0; i < period; i++) {
    smoothedTR += tr[i];
    smoothedPlusDM += plusDM[i];
    smoothedMinusDM += minusDM[i];
  }

  const dxValues: number[] = new Array(period).fill(0);

  for (let i = period; i < tr.length; i++) {
    smoothedTR = smoothedTR - (smoothedTR / period) + tr[i];
    smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + plusDM[i];
    smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + minusDM[i];

    const plusDI = smoothedTR > 0 ? (smoothedPlusDM / smoothedTR) * 100 : 0;
    const minusDI = smoothedTR > 0 ? (smoothedMinusDM / smoothedTR) * 100 : 0;

    const diDiff = Math.abs(plusDI - minusDI);
    const diSum = plusDI + minusDI;
    const dx = diSum > 0 ? (diDiff / diSum) * 100 : 0;
    dxValues.push(dx);
  }

  let adx = 0;
  for (let i = 0; i < period; i++) {
    adx += dxValues[i];
  }
  adx = adx / period;
  adxArray[period] = adx;

  for (let i = period; i < dxValues.length; i++) {
    adx = ((adx * (period - 1)) + dxValues[i]) / period;
    if (i + 1 < adxArray.length) {
      adxArray[i + 1] = adx;
    }
  }

  return adxArray;
}

export interface BacktestResult {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  initialBalance: number;
  finalBalance: number;
  totalPnL: number;
  maxDrawdownPercent: number;
  kellyCriterion: number; // Kelly %
  expectancy: number; // average PnL per trade
  expectancyR: number; // expectancy in R units (average reward relative to initial SL risk)
  marRatio: number; // Annualized CAGR / maxDrawdown
  totalFeesPaid: number;
  totalSlippagePaid: number;
  rejectedTradesCount: number;
  monteCarloMaxDrawdown95: number;
  rollingExpectancyAlert: boolean; // edge decay warning
  trades: {
    id: string;
    type: 'LONG' | 'SHORT';
    entryPrice: number;
    exitPrice: number;
    entryTime: string;
    exitTime: string;
    pnl: number;
    fees: number;
    slippage: number;
    durationMins: number;
    result: 'PROFIT' | 'LOSS';
    riskAmountR: number; // pnl divided by initial dollar risk
    exitReason: string; // 'SL' | 'TP' | 'TIME_STOP' | 'PARTIAL_TP' | 'BLACKOUT_FLATTEN'
  }[];
  dailyCurve: {
    date: string;
    balance: number;
  }[];
}

export interface StrategyParams {
  fastEma: number;
  slowEma: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  atrPeriod: number;
  atrMultiplierSL: number;
  atrMultiplierTP: number;
  feePercent: number; // e.g. 0.055 for 0.055%
  slippageTicks: number; // e.g. 1 tick = $0.05
  walkForward: 'none' | 'fit_jan_mar' | 'val_apr_jun';
  // Upgraded parameters
  isRegimeFilterActive?: boolean;
  adxThreshold?: number;
  isVolatilitySizingActive?: boolean;
  riskPercent?: number;
  isEquityThrottleActive?: boolean;
  isEventBlackoutActive?: boolean;
  orderType?: 'MARKET' | 'LIMIT_POST_ONLY';
  isPartialTPActive?: boolean;
  isTimeStopActive?: boolean;
  timeStopBars?: number;
  symbol?: string;
  // Mean Reversion parameters
  backtestModule?: 'trend' | 'reversion';
  reversionRiskUsd?: number;
  reversionMaxRungs?: number;
  reversionRungSpacingAtr?: number;
  reversionStopBeyondLastRungAtr?: number;
}

// Generates highly realistic XAUUSDT price series with simulated indicators including ADX

export class Backtester {
  public static calculateADX(highs: number[], lows: number[], closes: number[], period: number = 14): number {
    const arr = calculateADXArray(highs, lows, closes, period);
    return arr[arr.length - 1];
  }

  public static async run(params: StrategyParams): Promise<BacktestResult> {
    // Determine backtest time window
    let startDate = new Date('2026-01-01T00:00:00Z');
    let endDate = new Date('2026-06-30T23:59:59Z');

    if (params.walkForward === 'fit_jan_mar') {
      startDate = new Date('2026-01-01T00:00:00Z');
      endDate = new Date('2026-03-31T23:59:59Z');
    } else if (params.walkForward === 'val_apr_jun') {
      startDate = new Date('2026-04-01T00:00:00Z');
      endDate = new Date('2026-06-30T23:59:59Z');
    }

    const timeframeMins = 15; // standard TrendForge 15-minute chart
    let klines: {
      time: Date;
      open: number;
      high: number;
      low: number;
      close: number;
      rsi: number;
      atr: number;
      emaFast: number;
      emaSlow: number;
      adx: number;
    }[] = [];

    let fetchedReal = false;
    try {
      const client = new BybitClient({ apiKey: '', apiSecret: '' });
      const symbol = params.symbol || 'XAUUSDT';
      // Fetch the actual walk-forward window (paginated), cached so sweeps reuse the data.
      const rawKlines = await fetchKlinesCached(client, symbol, '15', startDate.getTime(), endDate.getTime());

      if (rawKlines && rawKlines.length > 28) {
        // getKlinesRange already returns chronological ascending order.
        const chronologicalKlines = rawKlines;
        const highs = chronologicalKlines.map(k => parseFloat(k[2]));
        const lows = chronologicalKlines.map(k => parseFloat(k[3]));
        const closes = chronologicalKlines.map(k => parseFloat(k[4]));

        const emaFastArray = calculateEMA(closes, params.fastEma);
        const emaSlowArray = calculateEMA(closes, params.slowEma);
        const rsiArray = calculateRSI(closes, params.rsiPeriod);
        const atrArray = calculateATR(highs, lows, closes, params.atrPeriod);
        const adxArray = calculateADXArray(highs, lows, closes, 14);

        for (let i = 0; i < chronologicalKlines.length; i++) {
          const k = chronologicalKlines[i];
          klines.push({
            time: new Date(Number(k[0])),
            open: parseFloat(k[1]),
            high: highs[i],
            low: lows[i],
            close: closes[i],
            rsi: rsiArray[i] || 50,
            atr: atrArray[i] || 3.5,
            emaFast: emaFastArray[i] || closes[i],
            emaSlow: emaSlowArray[i] || closes[i],
            adx: adxArray[i] || 22,
          });
        }
        fetchedReal = true;
        console.log(`[Backtester] Successfully ran backtest using ${klines.length} real market candles.`);
      }
    } catch (err: any) {
      console.warn(`[Backtester] Failed to run with real candles: ${err.message || err}`);
    }

    if (!fetchedReal) {
      throw new Error(`[Backtester Error] Historical candle data could not be retrieved from the Bybit public API. To ensure measurement honesty, synthetic fallback simulation is disabled.`);
    }

    if (params.backtestModule === 'reversion') {
      return await Backtester.runReversionBacktest(params, klines);
    }

    let balance = 10000.0;
    const initialBalance = balance;
    let maxBalance = balance;
    let maxDrawdown = 0;

    const trades: BacktestResult['trades'] = [];
    let currentPosition: {
      type: 'LONG' | 'SHORT';
      entryPrice: number;
      entryTime: Date;
      stopLoss: number;
      takeProfit: number;
      quantity: number;
      initialQty: number;
      initialRiskPriceDiff: number;
      isPartialHit: boolean;
      barsHeld: number;
    } | null = null;

    let consecutiveLosses = 0;
    let maxConsecutiveLosses = 0;
    let rejectedTradesCount = 0;
    let totalFeesPaid = 0;
    let totalSlippagePaid = 0;

    // Track daily balance growth for plotting
    const dailyBalanceMap: { [dateStr: string]: number } = {};

    // Dynamic daily halt variables
    let lastDateStr = '';
    let startOfDayBalance = balance;
    let dailyLossThisDay = 0;
    let coolingOffUntil: Date | null = null;

    for (let i = 1; i < klines.length; i++) {
      const prev = klines[i - 1];
      const curr = klines[i];
      const dateStr = curr.time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      
      // Seed default daily balances
      if (!dailyBalanceMap[dateStr]) {
        dailyBalanceMap[dateStr] = balance;
      }

      // Check calendar day change for daily loss limit reset
      const currentDateString = curr.time.toDateString();
      if (currentDateString !== lastDateStr) {
        startOfDayBalance = balance;
        dailyLossThisDay = 0;
        lastDateStr = currentDateString;
      }

      // Check event blackout using the robust DST-aware calendar and widened ±30 min window
      const isNewsBlackoutActive = params.isEventBlackoutActive && isWithinTier1Blackout(curr.time).active;

      // 1. Blackout News Flattening Upgrade
      if (isNewsBlackoutActive && currentPosition) {
        // Force-flatten at market to avoid high slippage
        const exitPrice = curr.close;
        const pos = currentPosition;
        
        const sideMultiplier = pos.type === 'LONG' ? 1 : -1;
        const mult = getContractMultiplier(params.symbol);
        const grossPnL = sideMultiplier * (exitPrice - pos.entryPrice) * pos.quantity * mult;
        
        const entryValue = pos.entryPrice * pos.quantity * mult;
        const exitValue = exitPrice * pos.quantity * mult;
        const effectiveFeePercent = params.feePercent / 100;
        const totalFees = (entryValue + exitValue) * effectiveFeePercent;
        
        const finalPnL = grossPnL - totalFees;
        balance += finalPnL;
        totalFeesPaid += totalFees;

        if (finalPnL < 0) {
          dailyLossThisDay += Math.abs(finalPnL);
        }

        if (balance > maxBalance) maxBalance = balance;
        const dd = ((maxBalance - balance) / maxBalance) * 100;
        if (dd > maxDrawdown) maxDrawdown = dd;

        const initialDollarRisk = pos.initialRiskPriceDiff * pos.initialQty * getContractMultiplier(params.symbol);
        const riskAmountR = initialDollarRisk > 0 ? (finalPnL / initialDollarRisk) : 0;

        trades.push({
          id: 'backtest-' + Math.random().toString(36).substr(2, 9),
          type: pos.type,
          entryPrice: pos.entryPrice,
          exitPrice,
          entryTime: pos.entryTime.toISOString(),
          exitTime: curr.time.toISOString(),
          pnl: finalPnL,
          fees: totalFees,
          slippage: 0,
          durationMins: Math.floor((curr.time.getTime() - pos.entryTime.getTime()) / 60000),
          result: finalPnL > 0 ? 'PROFIT' : 'LOSS',
          riskAmountR,
          exitReason: 'BLACKOUT_FLATTEN',
        });

        currentPosition = null;
      }

      // Check current open position targets
      if (currentPosition) {
        let closed = false;
        let exitPrice = 0;
        let closeReason: 'SL' | 'TP' | 'TIME_STOP' | 'PARTIAL_TP' = 'SL';

        const pos = currentPosition;
        pos.barsHeld++;

        // Partial Take Profit at 1.0R logic
        if (params.isPartialTPActive && !pos.isPartialHit) {
          let partialHit = false;
          if (pos.type === 'LONG' && curr.high >= pos.entryPrice + pos.initialRiskPriceDiff) {
            partialHit = true;
            exitPrice = pos.entryPrice + pos.initialRiskPriceDiff;
          } else if (pos.type === 'SHORT' && curr.low <= pos.entryPrice - pos.initialRiskPriceDiff) {
            partialHit = true;
            exitPrice = pos.entryPrice - pos.initialRiskPriceDiff;
          }

          if (partialHit) {
            // Close half position
            const partialQty = pos.quantity * 0.5;
            const sideMultiplier = pos.type === 'LONG' ? 1 : -1;
            const mult = getContractMultiplier(params.symbol);
            const grossPnL = sideMultiplier * (exitPrice - pos.entryPrice) * partialQty * mult;
            const entryValue = pos.entryPrice * partialQty * mult;
            const exitValue = exitPrice * partialQty * mult;
            const effectiveFeePercent = params.feePercent / 100;
            const totalFees = (entryValue + exitValue) * effectiveFeePercent;
            
            const finalPnL = grossPnL - totalFees;
            balance += finalPnL;
            totalFeesPaid += totalFees;

            if (finalPnL < 0) {
              dailyLossThisDay += Math.abs(finalPnL);
            }

            if (balance > maxBalance) maxBalance = balance;
            const dd = ((maxBalance - balance) / maxBalance) * 100;
            if (dd > maxDrawdown) maxDrawdown = dd;

            const initialDollarRisk = pos.initialRiskPriceDiff * pos.initialQty * getContractMultiplier(params.symbol);
            const riskAmountR = initialDollarRisk > 0 ? (finalPnL / initialDollarRisk) : 0;

            trades.push({
              id: 'backtest-' + Math.random().toString(36).substr(2, 9),
              type: pos.type,
              entryPrice: pos.entryPrice,
              exitPrice,
              entryTime: pos.entryTime.toISOString(),
              exitTime: curr.time.toISOString(),
              pnl: finalPnL,
              fees: totalFees,
              slippage: 0,
              durationMins: Math.floor((curr.time.getTime() - pos.entryTime.getTime()) / 60000),
              result: finalPnL > 0 ? 'PROFIT' : 'LOSS',
              riskAmountR,
              exitReason: 'PARTIAL_TP',
            });

            // Adjust state for remaining 50%
            pos.quantity = partialQty;
            pos.stopLoss = pos.entryPrice; // move rest to breakeven
            pos.isPartialHit = true;
          }
        }

        // Time Stop trigger
        if (params.isTimeStopActive && pos.barsHeld >= (params.timeStopBars || 20)) {
          closed = true;
          exitPrice = curr.close;
          closeReason = 'TIME_STOP';
        }

        // Standard exit check
        if (!closed) {
          if (pos.type === 'LONG') {
            if (curr.low <= pos.stopLoss) {
              closed = true;
              exitPrice = pos.stopLoss;
              closeReason = 'SL';
            } else if (curr.high >= pos.takeProfit) {
              closed = true;
              exitPrice = pos.takeProfit;
              closeReason = 'TP';
            }
          } else {
            if (curr.high >= pos.stopLoss) {
              closed = true;
              exitPrice = pos.stopLoss;
              closeReason = 'SL';
            } else if (curr.low <= pos.takeProfit) {
              closed = true;
              exitPrice = pos.takeProfit;
              closeReason = 'TP';
            }
          }
        }

        if (closed) {
          // Model slippage (only applies if closing via SL or TP market order)
          let slippageAmount = 0;
          if (closeReason === 'SL' || closeReason === 'TP' || params.orderType !== 'LIMIT_POST_ONLY') {
            slippageAmount = (params.slippageTicks * 0.05); // $0.05 per tick slippage
            if (pos.type === 'LONG') {
              exitPrice -= slippageAmount;
            } else {
              exitPrice += slippageAmount;
            }
            totalSlippagePaid += slippageAmount;
          }

          // Compute gross PnL
          const sideMultiplier = pos.type === 'LONG' ? 1 : -1;
          const priceDiff = exitPrice - pos.entryPrice;
          const mult = getContractMultiplier(params.symbol);
          const grossPnL = sideMultiplier * priceDiff * pos.quantity * mult;

          // Fees modeling (Maker vs Taker)
          const entryValue = pos.entryPrice * pos.quantity * mult;
          const exitValue = exitPrice * pos.quantity * mult;
          const rate = params.orderType === 'LIMIT_POST_ONLY' ? 0.02 : (params.feePercent / 100);
          const totalFees = (entryValue + exitValue) * rate;

          const finalPnL = grossPnL - totalFees;
          balance += finalPnL;
          totalFeesPaid += totalFees;

          if (finalPnL < 0) {
            dailyLossThisDay += Math.abs(finalPnL);
          }

          if (balance > maxBalance) {
            maxBalance = balance;
          }
          const dd = ((maxBalance - balance) / maxBalance) * 100;
          if (dd > maxDrawdown) {
            maxDrawdown = dd;
          }

          // Compute R multiplier relative to initial position setup
          const initialDollarRisk = pos.initialRiskPriceDiff * pos.initialQty * getContractMultiplier(params.symbol);
          const riskAmountR = initialDollarRisk > 0 ? (finalPnL / initialDollarRisk) : 0;

          trades.push({
            id: 'backtest-' + Math.random().toString(36).substr(2, 9),
            type: pos.type,
            entryPrice: pos.entryPrice,
            exitPrice,
            entryTime: pos.entryTime.toISOString(),
            exitTime: curr.time.toISOString(),
            pnl: finalPnL,
            fees: totalFees,
            slippage: slippageAmount,
            durationMins: Math.floor((curr.time.getTime() - pos.entryTime.getTime()) / 60000),
            result: finalPnL > 0 ? 'PROFIT' : 'LOSS',
            riskAmountR,
            exitReason: closeReason,
          });

          if (finalPnL < 0) {
            consecutiveLosses++;
            if (consecutiveLosses > maxConsecutiveLosses) {
              maxConsecutiveLosses = consecutiveLosses;
            }
          } else {
            consecutiveLosses = 0;
          }

          currentPosition = null;
        }
      }

      // Check entry conditions if no active position
      if (!currentPosition) {
        // Daily loss cap block check (2% of starting day balance)
        const isDailyLossLimitExceeded = params.isEquityThrottleActive && dailyLossThisDay >= (startOfDayBalance * 0.02);

        // 48h Cooling off period block check (if drawdown hit 6% or more)
        if (params.isEquityThrottleActive && maxDrawdown >= 6.0 && !coolingOffUntil) {
          coolingOffUntil = new Date(curr.time.getTime() + 48 * 60 * 60 * 1000);
        }

        const isCoolingOffActive = coolingOffUntil && curr.time < coolingOffUntil;
        if (coolingOffUntil && curr.time >= coolingOffUntil) {
          coolingOffUntil = null; // reset
        }

        // EMA Golden Cross and RSI triggers
        const isGoldenCross = prev.emaFast <= prev.emaSlow && curr.emaFast > curr.emaSlow;
        const isDeathCross = prev.emaFast >= prev.emaSlow && curr.emaFast < curr.emaSlow;

        if (isGoldenCross || isDeathCross) {
          // Check Regime Filter (ADX Filter)
          const isRegimeBlocked = params.isRegimeFilterActive && curr.adx < (params.adxThreshold || 22);

          if (isNewsBlackoutActive || isDailyLossLimitExceeded || isCoolingOffActive || isRegimeBlocked) {
            // Block trade entry
            rejectedTradesCount++;
          } else {
            // Limit order fill chance modeling (15% failed post-only fill chance)
            if (params.orderType === 'LIMIT_POST_ONLY' && Math.random() < 0.15) {
              rejectedTradesCount++;
            } else {
              // Volatility-Scaled Sizing logic: risk 1% of equity per trade
              const slDistance = curr.atr * params.atrMultiplierSL;
              const tpDistance = curr.atr * params.atrMultiplierTP;

              let quantity = 0.1; // Default
              if (params.isVolatilitySizingActive) {
                const targetRiskDollars = balance * ((params.riskPercent || 1.0) / 100);
                quantity = targetRiskDollars / (slDistance * 10);
                quantity = Math.max(0.01, Math.min(2.0, Math.round(quantity * 100) / 100));
              }

              // Apply equity curve throttle: cut size by 50% after 2 consecutive losses
              if (params.isEquityThrottleActive && consecutiveLosses >= 2) {
                quantity = Math.max(0.01, quantity * 0.5);
              }

              if (isGoldenCross && curr.rsi < params.rsiOverbought) {
                // Long
                let slippageAmount = (params.orderType !== 'LIMIT_POST_ONLY') ? (params.slippageTicks * 0.05) : 0;
                const entryPrice = curr.close + slippageAmount;
                totalSlippagePaid += slippageAmount;

                currentPosition = {
                  type: 'LONG',
                  entryPrice,
                  entryTime: curr.time,
                  stopLoss: entryPrice - slDistance,
                  takeProfit: entryPrice + tpDistance,
                  quantity,
                  initialQty: quantity,
                  initialRiskPriceDiff: slDistance,
                  isPartialHit: false,
                  barsHeld: 0,
                };
              } else if (isDeathCross && curr.rsi > params.rsiOversold) {
                // Short
                let slippageAmount = (params.orderType !== 'LIMIT_POST_ONLY') ? (params.slippageTicks * 0.05) : 0;
                const entryPrice = curr.close - slippageAmount;
                totalSlippagePaid += slippageAmount;

                currentPosition = {
                  type: 'SHORT',
                  entryPrice,
                  entryTime: curr.time,
                  stopLoss: entryPrice + slDistance,
                  takeProfit: entryPrice - tpDistance,
                  quantity,
                  initialQty: quantity,
                  initialRiskPriceDiff: slDistance,
                  isPartialHit: false,
                  barsHeld: 0,
                };
              }
            }
          }
        }
      }

      // Keep dailyBalanceMap updated
      dailyBalanceMap[dateStr] = balance;
    }

    // Wrap up statistics
    const totalTrades = trades.length;
    const winningTrades = trades.filter((t) => t.pnl > 0).length;
    const losingTrades = totalTrades - winningTrades;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    const totalProfit = trades.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
    const totalLoss = Math.abs(trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit;

    const expectancy = totalTrades > 0 ? (totalProfit - totalLoss) / totalTrades : 0;

    // Expectancy in R
    const rValues = trades.map(t => t.riskAmountR || 0);
    const expectancyR = rValues.length > 0 ? rValues.reduce((sum, r) => sum + r, 0) / rValues.length : 0;

    // CAGR & MAR ratio
    let years = 0.5; // default 6 months
    if (params.walkForward === 'fit_jan_mar' || params.walkForward === 'val_apr_jun') {
      years = 0.25;
    }
    const cagr = (Math.pow(balance / initialBalance, 1 / years) - 1) * 100;
    const marRatio = maxDrawdown > 0 ? (cagr / maxDrawdown) : 0;

    // Kelly Criterion % = W - [(1 - W) / R]
    const avgWin = winningTrades > 0 ? totalProfit / winningTrades : 0;
    const avgLoss = losingTrades > 0 ? totalLoss / losingTrades : 1;
    const winRatioR = avgLoss > 0 ? avgWin / avgLoss : 0;
    const w = winRate / 100;
    let kelly = 0;
    if (winRatioR > 0 && w > 0) {
      kelly = w - ((1 - w) / winRatioR);
      kelly = Math.max(0, kelly * 100);
    }

    // Monte Carlo sequence shuffling (1000 iterations to find 95th-percentile Max DD)
    let monteCarloMaxDrawdown95 = 0;
    if (trades.length > 0) {
      const pnlSequences: number[] = trades.map(t => t.pnl);
      const runsCount = 1000;
      const drawdowns: number[] = [];

      for (let run = 0; run < runsCount; run++) {
        // Shuffle sequence using Fisher-Yates
        const shuffled = [...pnlSequences];
        for (let idx = shuffled.length - 1; idx > 0; idx--) {
          const j = Math.floor(Math.random() * (idx + 1));
          const temp = shuffled[idx];
          shuffled[idx] = shuffled[j];
          shuffled[j] = temp;
        }

        // Simulate balance run
        let simBal = 10000.0;
        let simMaxBal = 10000.0;
        let simMaxDD = 0;
        for (const pnl of shuffled) {
          simBal += pnl;
          if (simBal > simMaxBal) {
            simMaxBal = simBal;
          }
          const dd = simMaxBal > 0 ? ((simMaxBal - simBal) / simMaxBal) * 100 : 0;
          if (dd > simMaxDD) {
            simMaxDD = dd;
          }
        }
        drawdowns.push(simMaxDD);
      }

      drawdowns.sort((a, b) => a - b);
      const index95 = Math.floor(runsCount * 0.95);
      monteCarloMaxDrawdown95 = drawdowns[index95];
    }

    // Rolling edge decay alert (compare overall vs last 10 trades)
    let rollingExpectancyAlert = false;
    if (trades.length >= 10) {
      const last10 = trades.slice(-10);
      const last10Expectancy = last10.reduce((sum, t) => sum + t.pnl, 0) / 10;
      if (expectancy > 0 && last10Expectancy < 0) {
        rollingExpectancyAlert = true;
      }
    }

    const dailyCurve = Object.keys(dailyBalanceMap).map((date) => ({
      date,
      balance: Math.round(dailyBalanceMap[date] * 100) / 100,
    }));

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      profitFactor,
      initialBalance,
      finalBalance: balance,
      totalPnL: balance - initialBalance,
      maxDrawdownPercent: maxDrawdown,
      kellyCriterion: kelly,
      expectancy,
      expectancyR,
      marRatio,
      totalFeesPaid,
      totalSlippagePaid,
      rejectedTradesCount,
      monteCarloMaxDrawdown95,
      rollingExpectancyAlert,
      trades,
      dailyCurve,
    };
  }

  public static async runReversionBacktest(params: StrategyParams, originalKlines: any[]): Promise<BacktestResult> {
    const klines = originalKlines;
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const closes = klines.map(k => k.close);

    // Indicator calculations
    const rsiArr = calculateRSI(closes, params.rsiPeriod || 14);
    const bbArr = calculateBollingerBands(closes, 20, 2.0);
    const atrArr = calculateATR(highs, lows, closes, 14);

    const vwapInput = klines.map(k => ({
      time: k.time,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume || k.vol || 1,
    }));
    const vwapArr = calculateSessionVWAP(vwapInput);
    const adxArr = calculateADXArray(highs, lows, closes, 14);

    let balance = 10000.0;
    const initialBalance = balance;
    let maxBalance = balance;
    let maxDrawdown = 0;

    const trades: BacktestResult['trades'] = [];
    const dailyBalanceMap: { [dateStr: string]: number } = {};

    let lastDateStr = '';
    let startOfDayBalance = balance;
    let dailyLossThisDay = 0;
    let coolingOffUntil: Date | null = null;
    let rejectedTradesCount = 0;
    let totalFeesPaid = 0;
    let totalSlippagePaid = 0;

    interface BacktestBasket {
      side: 'BUY' | 'SELL';
      p0: number;
      q: number;
      rungPrices: number[];
      rungsFilled: boolean[];
      stopLossPrice: number;
      tpTargetPrice: number;
      barsHeld: number;
      entryTime: Date;
    }

    let activeBasket: BacktestBasket | null = null;

    for (let i = 30; i < klines.length; i++) {
      const prev = klines[i - 1];
      const curr = klines[i];
      const dateStr = curr.time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      if (!dailyBalanceMap[dateStr]) {
        dailyBalanceMap[dateStr] = balance;
      }

      const currentDateString = curr.time.toDateString();
      if (currentDateString !== lastDateStr) {
        startOfDayBalance = balance;
        dailyLossThisDay = 0;
        lastDateStr = currentDateString;
      }

      // Check news blackout using the robust DST-aware calendar and widened ±30 min window
      const isNewsBlackoutActive = params.isEventBlackoutActive && isWithinTier1Blackout(curr.time).active;

      if (activeBasket) {
        let closed = false;
        let exitPrice = 0;
        let closeReason = 'SL';
        const basket = activeBasket;

        // Blackout event force-flatten
        if (isNewsBlackoutActive) {
          closed = true;
          exitPrice = curr.close;
          closeReason = 'BLACKOUT_FLATTEN';
        }

        // Check time stop
        if (!closed && params.isTimeStopActive && basket.barsHeld >= (params.timeStopBars || 20)) {
          closed = true;
          exitPrice = curr.close;
          closeReason = 'TIME_STOP';
        }

        if (!closed) {
          if (basket.side === 'BUY') {
            // Check Rung fills
            if (!basket.rungsFilled[1] && curr.low <= basket.rungPrices[1]) {
              basket.rungsFilled[1] = true;
            }
            if (basket.rungPrices[2] && !basket.rungsFilled[2] && curr.low <= basket.rungPrices[2]) {
              basket.rungsFilled[2] = true;
            }

            // Check SL
            if (curr.low <= basket.stopLossPrice) {
              closed = true;
              exitPrice = basket.stopLossPrice;
              closeReason = 'SL';
            }
            // Check TP
            else if (curr.high >= basket.tpTargetPrice) {
              closed = true;
              exitPrice = basket.tpTargetPrice;
              closeReason = 'TP';
            }
          } else {
            // SELL Side basket
            if (!basket.rungsFilled[1] && curr.high >= basket.rungPrices[1]) {
              basket.rungsFilled[1] = true;
            }
            if (basket.rungPrices[2] && !basket.rungsFilled[2] && curr.high >= basket.rungPrices[2]) {
              basket.rungsFilled[2] = true;
            }

            // Check SL
            if (curr.high >= basket.stopLossPrice) {
              closed = true;
              exitPrice = basket.stopLossPrice;
              closeReason = 'SL';
            }
            // Check TP
            else if (curr.low <= basket.tpTargetPrice) {
              closed = true;
              exitPrice = basket.tpTargetPrice;
              closeReason = 'TP';
            }
          }
        }

        if (closed) {
          // Flatten basket
          const filledCount = basket.rungsFilled.filter(f => f).length;
          const totalQty = filledCount * basket.q;

          // Average entry price calculation
          let totalEntryValue = 0;
          for (let r = 0; r < basket.rungsFilled.length; r++) {
            if (basket.rungsFilled[r]) {
              totalEntryValue += basket.rungPrices[r] * basket.q;
            }
          }
          const avgEntryPrice = totalEntryValue / totalQty;

          // Slippage
          let slippageAmount = 0;
          if (closeReason === 'SL' || closeReason === 'TIME_STOP' || closeReason === 'BLACKOUT_FLATTEN') {
            slippageAmount = (params.slippageTicks || 1) * 0.05;
            exitPrice = basket.side === 'BUY' ? (exitPrice - slippageAmount) : (exitPrice + slippageAmount);
            totalSlippagePaid += slippageAmount * totalQty;
          }

          const sideMultiplier = basket.side === 'BUY' ? 1 : -1;
          const grossPnL = sideMultiplier * (exitPrice - avgEntryPrice) * totalQty * getContractMultiplier(params.symbol || 'XAUUSDT');

          const entryValue = avgEntryPrice * totalQty * getContractMultiplier(params.symbol || 'XAUUSDT');
          const exitValue = exitPrice * totalQty * getContractMultiplier(params.symbol || 'XAUUSDT');
          const feeRate = params.feePercent / 100;
          const totalFees = (entryValue + exitValue) * feeRate;

          const finalPnL = grossPnL - totalFees;
          balance += finalPnL;
          totalFeesPaid += totalFees;

          if (finalPnL < 0) {
            dailyLossThisDay += Math.abs(finalPnL);
          }

          if (balance > maxBalance) maxBalance = balance;
          const dd = ((maxBalance - balance) / maxBalance) * 100;
          if (dd > maxDrawdown) maxDrawdown = dd;

          const initialDollarRisk = params.reversionRiskUsd || 100.0;
          const riskAmountR = finalPnL / initialDollarRisk;

          trades.push({
            id: 'rev-backtest-' + Math.random().toString(36).substr(2, 9),
            type: basket.side === 'BUY' ? 'LONG' : 'SHORT',
            entryPrice: avgEntryPrice,
            exitPrice,
            entryTime: basket.entryTime.toISOString(),
            exitTime: curr.time.toISOString(),
            pnl: finalPnL,
            fees: totalFees,
            slippage: slippageAmount * totalQty,
            durationMins: Math.floor((curr.time.getTime() - basket.entryTime.getTime()) / 60000),
            result: finalPnL > 0 ? 'PROFIT' : 'LOSS',
            riskAmountR,
            exitReason: closeReason,
          });

          activeBasket = null;
        } else {
          basket.barsHeld++;

          // Dynamic TP adjustment
          let newTpPrice = basket.tpTargetPrice;
          if (params.slowEma === 999) { // custom indicator of tp target
            newTpPrice = Number(bbArr[i].middle.toFixed(2));
          } else {
            newTpPrice = Number(vwapArr[i].toFixed(2));
          }
          const drift = Math.abs(basket.tpTargetPrice - newTpPrice);
          if (drift > 0.25 * atrArr[i]) {
            basket.tpTargetPrice = newTpPrice;
          }
        }
      }

      if (!activeBasket) {
        // Daily loss limit
        const isDailyLossLimitExceeded = params.isEquityThrottleActive && dailyLossThisDay >= (startOfDayBalance * 0.02);
        if (isDailyLossLimitExceeded) {
          rejectedTradesCount++;
          continue;
        }

        // Trigger signal evaluation
        const configRiskUsd = params.reversionRiskUsd || 100.0;
        const configMaxRungs = params.reversionMaxRungs || 3;
        const configSpacing = params.reversionRungSpacingAtr || 1.0;
        const configStopBeyond = params.reversionStopBeyondLastRungAtr || 1.5;

        const currentAdx = adxArr[i];
        if (currentAdx >= (params.adxThreshold || 22)) {
          continue; // Regime filter blocked (market trending)
        }

        // Triple confirmation
        const lastRsi = rsiArr[i];
        const lastBb = bbArr[i];
        const lastAtr = atrArr[i];
        const lastVwap = vwapArr[i];

        const rsiLong = lastRsi < (params.rsiOversold || 25);
        const rsiShort = lastRsi > (params.rsiOverbought || 75);
        const bbLong = lastBb.pctB <= 0;
        const bbShort = lastBb.pctB >= 1;
        const isVwapStretched = Math.abs(curr.close - lastVwap) > (configSpacing * lastAtr);

        let signalSide: 'BUY' | 'SELL' | null = null;
        if (rsiLong && bbLong && isVwapStretched) {
          signalSide = 'BUY';
        } else if (rsiShort && bbShort && isVwapStretched) {
          signalSide = 'SELL';
        }

        if (signalSide) {
          const d = configSpacing * lastAtr;
          const s = configStopBeyond * lastAtr;
          const m = getContractMultiplier(params.symbol || 'XAUUSDT');

          let q = 0;
          if (configMaxRungs === 3) {
            q = configRiskUsd / (m * 3 * (d + s));
          } else if (configMaxRungs === 2) {
            q = configRiskUsd / (m * (d + 2 * s));
          } else {
            q = configRiskUsd / (m * s);
          }

          const qtyStep = 0.01;
          q = Math.floor(q / qtyStep) * qtyStep;

          if (q < 0.01) {
            rejectedTradesCount++;
            continue;
          }

          const rungPrices: number[] = [];
          let stopLossPrice = 0;

          if (signalSide === 'BUY') {
            for (let r = 0; r < configMaxRungs; r++) {
              rungPrices.push(Number((curr.close - r * d).toFixed(2)));
            }
            stopLossPrice = Number((curr.close - ((configMaxRungs - 1) * d + s)).toFixed(2));
          } else {
            for (let r = 0; r < configMaxRungs; r++) {
              rungPrices.push(Number((curr.close + r * d).toFixed(2)));
            }
            stopLossPrice = Number((curr.close + ((configMaxRungs - 1) * d + s)).toFixed(2));
          }

          // Initial TP
          const tpTargetPrice = Number(lastBb.middle.toFixed(2));

          activeBasket = {
            side: signalSide,
            p0: curr.close,
            q,
            rungPrices,
            rungsFilled: [true, false, false], // Rung 1 fills immediately
            stopLossPrice,
            tpTargetPrice,
            barsHeld: 0,
            entryTime: curr.time,
          };
        }
      }

      dailyBalanceMap[dateStr] = balance;
    }

    // Return stats
    const totalTrades = trades.length;
    const winningTrades = trades.filter((t) => t.pnl > 0).length;
    const losingTrades = totalTrades - winningTrades;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const totalProfit = trades.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
    const totalLoss = Math.abs(trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit;
    const expectancy = totalTrades > 0 ? (totalProfit - totalLoss) / totalTrades : 0;
    const rValues = trades.map(t => t.riskAmountR || 0);
    const expectancyR = rValues.length > 0 ? rValues.reduce((sum, r) => sum + r, 0) / rValues.length : 0;

    const dailyCurve = Object.keys(dailyBalanceMap).map((date) => ({
      date,
      balance: Math.round(dailyBalanceMap[date] * 100) / 100,
    }));

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      profitFactor,
      initialBalance,
      finalBalance: balance,
      totalPnL: balance - initialBalance,
      maxDrawdownPercent: maxDrawdown,
      kellyCriterion: 0,
      expectancy,
      expectancyR,
      marRatio: maxDrawdown > 0 ? ((balance - initialBalance) / initialBalance) * 100 / maxDrawdown : 0,
      totalFeesPaid,
      totalSlippagePaid,
      rejectedTradesCount,
      monteCarloMaxDrawdown95: maxDrawdown,
      rollingExpectancyAlert: false,
      trades,
      dailyCurve,
    };
  }
}
