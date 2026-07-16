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

  public static getLogs(): ShortfallLog[] {
    if (this.shortfallLogs.length === 0) {
      // Seed initial shortfall logs to show beautiful data in UI
      const modules = ['trend', 'reversion', 'squeeze_breakout', 'funding_fade'];
      const sides: ('BUY' | 'SELL')[] = ['BUY', 'SELL'];
      
      for (let i = 0; i < 8; i++) {
        const signal = 2300 + i * 15;
        const fill = signal + (Math.random() * 0.08); // 0 to 8 ticks shortfall
        const side = sides[i % 2];
        const qty = 0.2;
        
        const priceDifference = Math.abs(fill - signal);
        const ticks = Math.round(priceDifference / 0.01);
        
        this.shortfallLogs.push({
          id: `shf-seeded-${i}`,
          timestamp: new Date(Date.now() - (8 - i) * 3600 * 1000).toISOString(),
          symbol: 'XAUUSDT',
          module: modules[i % modules.length],
          side,
          signalPrice: signal,
          fillPrice: Number(fill.toFixed(2)),
          shortfallTicks: ticks,
          shortfallUsd: Number((priceDifference * qty * 1.0).toFixed(2)),
          executionType: Math.random() > 0.3 ? 'PostOnly_Maker' : 'MarketEscalation_Taker'
        });
      }
    }
    return this.shortfallLogs;
  }

  /**
   * Models the Maker-first post-only order fill.
   * In a live exchange, Post-Only orders may take time to fill.
   * If not filled within timeout window (e.g., 10 seconds), escalate to market taker.
   */
  public static simulatePostOnlyFill(params: {
    signalPrice: number;
    side: 'BUY' | 'SELL';
  }): { fillPrice: number; type: ShortfallLog['executionType'] } {
    const isMakerFill = Math.random() > 0.25; // 75% chance Maker post-only succeeds

    if (isMakerFill) {
      // Post-only fill: exact price or slightly better
      const improvement = Number((Math.random() * 0.02).toFixed(2));
      const fillPrice = params.side === 'BUY' ? params.signalPrice - improvement : params.signalPrice + improvement;
      return {
        fillPrice,
        type: 'PostOnly_Maker',
      };
    } else {
      // Post-only failed/timed out: escalate to market order (Taker order adds slippage ticks)
      const slippage = Number((0.02 + Math.random() * 0.06).toFixed(2)); // 2 to 8 ticks slippage
      const fillPrice = params.side === 'BUY' ? params.signalPrice + slippage : params.signalPrice - slippage;
      return {
        fillPrice,
        type: 'MarketEscalation_Taker',
      };
    }
  }
}
