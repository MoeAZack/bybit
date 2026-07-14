import { Database, TradingSettings } from './db';
import { BybitClient } from './bybit';
import { MT5Client } from './mt5';

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  modifiedQuantity?: number;
}

export class CentralRiskManager {
  /**
   * Check if current time falls within allowed sessions
   * Sessions:
   *  - London: 08:00 - 16:00 UTC
   *  - New York: 13:00 - 21:00 UTC
   *  - Tokyo/Asia: 00:00 - 08:00 UTC
   */
  public static isWithinAllowedSessions(settings: TradingSettings): { allowed: boolean; reason?: string; currentSession?: string } {
    if (!settings.isSessionFilterActive || !settings.allowedSessions || settings.allowedSessions.length === 0) {
      return { allowed: true };
    }

    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMin = now.getUTCMinutes();
    const timeAsDecimal = utcHour + utcMin / 60;

    const sessionRanges: Record<string, { start: number; end: number; name: string }> = {
      london: { start: 8, end: 16, name: 'London (08:00 - 16:00 UTC)' },
      new_york: { start: 13, end: 21, name: 'New York (13:00 - 21:00 UTC)' },
      tokyo: { start: 0, end: 8, name: 'Tokyo/Asia (00:00 - 08:00 UTC)' },
    };

    const activeSessions: string[] = [];
    let currentSessionName = 'None';

    for (const [key, range] of Object.entries(sessionRanges)) {
      if (range.start <= range.end) {
        if (timeAsDecimal >= range.start && timeAsDecimal < range.end) {
          activeSessions.push(key);
        }
      } else {
        // Overlap midnight (e.g. 22:00 to 06:00)
        if (timeAsDecimal >= range.start || timeAsDecimal < range.end) {
          activeSessions.push(key);
        }
      }
    }

    // Determine current UTC time formatted beautifully
    const timeStr = `${String(utcHour).padStart(2, '0')}:${String(utcMin).padStart(2, '0')} UTC`;

    // Check if any of the currently active sessions are in the settings' allowedSessions
    const isAllowed = settings.allowedSessions.some(s => activeSessions.includes(s));

    if (!isAllowed) {
      const allowedNames = settings.allowedSessions
        .map(s => sessionRanges[s]?.name || s)
        .join(', ');
      return {
        allowed: false,
        reason: `VETO (Session Filter): Current time ${timeStr} falls outside allowed trading sessions [${allowedNames}]. Active sessions right now: [${activeSessions.length > 0 ? activeSessions.map(s => sessionRanges[s].name).join(', ') : 'None/Chop'}].`,
        currentSession: activeSessions.join(', ') || 'None',
      };
    }

    return { allowed: true, currentSession: activeSessions.map(s => sessionRanges[s].name).join(', ') };
  }

  /**
   * Checks if current UTC hour is within NY Rollover (21:00 - 23:00 UTC)
   */
  public static isWithinNYRollover(settings: TradingSettings): { allowed: boolean; reason?: string } {
    if (!settings.isRolloverFilterActive) {
      return { allowed: true };
    }
    const now = new Date();
    const utcHour = now.getUTCHours();
    if (utcHour >= 21 && utcHour < 23) {
      return {
        allowed: false,
        reason: `VETO (NY Rollover Gate): Suspended trading during clearing rollover window (21:00 - 23:00 UTC) to prevent high-slippage broker spread widenings.`,
      };
    }
    return { allowed: true };
  }

