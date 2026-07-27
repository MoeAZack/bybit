import { Database } from './db.js';

export interface ShortfallLog {
  id: string;
  timestamp: string;
  symbol: string;
  module: string;
  side: 'BUY' | 'SELL';
  signalPrice: number;
  fillPrice: number;
  shortfallTicks: number; // in $0.01 ticks
  shortfallUsd: number;
  executionType: 'PostOnly_Maker' | 'MarketEscalation_Taker';
}

export class ExecutionShortfall {
  private static shortfallLogs: ShortfallLog[] = [];

  /**
   * Logs execution shortfall on trade fill.
   */
  public static logShortfall(params: {
    symbol: string;
    module: string;
    side: 'BUY' | 'SELL';
    signalPrice: number;
    fillPrice: number;
    quantity: number;
    executionType: ShortfallLog['executionType'];
  }): ShortfallLog {
    const { symbol, module, side, signalPrice, fillPrice, quantity, executionType } = params;

    // Tick calculations (XAUUSDT tick size is $0.01)
    const priceDifference = Math.abs(fillPrice - signalPrice);
    const shortfallTicks = Math.round((priceDifference / 0.01) * 100) / 100;
    
    // Shortfall in dollar terms: quantity * price difference * contract multiplier
    const shortfallUsd = Math.round(priceDifference * quantity * 1.0 * 100) / 100;

    const log: ShortfallLog = {
      id: 'shf-' + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      symbol,
      module,
      side,
      signalPrice,
      fillPrice,
      shortfallTicks,
      shortfallUsd,
      executionType,
    };

    this.shortfallLogs.push(log);
    
    // Limit to last 100 logs
    if (this.shortfallLogs.length > 100) {
      this.shortfallLogs.shift();
    }

    return log;
  }

  /**
   * Real measured fills only.
   *
   * This previously seeded eight fabricated entries ("to show beautiful data in UI") at
   * 2300-2405 gold prices whenever the list was empty, so the Quant Terminal displayed
   * invented execution quality as if it had been measured. An empty list now means
   * "nothing measured yet", which is the truth until the bot fills an order.
   */
  public static getLogs(): ShortfallLog[] {
    return this.shortfallLogs;
  }

  /**
   * Record a real fill: compare the price the signal was generated at against the average
   * price the exchange actually filled at. Positive shortfall = we paid worse than signal.
   */
  public static recordFill(params: {
    symbol: string;
    module: string;
    side: 'BUY' | 'SELL';
    signalPrice: number;
    fillPrice: number;
    quantity: number;
    executionType: ShortfallLog['executionType'];
  }): ShortfallLog | null {
    if (!Number.isFinite(params.signalPrice) || !Number.isFinite(params.fillPrice)) return null;
    if (params.signalPrice <= 0 || params.fillPrice <= 0) return null;
    return this.logShortfall(params);
  }

  public static summary(): { count: number; avgTicks: number | null; avgUsd: number | null; makerRate: number | null } {
    const n = this.shortfallLogs.length;
    if (n === 0) return { count: 0, avgTicks: null, avgUsd: null, makerRate: null };
    const avgTicks = this.shortfallLogs.reduce((a, l) => a + l.shortfallTicks, 0) / n;
    const avgUsd = this.shortfallLogs.reduce((a, l) => a + l.shortfallUsd, 0) / n;
    const makers = this.shortfallLogs.filter(l => l.executionType === 'PostOnly_Maker').length;
    return {
      count: n,
      avgTicks: Math.round(avgTicks * 100) / 100,
      avgUsd: Math.round(avgUsd * 100) / 100,
      makerRate: Math.round((makers / n) * 1000) / 10,
    };
  }
}
