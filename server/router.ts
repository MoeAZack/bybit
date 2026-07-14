import { Database, ClosedTrade } from './db';

export interface RegimeModuleStats {
  name: string;
  tradesCount: number;
  winRate: number;
  totalPnl: number;
  expectancyR: number; // Expectancy in R-multiples (Average return / average risk)
  status: 'Active' | 'Idle';
}

export class RegimeRouter {
  /**
   * Determine the current active regime
   * If settings is set to 'auto', we can dynamically read the last market state or use the payload details.
   * By default, gold EAs use ADX(14) with a threshold of 22 to separate trend from range.
   */
  public static getActiveRegime(params: {
    adxValue?: number;
    forceRegime?: 'trend' | 'range' | 'auto';
    adxThreshold?: number;
  }): { regime: 'trend' | 'range'; adx: number; threshold: number; reason: string } {
    const defaultThreshold = params.adxThreshold ?? 22;
    const adx = params.adxValue ?? 24.5; // Simulate a realistic moving ADX if not provided

    if (params.forceRegime === 'trend') {
      return {
        regime: 'trend',
        adx,
        threshold: defaultThreshold,
        reason: 'Regime manually locked to TREND Following Module.',
      };
    }

    if (params.forceRegime === 'range') {
      return {
        regime: 'range',
        adx,
        threshold: defaultThreshold,
        reason: 'Regime manually locked to RANGE Mean-Reversion Module.',
      };
    }

    // Dynamic auto regime routing based on ADX
    if (adx >= defaultThreshold) {
      return {
        regime: 'trend',
        adx,
        threshold: defaultThreshold,
        reason: `Regime Routed dynamically to TREND Module (ADX ${adx.toFixed(1)} >= Gate ${defaultThreshold}). Market shows strong directional momentum.`,
      };
    } else {
      return {
        regime: 'range',
        adx,
        threshold: defaultThreshold,
        reason: `Regime Routed dynamically to RANGE Module (ADX ${adx.toFixed(1)} < Gate ${defaultThreshold}). Sideways market, mean-reversion filters engaged.`,
      };
    }
  }

  /**
   * Calculate independent stats and expectancy for the Trend and Range modules
   * Trend module: trades taken when ADX >= threshold
   * Range module: trades taken when ADX < threshold
   */
  public static getModulePerformance(): { trend: RegimeModuleStats; range: RegimeModuleStats } {
    const db = Database.get();
    const settings = db.settings;
    const trades = db.trades || [];

    // Separate trades into Trend vs Range based on historical metadata
    // In our DB, we can store which module executed the trade, or segregate based on a simulated classification
    // Let's segregate based on the trade duration, pnl, or look up stored regime properties.
    // If no regime metadata is present on trades, we categorize:
    // Trend trades: usually longer duration (holding for trend continuation) or higher profit target
    // Range trades: usually shorter duration (scalps)
    
    let trendTrades: ClosedTrade[] = [];
    let rangeTrades: ClosedTrade[] = [];

    trades.forEach((t: any) => {
      // If the trade specifically records its router module, use it:
      if (t.module === 'trend') {
        trendTrades.push(t);
      } else if (t.module === 'range') {
        rangeTrades.push(t);
      } else {
        // Fallback historical classifier:
        // Shorter duration trades (e.g. less than 2 hours) are classified as range mean-reversion scalps.
        const durationHours = (t.durationMs || 3600000) / 3600000;
        if (durationHours < 2.5) {
          rangeTrades.push(t);
        } else {
          trendTrades.push(t);
        }
      }
    });

    const calcStats = (name: string, list: ClosedTrade[], isActive: boolean): RegimeModuleStats => {
      const count = list.length;
      if (count === 0) {
        return {
          name,
          tradesCount: 0,
          winRate: 0,
          totalPnl: 0,
          expectancyR: 0,
          status: isActive ? 'Active' : 'Idle',
        };
      }

      const wins = list.filter(t => t.pnl > 0).length;
      const winRate = (wins / count) * 100;
      const totalPnl = list.reduce((sum, t) => sum + t.pnl, 0);

      // Expectancy R-Multiple = (Win Rate * Avg Win) - (Loss Rate * Avg Loss)
      const winTrades = list.filter(t => t.pnl > 0);
      const lossTrades = list.filter(t => t.pnl <= 0);

      const avgWin = winTrades.length > 0 
        ? winTrades.reduce((sum, t) => sum + t.pnl, 0) / winTrades.length 
        : 0;
      const avgLoss = lossTrades.length > 0 
        ? Math.abs(lossTrades.reduce((sum, t) => sum + t.pnl, 0) / lossTrades.length) 
        : 1; // avoid division by 0

      // standard expectancy formula: expectancy = (P_win * Avg_Win_Ratio) - (P_loss)
      // Normalized to R-multiples using an average risk estimate (e.g. risk percent of trade)
      const avgWinR = avgWin / 15.0; // Assume average risk of 15 dollars per lot/unit
      const avgLossR = avgLoss / 15.0;
      const winP = wins / count;
      const lossP = 1 - winP;
      const expectancyR = (winP * avgWinR) - (lossP * avgLossR);

      return {
        name,
        tradesCount: count,
        winRate: Math.round(winRate * 10) / 10,
        totalPnl: Math.round(totalPnl * 100) / 100,
        expectancyR: Math.round(expectancyR * 100) / 100,
        status: isActive ? 'Active' : 'Idle',
      };
    };

    const currentRegime = this.getActiveRegime({
      forceRegime: settings.activeRegimeModule,
    }).regime;

    return {
      trend: calcStats('Trend Follower Module (Gold Momentum)', trendTrades, currentRegime === 'trend'),
      range: calcStats('Range Scalper Module (Mean Reverting)', rangeTrades, currentRegime === 'range'),
    };
  }
}
