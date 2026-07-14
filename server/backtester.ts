import { ClosedTrade } from './db.js';

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
}

// Generates highly realistic XAUUSDT price series with simulated indicators including ADX
function generateSyntheticKlines(startDate: Date, endDate: Date, timeframeMins: number) {
  const klines: {
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

  let currentPrice = 2320.0;
  let emaFast = 2320.0;
  let emaSlow = 2320.0;
  let rsi = 50;
  let atr = 3.5;
  let adx = 22.0;

  const totalMinutes = Math.floor((endDate.getTime() - startDate.getTime()) / (60 * 1000));
  const steps = Math.floor(totalMinutes / timeframeMins);

  // Constants for TrendForge indicators
  const fastAlpha = 2 / (12 + 1);
  const slowAlpha = 2 / (26 + 1);

  // Pre-seed some price history to stabilize indicators
  for (let i = 0; i < steps; i++) {
    const time = new Date(startDate.getTime() + i * timeframeMins * 60 * 1000);
    
    // Create authentic gold-like trends, micro-reversals, and random walks
    const seed = time.getDate() + time.getHours() * 0.1;
    const trendCycle = Math.sin(i / 100) * 12 + Math.cos(i / 40) * 5;
    const sessionVolatility = (time.getHours() >= 13 && time.getHours() <= 18) ? 1.8 : 0.6; // High vol during NY session
    const randomWalk = (Math.sin(seed * 2) * 1.5 + Math.cos(seed * 3) * 1.2 + (Math.random() - 0.5) * 3) * sessionVolatility;
    
    const change = trendCycle * 0.08 + randomWalk;
    const prevPrice = currentPrice;
    currentPrice = Math.max(1800, currentPrice + change);

    const high = currentPrice + Math.random() * (2.5 * sessionVolatility);
    const low = currentPrice - Math.random() * (2.5 * sessionVolatility);

    // EMAs
    emaFast = currentPrice * fastAlpha + emaFast * (1 - fastAlpha);
    emaSlow = currentPrice * slowAlpha + emaSlow * (1 - slowAlpha);

    // Dynamic RSI calculation based on changes
    const diff = currentPrice - prevPrice;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    rsi = Math.max(10, Math.min(90, rsi * 0.92 + (gain / (gain + loss + 0.001) * 100) * 0.08));

    // Dynamic ATR based on high-low range
    const currentRange = high - low;
    atr = atr * 0.95 + currentRange * 0.05;

    // Dynamic ADX simulation
    const trendMagnitude = Math.abs(trendCycle) + Math.abs(randomWalk) * 0.5;
    const targetAdx = 10.0 + Math.min(38.0, trendMagnitude * 5.5);
    adx = adx * 0.94 + targetAdx * 0.06;

    klines.push({
      time,
      open: prevPrice,
      high,
      low,
      close: currentPrice,
      rsi,
      atr,
      emaFast,
      emaSlow,
      adx,
    });
  }

  return klines;
}

export class Backtester {
  public static run(params: StrategyParams): BacktestResult {
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
    const klines = generateSyntheticKlines(startDate, endDate, timeframeMins);

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

      // Check event blackout: Mondays, Wednesdays, Fridays 13:15 to 14:15 or Wednesdays 18:45 to 19:45
      const dayOfWeek = curr.time.getUTCDay();
      const hour = curr.time.getUTCHours();
      const min = curr.time.getUTCMinutes();
      
      const isNewsBlackoutActive = params.isEventBlackoutActive && (
        ((dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) && hour === 13 && min >= 15 && min <= 45) ||
        (dayOfWeek === 3 && hour === 19 && min >= 0 && min <= 30)
      );

      // 1. Blackout News Flattening Upgrade
      if (isNewsBlackoutActive && currentPosition) {
        // Force-flatten at market to avoid high slippage
        const exitPrice = curr.close;
        const pos = currentPosition;
        
        const sideMultiplier = pos.type === 'LONG' ? 1 : -1;
        const grossPnL = sideMultiplier * (exitPrice - pos.entryPrice) * pos.quantity * 10;
        
        const entryValue = pos.entryPrice * pos.quantity * 10;
        const exitValue = exitPrice * pos.quantity * 10;
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

        const initialDollarRisk = pos.initialRiskPriceDiff * pos.initialQty * 10;
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
            const grossPnL = sideMultiplier * (exitPrice - pos.entryPrice) * partialQty * 10;
            const entryValue = pos.entryPrice * partialQty * 10;
            const exitValue = exitPrice * partialQty * 10;
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

            const initialDollarRisk = pos.initialRiskPriceDiff * pos.initialQty * 10;
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
          const grossPnL = sideMultiplier * priceDiff * pos.quantity * 10;

          // Fees modeling (Maker vs Taker)
          const entryValue = pos.entryPrice * pos.quantity * 10;
          const exitValue = exitPrice * pos.quantity * 10;
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
          const initialDollarRisk = pos.initialRiskPriceDiff * pos.initialQty * 10;
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
}
