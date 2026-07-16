import { Database, ClosedTrade, TradingSettings } from './db.js';
import { QuantDataManager } from './quantData.js';
import { calculateBollingerBands, calculateATR, calculateRSI } from './indicators.js';

export interface SpecialistModule {
  name: string;
  id: 'trend' | 'reversion' | 'funding_fade' | 'squeeze_breakout';
  enabled: boolean;
  expectancyR: number; // Expectancy in R-units (average reward relative to initial stop risk)
  winRate: number;
  kellyFraction: number; // recomputed quarterly Kelly %
  status: 'ACTIVE' | 'SHADOW' | 'DISABLED';
}

export interface RouterSignal {
  symbol: string;
  side: 'BUY' | 'SELL';
  module: SpecialistModule['id'];
  price: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  reason: string;
}

export class StrategyRouter {
  /**
   * Evaluates incoming candle data and decides which specialist module should trigger.
   * Enforces the deadband guard: no two conflicting modules fire on the same candle.
   */
  public static async evaluateSignals(symbol: string, klines: any[]): Promise<RouterSignal | null> {
    if (klines.length < 30) {
      return null;
    }

    const db = Database.get();
    const settings = db.settings;

    // 1. Tag our candles with indicators, macro indices, and regime tags
    const taggedKlines = await QuantDataManager.enrichAndTagKlines(symbol, klines);
    const curr = taggedKlines[taggedKlines.length - 1];
    const prev = taggedKlines[taggedKlines.length - 2];

    const currentRegime = curr.regime; // 'trend' | 'range' | 'compressed' | 'funding_extreme' | 'neutral'
    
    // Read module parameters/toggles from db
    const modules = this.getModulesStatus();

    // 2. CHECK DEAD-MAN SWITCH
    const isDeadManActive = false; // Mock dead-man status checking. If MT5 bridge drops heartbeat, all entries blocked.

    // 3. SPECIALIST 1: Funding Extreme Fade
    const fundingFadeMod = modules.find(m => m.id === 'funding_fade');
    if (fundingFadeMod && fundingFadeMod.enabled && currentRegime === 'funding_extreme') {
      const isExtremePositive = curr.fundingPercentile > 90;
      const isExtremeNegative = curr.fundingPercentile < 10;

      const stopLossDist = curr.atr * 2.0;
      const tpDist = curr.atr * 3.5;

      const qty = this.calculateFractionalKellySize('funding_fade', settings, curr.atr);

      if (isExtremePositive) {
        // Fade the crowded buyers (Short entry)
        return {
          symbol,
          side: 'SELL',
          module: 'funding_fade',
          price: curr.close,
          stopLoss: curr.close + stopLossDist,
          takeProfit: curr.close - tpDist,
          quantity: qty,
          reason: `Funding Fade: Extreme positive funding rate percentile (${curr.fundingPercentile.toFixed(1)}%). Fading crowded buyers.`,
        };
      } else if (isExtremeNegative) {
        // Fade the crowded sellers (Long entry)
        return {
          symbol,
          side: 'BUY',
          module: 'funding_fade',
          price: curr.close,
          stopLoss: curr.close - stopLossDist,
          takeProfit: curr.close + tpDist,
          quantity: qty,
          reason: `Funding Fade: Extreme negative funding rate percentile (${curr.fundingPercentile.toFixed(1)}%). Fading crowded sellers.`,
        };
      }
    }

    // 4. SPECIALIST 2: Squeeze Breakout (Compression Breakout)
    const squeezeMod = modules.find(m => m.id === 'squeeze_breakout');
    if (squeezeMod && squeezeMod.enabled && currentRegime === 'compressed') {
      const bb = curr.bb;
      const prevBb = prev.bb;

      const brokeAboveUpper = prev.close <= prevBb.upper && curr.close > bb.upper;
      const brokeBelowLower = prev.close >= prevBb.lower && curr.close < bb.lower;

      const stopLossDist = curr.atr * 1.5;
      const tpDist = curr.atr * 3.0;

      const qty = this.calculateFractionalKellySize('squeeze_breakout', settings, curr.atr);

      if (brokeAboveUpper) {
        return {
          symbol,
          side: 'BUY',
          module: 'squeeze_breakout',
          price: curr.close,
          stopLoss: curr.close - stopLossDist,
          takeProfit: curr.close + tpDist,
          quantity: qty,
          reason: `Compression Squeeze: Volatility bandwidth compressed into bottom 10th-percentile (${curr.bandwidthPercentile.toFixed(1)}%). Breakout LONG triggered.`,
        };
      } else if (brokeBelowLower) {
        return {
          symbol,
          side: 'SELL',
          module: 'squeeze_breakout',
          price: curr.close,
          stopLoss: curr.close + stopLossDist,
          takeProfit: curr.close - tpDist,
          quantity: qty,
          reason: `Compression Squeeze: Volatility bandwidth compressed into bottom 10th-percentile (${curr.bandwidthPercentile.toFixed(1)}%). Breakout SHORT triggered.`,
        };
      }
    }

    // 5. SPECIALIST 3: Trend Follower (High Momentum)
    const trendMod = modules.find(m => m.id === 'trend');
    if (trendMod && trendMod.enabled && currentRegime === 'trend') {
      // SMA Cross or simple high-momentum continuation
      const isBullishMomentum = curr.close > curr.bb.middle && prev.close <= prev.bb.middle;
      const isBearishMomentum = curr.close < curr.bb.middle && prev.close >= prev.bb.middle;

      const stopLossDist = curr.atr * 2.0;
      const tpDist = curr.atr * 4.0;

      const qty = this.calculateFractionalKellySize('trend', settings, curr.atr);

      if (isBullishMomentum) {
        return {
          symbol,
          side: 'BUY',
          module: 'trend',
          price: curr.close,
          stopLoss: curr.close - stopLossDist,
          takeProfit: curr.close + tpDist,
          quantity: qty,
          reason: `Trend Following: Momentum routed with ADX ${curr.adx.toFixed(1)} >= 25 (Trend active). Entering LONG on Middle BB Breakout.`,
        };
      } else if (isBearishMomentum) {
        return {
          symbol,
          side: 'SELL',
          module: 'trend',
          price: curr.close,
          stopLoss: curr.close + stopLossDist,
          takeProfit: curr.close - tpDist,
          quantity: qty,
          reason: `Trend Following: Momentum routed with ADX ${curr.adx.toFixed(1)} >= 25 (Trend active). Entering SHORT on Middle BB Breakout.`,
        };
      }
    }

    // 6. SPECIALIST 4: Reversion Module (Managed bounded-ladder)
    // Runs when ADX < 20. Evaluated inside basketManager.ts. This router triggers signal alerts or schedules them.
    
    return null;
  }

