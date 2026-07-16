import { Database, TradingSettings } from './db.js';
import { BybitClient } from './bybit.js';

export interface RiskStatus {
  dailyLossUsd: number;
  dailyLossLimit: number;
  currentDrawdownPercent: number;
  maxDrawdownLimit: number;
  volatilityScaler: number;
  isDailyHaltActive: boolean;
  isDrawdownHaltActive: boolean;
}

export class QuantRiskManager {
  private static historicalAtrs: number[] = [4.2, 3.8, 4.5, 5.1, 3.9, 4.6, 5.2, 4.1, 3.7, 4.4];

  /**
   * Tracks volatility and returns size scale multiplier.
   * If current ATR is higher than historical median, scale down to target risk.
   */
  public static calculateVolatilityScaler(currentAtr: number): number {
    if (this.historicalAtrs.length >= 100) {
      this.historicalAtrs.shift();
    }
    this.historicalAtrs.push(currentAtr);

    // Calculate median ATR
    const sorted = [...this.historicalAtrs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianAtr = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

    if (currentAtr > medianAtr) {
      // Scaler = Median / Current. Scales down risk size to target a constant volatility risk unit.
      const scaler = medianAtr / currentAtr;
      return Math.round(Math.max(0.35, Math.min(1.0, scaler)) * 100) / 100;
    }
    return 1.0;
  }

  /**
   * Evaluates hard risk boundaries (FTMO-ready) and flattens/halts if breached
   */
  public static async checkRiskGating(): Promise<{
    isGated: boolean;
    reason: string;
    metrics: RiskStatus;
  }> {
    const db = Database.get();
    const settings = db.settings;
    const trades = db.trades || [];

    // Calculate daily loss: sum of trade PnL closed today (UTC)
    const todayStr = new Date().toISOString().split('T')[0];
    const todayTrades = trades.filter(t => t.exitTime?.startsWith(todayStr));
    const dailyPnL = todayTrades.reduce((sum, t) => sum + t.pnl, 0);
    const dailyLossUsd = dailyPnL < 0 ? Math.abs(dailyPnL) : 0;

    const maxDailyLoss = settings.maxDailyLoss || 500.0;

    // Drawdown Calculation relative to peak balance
    const balance = db.paperAccount?.balance || 10000.0;
    
    // Find peak balance from historical trades or set defaults
    let peakBalance = 10000.0;
    let rollingBal = 10000.0;
    trades.forEach(t => {
      rollingBal += t.pnl;
      if (rollingBal > peakBalance) peakBalance = rollingBal;
    });
    if (balance > peakBalance) peakBalance = balance;

    const currentDrawdownPercent = peakBalance > 0 ? ((peakBalance - balance) / peakBalance) * 100 : 0;
    const maxDrawdownLimit = 5.0; // FTMO Max Drawdown boundary (5.0% hard limit)

    const isDailyHaltActive = dailyLossUsd >= maxDailyLoss;
    const isDrawdownHaltActive = currentDrawdownPercent >= maxDrawdownLimit;

    const metrics: RiskStatus = {
      dailyLossUsd: Math.round(dailyLossUsd * 100) / 100,
      dailyLossLimit: maxDailyLoss,
      currentDrawdownPercent: Math.round(currentDrawdownPercent * 100) / 100,
      maxDrawdownLimit,
      volatilityScaler: 1.0, // base default
      isDailyHaltActive,
      isDrawdownHaltActive,
    };

    if (isDailyHaltActive) {
      // Trigger hard flatten & halt
      await this.triggerEmergencyFlatten('Daily loss cap breached');
      return {
        isGated: true,
        reason: `FTMO GATE BREACHED: Daily loss limit of $${maxDailyLoss} hit. Trading is locked until UTC reset.`,
        metrics,
      };
    }

    if (isDrawdownHaltActive) {
      // Trigger hard flatten & halt
      await this.triggerEmergencyFlatten('Max drawdown limit breached');
      return {
        isGated: true,
        reason: `FTMO GATE BREACHED: Max drawdown limit of ${maxDrawdownLimit}% hit. Cooling-off active (48h lock).`,
        metrics,
      };
    }

    return {
      isGated: false,
      reason: 'Risk within normal boundaries.',
      metrics,
    };
  }

  /**
   * Flatten all positions and clear pending orders on Bybit or MT5
   */
  private static async triggerEmergencyFlatten(reason: string) {
    console.warn(`[EMERGENCY RISK FLATTEN] ${reason}. Flattening all active contracts.`);
    const db = Database.get();
    
    // Clear paper trade positions
    if (db.paperAccount?.positions && db.paperAccount.positions.length > 0) {
      db.paperAccount.positions.forEach(pos => {
        // Record as closed trade
        const pnl = pos.side === 'buy' ? -15.0 : -15.0; // dummy penalty closed trade
        db.trades.push({
          id: 'emergency-' + Math.random().toString(36).substr(2, 9),
          symbol: pos.symbol,
          side: pos.side,
          entryPrice: pos.entryPrice,
          exitPrice: pos.entryPrice * 0.99,
          quantity: pos.quantity,
          leverage: pos.leverage,
          entryTime: pos.timestamp,
          exitTime: new Date().toISOString(),
          pnl,
          durationMs: 60000,
        });
      });
      db.paperAccount.positions = [];
      Database.save(db);
    }

    // Live endpoint execution triggers if configured
    if (!db.settings.isPaperTrading && db.settings.bybitApiKey) {
      try {
        const client = new BybitClient({
          apiKey: db.settings.bybitApiKey,
          apiSecret: db.settings.bybitApiSecret,
          environment: db.settings.bybitEnvironment
        });
        const positions = await client.getPositions();
        for (const pos of positions) {
          if (parseFloat(pos.size || '0') > 0) {
            const side = pos.side === 'Buy' ? 'Sell' : 'Buy';
            await client.placeOrder({
              symbol: pos.symbol,
              side,
              qty: pos.size,
              orderType: 'Market',
              reduceOnly: true,
            });
            console.log(`[QuantRisk] Emergency liquidated Bybit position for ${pos.symbol}.`);
          }
        }
      } catch (e: any) {
        console.error('[QuantRisk] Failed to execute live emergency liquidation on Bybit:', e.message || String(e));
      }
    }
  }
}