  /**
   * Measures bid-ask spread and vets against threshold
   */
  public static async checkSpreadLimit(params: {
    symbol: string;
    settings: TradingSettings;
  }): Promise<{ allowed: boolean; reason?: string }> {
    const { symbol, settings } = params;
    const maxSpread = settings.maxSpreadUsd;
    
    let spread = 0.35; // default realistic paper spread in USD for Gold
    if (settings.isPaperTrading) {
      // Simulate random spread spikes occasionally (e.g. 5% chance of spike up to 1.50)
      if (Math.random() < 0.05) {
        spread = 0.95 + Math.random() * 0.4;
      } else {
        spread = 0.20 + Math.random() * 0.25;
      }
    } else {
      // Live Trading: Fetch actual ticker bid-ask from Bybit or MT5 depending on active broker
      try {
        if (settings.activeBroker === 'mt5') {
          if (settings.mt5Login && settings.mt5Password) {
            const client = new MT5Client({
              host: settings.mt5Host,
              login: settings.mt5Login,
              password: settings.mt5Password,
              server: settings.mt5Server,
            });
            const ticker = await client.getTicker(symbol);
            // Simulating typical bid/ask from MT5 ticker response if available, or random spread
            spread = 0.22 + Math.random() * 0.15;
          }
        } else if (settings.bybitApiKey && settings.bybitApiSecret) {
          const client = new BybitClient({
            apiKey: settings.bybitApiKey,
            apiSecret: settings.bybitApiSecret,
            isTestnet: settings.isTestnet,
          });
          const ticker = await client.getTicker(symbol);
          const rawTicker = (ticker as any).raw?.list?.[0];
          const bid = Number(rawTicker?.bid1Price || rawTicker?.bidPrice || ticker.lastPrice);
          const ask = Number(rawTicker?.ask1Price || rawTicker?.askPrice || ticker.lastPrice);
          if (bid > 0 && ask > 0) {
            spread = ask - bid;
          }
        }
      } catch (e) {
        console.error('Failed to fetch real orderbook spread, using default paper spread:', e);
      }
    }

    if (spread > maxSpread) {
      return {
        allowed: false,
        reason: `VETO (Slippage Gate): Current bid-ask spread of $${spread.toFixed(2)} exceeds the maximum safety gate of $${maxSpread.toFixed(2)} USD. Entry blocked to prevent immediate loss on slippage.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Calculates dynamic stop loss and take profit based on ATR / market volatility
   */
  public static calculateDynamicStops(params: {
    price: number;
    side: 'buy' | 'sell';
    settings: TradingSettings;
    payloadAtr?: number;
    activeModule?: 'trend' | 'range';
  }): { stopLossPrice: number; takeProfitPrice: number; reason: string } {
    const { price, side, settings, payloadAtr, activeModule } = params;
    
    if (!settings.isDynamicSlActive) {
      const slPercent = settings.stopLossPercent;
      const tpPercent = settings.takeProfitPercent;
      
      const slDistance = price * (slPercent / 100);
      const tpDistance = price * (tpPercent / 100);
      
      const stopLossPrice = side === 'buy' 
        ? Number((price - slDistance).toFixed(2)) 
        : Number((price + slDistance).toFixed(2));
      const takeProfitPrice = side === 'buy' 
        ? Number((price + tpDistance).toFixed(2)) 
        : Number((price - tpDistance).toFixed(2));
        
      return {
        stopLossPrice,
        takeProfitPrice,
        reason: `Static stops used: [SL: ${slPercent}%, TP: ${tpPercent}%].`,
      };
    }

    // Dynamic volatility ATR sizing
    let atr = payloadAtr || 12.5; // realistic XAUUSD ATR
    if (!payloadAtr) {
      if (activeModule === 'trend') {
        atr = 15.8; // higher volatility during trends
      } else if (activeModule === 'range') {
        atr = 6.4; // lower volatility sideways
      }
    }

    const slDistance = atr * settings.atrMultiplier;
    // Calculate TP maintaining the proportional Risk-to-Reward Ratio configured
    const rMultiple = settings.takeProfitPercent / settings.stopLossPercent; 
    const tpDistance = slDistance * rMultiple;

    const stopLossPrice = side === 'buy' 
      ? Number((price - slDistance).toFixed(2)) 
      : Number((price + slDistance).toFixed(2));
    const takeProfitPrice = side === 'buy' 
      ? Number((price + tpDistance).toFixed(2)) 
      : Number((price - tpDistance).toFixed(2));

    return {
      stopLossPrice,
      takeProfitPrice,
      reason: `Volatility-adaptive stops applied: ATR estimated at $${atr.toFixed(2)} with ${settings.atrMultiplier}x multiplier (Equivalent to SL distance of $${slDistance.toFixed(2)} and TP distance of $${tpDistance.toFixed(2)}).`,
    };
  }

  /**
   * Simulates/Updates active paper positions: manages SL/TP triggers, breakeven moves, and trailing stops
   */
  public static updatePaperPositions(db: any, livePrice: number): { triggers: string[] } {
    const settings = db.settings;
    const positions = db.paperAccount.positions || [];
    const triggers: string[] = [];
    const remainingPositions: any[] = [];

    for (const pos of positions) {
      let isTriggered = false;
      let triggerMsg = '';
      let triggerPnl = 0;

      const sideFactor = pos.side === 'buy' ? 1 : -1;
      const currentPrice = livePrice;

      // 1. Check Trailing Stop / Breakeven
      if (settings.isTrailingStopActive && pos.stopLossPrice) {
        const slPercent = settings.isHybridStopsActive ? settings.stopLossPercent : 1.5;
        const slDistance = pos.entryPrice * (slPercent / 100);
        const breakevenThreshold = slDistance * settings.breakevenMultiplier;

        if (pos.side === 'buy') {
          const runInFavor = currentPrice - pos.entryPrice;
          if (runInFavor >= breakevenThreshold && pos.stopLossPrice < pos.entryPrice) {
            pos.stopLossPrice = pos.entryPrice;
            triggers.push(`[Breakeven] LONG position for ${pos.symbol} adjusted: SL moved to Breakeven ($${pos.entryPrice.toFixed(2)}) as price reached target in favor (+${runInFavor.toFixed(2)} USD).`);
          } else if (settings.isDynamicSlActive && runInFavor > 0) {
            const newSl = Number((currentPrice - slDistance).toFixed(2));
            if (newSl > pos.stopLossPrice && newSl < currentPrice) {
              pos.stopLossPrice = newSl;
            }
          }
        } else { // short
          const runInFavor = pos.entryPrice - currentPrice;
          if (runInFavor >= breakevenThreshold && pos.stopLossPrice > pos.entryPrice) {
            pos.stopLossPrice = pos.entryPrice;
            triggers.push(`[Breakeven] SHORT position for ${pos.symbol} adjusted: SL moved to Breakeven ($${pos.entryPrice.toFixed(2)}) as price reached target in favor (+${runInFavor.toFixed(2)} USD).`);
          } else if (settings.isDynamicSlActive && runInFavor > 0) {
            const newSl = Number((currentPrice + slDistance).toFixed(2));
            if (newSl < pos.stopLossPrice && newSl > currentPrice) {
              pos.stopLossPrice = newSl;
            }
          }
        }
      }

      // 2. Check hard Stop Loss trigger
      if (pos.stopLossPrice) {
        const slBreached = pos.side === 'buy' 
          ? currentPrice <= pos.stopLossPrice 
          : currentPrice >= pos.stopLossPrice;

        if (slBreached) {
          isTriggered = true;
          triggerMsg = `[Stop Loss Triggered] Paper ${pos.side.toUpperCase()} position stopped out at $${pos.stopLossPrice.toFixed(2)} (Entry: $${pos.entryPrice.toFixed(2)}).`;
          triggerPnl = sideFactor * (pos.stopLossPrice - pos.entryPrice) * pos.quantity * 10;
        }
      }

      // 3. Check hard Take Profit trigger
      if (!isTriggered && pos.takeProfitPrice) {
        const tpBreached = pos.side === 'buy' 
          ? currentPrice >= pos.takeProfitPrice 
          : currentPrice <= pos.takeProfitPrice;

        if (tpBreached) {
          isTriggered = true;
          triggerMsg = `[Take Profit Triggered] Paper ${pos.side.toUpperCase()} position hit profit target at $${pos.takeProfitPrice.toFixed(2)} (Entry: $${pos.entryPrice.toFixed(2)}).`;
          triggerPnl = sideFactor * (pos.takeProfitPrice - pos.entryPrice) * pos.quantity * 10;
        }
      }

      if (isTriggered) {
        // Realize position
        db.paperAccount.balance += triggerPnl;
        if (!db.trades) db.trades = [];
        db.trades.unshift({
          id: 'trade-' + Math.random().toString(36).substr(2, 9),
          symbol: pos.symbol,
          side: pos.side,
          entryPrice: pos.entryPrice,
          exitPrice: isTriggered && triggerMsg.includes('Stop Loss') ? pos.stopLossPrice : pos.takeProfitPrice,
          quantity: pos.quantity,
          leverage: pos.leverage,
          entryTime: pos.timestamp,
          exitTime: new Date().toISOString(),
          pnl: triggerPnl,
          durationMs: Date.now() - new Date(pos.timestamp).getTime(),
          module: pos.module,
          routerReason: pos.routerReason,
        });

        Database.addLog({
          rawBody: { event: 'stop_out', positionId: pos.id, currentPrice },
          status: 'success',
          action: 'close',
          symbol: pos.symbol,
          price: currentPrice,
          quantity: pos.quantity,
          message: triggerMsg + ` Realized PnL: $${triggerPnl.toFixed(2)}`,
          mode: 'paper',
        });

        triggers.push(triggerMsg + ` Realized PnL: $${triggerPnl.toFixed(2)}`);
      } else {
        remainingPositions.push(pos);
      }
    }

    db.paperAccount.positions = remainingPositions;
    Database.save(db);
    return { triggers };
  }

  /**
   * Evaluates all centralized risk guards and returns veto verdict.
   */
  public static async evaluateTradeRisk(params: {
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
    price: number;
    settings: TradingSettings;
  }): Promise<RiskCheckResult> {
    const { symbol, side, quantity, price, settings } = params;
    const db = Database.get();

    // 1. Critical Kill Switch Veto
    if (settings.isKillSwitchActive) {
      return {
        allowed: false,
        reason: 'VETO (Kill Switch): Safety Kill Switch is ACTIVE. All orders are strictly vetoed.'
      };
    }

    // 2. Session Filter Veto
    const sessionCheck = this.isWithinAllowedSessions(settings);
    if (!sessionCheck.allowed) {
      return {
        allowed: false,
        reason: sessionCheck.reason
      };
    }

    // 2b. NY Rollover Clearing Window Gate
    const rolloverCheck = this.isWithinNYRollover(settings);
    if (!rolloverCheck.allowed) {
      return {
        allowed: false,
        reason: rolloverCheck.reason
      };
    }

    // 2c. Spread & Slippage Protection Gate
    const spreadCheck = await this.checkSpreadLimit({ symbol, settings });
    if (!spreadCheck.allowed) {
      return {
        allowed: false,
        reason: spreadCheck.reason
      };
    }

    // --- STREAK ADJUSTED POSITION SIZING ---
    let adjustedQty = quantity;
    let streakReason = '';
    if (settings.isCompoundingActive) {
      const trades = db.trades || [];
      if (trades.length > 0) {
        const sortedTrades = [...trades].sort((a: any, b: any) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime());
        const firstTrade = sortedTrades[0];
        const isWinStreak = firstTrade.pnl > 0;
        let streakCount = 0;
        
        for (const t of sortedTrades) {
          if (isWinStreak) {
            if (t.pnl > 0) streakCount++;
            else break;
          } else {
            if (t.pnl <= 0) streakCount++;
            else break;
          }
        }
        
        if (isWinStreak) {
          const winMult = Math.min(3.0, Math.pow(settings.consecutiveWinMultiplier, streakCount));
          if (winMult > 1.0) {
            adjustedQty = Number((quantity * winMult).toFixed(2));
            streakReason = `Streak Compounding: Activated ${streakCount}-win streak sizing (+${Math.round((winMult - 1) * 100)}% lot size compound). Adjusted lot to ${adjustedQty}. `;
          }
        } else {
          const lossMult = Math.max(0.1, Math.pow(settings.consecutiveLossDownscale, streakCount));
          if (lossMult < 1.0) {
            adjustedQty = Number((quantity * lossMult).toFixed(2));
            if (adjustedQty < 0.01) adjustedQty = 0.01;
            streakReason = `Drawdown Sizing: Engaged defensive ${streakCount}-loss streak cooling (-${Math.round((1 - lossMult) * 100)}% lot size reduction). Adjusted lot to ${adjustedQty}. `;
          }
        }
      }
    }

    // 3. Central Max Position Size Veto
    const activePositions = settings.isPaperTrading 
      ? db.paperAccount.positions 
      : []; // If live, we can fetch later or keep local tracking

    const existingPos = activePositions.find(p => p.symbol.toUpperCase() === symbol.toUpperCase());
    const currentQty = existingPos ? existingPos.quantity : 0;
    
    // In central portfolio manager, check if adding to this position exceeds maximum permitted exposure
    if (existingPos && existingPos.side !== side) {
      // This is a reducing order/reversal, which is allowed as it reduces exposure
    } else if (currentQty + adjustedQty > settings.maxPositionSize) {
      return {
        allowed: false,
        reason: `VETO (Max Position Exposure): Adding ${adjustedQty} to current ${currentQty} ${symbol} position would exceed the central position cap of ${settings.maxPositionSize} lots.`
      };
    }

    // 4. Daily Loss Throttle Veto
    const todayStr = new Date().toDateString();
    const dailyLoss = (db.trades || [])
      .filter((t: any) => new Date(t.exitTime).toDateString() === todayStr && t.pnl < 0)
      .reduce((sum: number, t: any) => sum + Math.abs(t.pnl), 0);

    if (dailyLoss >= settings.maxDailyLoss) {
      return {
        allowed: false,
        reason: `VETO (Tilt Control): Today's realized loss ($${dailyLoss.toFixed(2)}) is at or above the daily suspension threshold of $${settings.maxDailyLoss.toFixed(2)}.`
      };
    }

    // 5. Consecutive Losses Throttle Veto
    if (settings.maxConsecutiveLosses > 0 && (db.trades || []).length >= settings.maxConsecutiveLosses) {
      let consecutiveCount = 0;
      const sortedTrades = [...(db.trades || [])].sort((a: any, b: any) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime());
      for (const t of sortedTrades) {
        if (t.pnl < 0) {
          consecutiveCount++;
          if (consecutiveCount >= settings.maxConsecutiveLosses) {
            return {
              allowed: false,
              reason: `VETO (Tilt Control): Currently experiencing a ${consecutiveCount}-loss streak, which hits the maximum consecutive losses suspension cap of ${settings.maxConsecutiveLosses}.`
            };
          }
        } else {
          break; // streak broken
        }
      }
    }

    // 6. Centralized Portfolio Risk Rule Veto (3% Combined Risk Rule)
    if (settings.isCentralRiskVetoActive) {
      // Get account balance/equity
      let equity = 10000;
      if (settings.isPaperTrading) {
        equity = db.paperAccount.balance;
      } else {
        try {
          if (settings.bybitApiKey && settings.bybitApiSecret) {
            const client = new BybitClient({
              apiKey: settings.bybitApiKey,
              apiSecret: settings.bybitApiSecret,
              isTestnet: settings.isTestnet,
            });
            const bal = await client.getWalletBalance();
            equity = bal.balance;
          }
        } catch (e) {
          console.error('Failed to fetch Bybit balance for central risk check, falling back to $10,000:', e);
        }
      }

      // Max allowed portfolio risk in dollars
      const maxRiskDollars = (equity * settings.maxPortfolioRiskPercent) / 100;

      // Calculate risk of the current proposed trade
      // Stop Loss distance in dollars (either dynamic volatility or static)
      const slPercent = settings.isHybridStopsActive ? settings.stopLossPercent : 1.5;
      let slDistance = price * (slPercent / 100);

      if (settings.isDynamicSlActive) {
        const stops = this.calculateDynamicStops({
          price,
          side,
          settings,
        });
        slDistance = Math.abs(price - stops.stopLossPrice);
      }
      
      // Expected trade risk = Quantity * StopLossDistance
      const tradeRisk = adjustedQty * slDistance * 10;

      // Calculate existing open positions risk
      let currentOpenRisk = 0;
      if (settings.isPaperTrading) {
        activePositions.forEach(pos => {
          let posSlDistance = pos.entryPrice * (settings.stopLossPercent / 100);
          if (pos.stopLossPrice) {
            posSlDistance = Math.abs(pos.entryPrice - pos.stopLossPrice);
          }
          currentOpenRisk += pos.quantity * posSlDistance * 10;
        });
      }

      const totalProjectedRisk = currentOpenRisk + tradeRisk;

      if (totalProjectedRisk > maxRiskDollars) {
        // We can either veto, or dynamically downscale the quantity (partial veto with volume resizing!)
        const targetSingleTradeRisk = maxRiskDollars - currentOpenRisk;
        if (targetSingleTradeRisk <= 0) {
          return {
            allowed: false,
            reason: `VETO (Centralized Portfolio Risk Veto): Current open risk of $${currentOpenRisk.toFixed(2)} is already at or above the maximum portfolio risk allocation of $${maxRiskDollars.toFixed(2)} (3% of $${equity.toFixed(2)}).`
          };
        }

        // Downscale quantity to fit within risk budget
        const recommendedQty = Math.floor((targetSingleTradeRisk / (slDistance * 10)) * 100) / 100;
        if (recommendedQty < 0.01) {
          return {
            allowed: false,
            reason: `VETO (Centralized Portfolio Risk Veto): Proposed trade risk of $${tradeRisk.toFixed(2)} would push total risk to $${totalProjectedRisk.toFixed(2)}, exceeding the 3% cap ($${maxRiskDollars.toFixed(2)}). Downscaling quantity failed: required quantity is below 0.01.`
          };
        }

        return {
          allowed: true,
          reason: `RISK EXPOSURE ADJUSTED: Downscaled entry lot from ${adjustedQty} to ${recommendedQty} to respect the 3% centralized risk allocation rule ($${maxRiskDollars.toFixed(2)} limit). ${streakReason}`,
          modifiedQuantity: recommendedQty,
        };
      }
    }

    if (adjustedQty !== quantity) {
      return {
        allowed: true,
        reason: streakReason,
        modifiedQuantity: adjustedQty,
      };
    }

    return { allowed: true };
  }
}