  /**
   * Returns current performance stats and statuses for the narrow specialists
   */
  public static getModulesStatus(): SpecialistModule[] {
    const db = Database.get();
    const trades = db.trades || [];

    const getStats = (id: SpecialistModule['id'], name: string, defaultEnabled: boolean): SpecialistModule => {
      // Find historical trades executed by this module
      const moduleTrades = trades.filter((t: any) => t.module === id);
      const count = moduleTrades.length;

      let winRate = 0;
      let expectancyR = 0;
      let kellyFraction = 0.01; // default 1% size risk unit

      if (count > 0) {
        const wins = moduleTrades.filter(t => t.pnl > 0);
        winRate = (wins.length / count) * 100;

        const totalPnl = moduleTrades.reduce((sum, t) => sum + t.pnl, 0);
        const winP = wins.length / count;
        const lossP = 1 - winP;

        // expectancy in R multiples
        // fallback risk constant of $15 per Oz trade
        const winLossRatio = moduleTrades.reduce((sum, t) => sum + (t.pnl / 15.0), 0) / count;
        expectancyR = winLossRatio;

        // Calculate Kelly: W - [(1-W)/R] where R is win/loss ratio (avg win pnl / avg loss pnl)
        const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;
        const losses = moduleTrades.filter(t => t.pnl <= 0);
        const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 1;
        const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 0;

        if (payoffRatio > 0 && winP > 0) {
          const rawKelly = winP - ((1 - winP) / payoffRatio);
          // Quarter-Kelly Capped at 2% risk limit per trade
          kellyFraction = Math.max(0.005, Math.min(0.02, (rawKelly / 4.0)));
        }
      } else {
        // Fallbacks for zero trades
        winRate = 0;
        expectancyR = id === 'reversion' ? 0.35 : 0.20; // baseline EAs
        kellyFraction = 0.01; // 1% risk standard
      }

      // Check toggles (enable states)
      let enabled = defaultEnabled;
      if (id === 'reversion') {
        enabled = db.settings.reversion?.enabled ?? false;
      } else if (id === 'trend') {
        enabled = db.settings.activeRegimeModule === 'trend' || db.settings.activeRegimeModule === 'auto';
      } else {
        // Other new modules defaults are enabled for demonstration
        enabled = true;
      }

      return {
        name,
        id,
        enabled,
        expectancyR: Math.round(expectancyR * 100) / 100,
        winRate: Math.round(winRate * 10) / 10,
        kellyFraction: Math.round(kellyFraction * 1000) / 10, // show as % of balance (e.g. 1.2%)
        status: enabled ? 'ACTIVE' : 'DISABLED',
      };
    };

    return [
      getStats('trend', 'Momentum Trend Specialist (ADX >= 25)', true),
      getStats('reversion', 'Bounded Reversion Specialist (ADX < 20)', false),
      getStats('funding_fade', 'Bybit Funding-Extreme Fader', true),
      getStats('squeeze_breakout', 'Compression Breakout Specialist', true),
    ];
  }

  /**
   * Dynamic fractional-Kelly lot sizing
   */
  private static calculateFractionalKellySize(moduleId: SpecialistModule['id'], settings: TradingSettings, atr: number): number {
    const modules = this.getModulesStatus();
    const mod = modules.find(m => m.id === moduleId);
    const riskPercent = mod ? mod.kellyFraction : 1.0; // risk percent (e.g., 1.2%)

    // Default account balance estimate (e.g., 10000 USD)
    const balance = 10000;
    const riskDollars = balance * (riskPercent / 100);

    // Stop distance is mapped to 2x ATR for size scaling (volatility targeting)
    const slDistance = atr * 2.0;
    const lotSize = riskDollars / (slDistance * 10); // contract value divisor
    
    // lot constraints
    const rounded = Math.round(lotSize * 100) / 100;
    return Math.max(0.01, Math.min(settings.maxPositionSize || 1.0, rounded));
  }
}
