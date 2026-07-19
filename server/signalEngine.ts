/**
 * Server-side signal automation for MT5.
 *
 * Replaces the manual TradingView webhook: on each confirmed candle the engine runs the
 * same evaluateSignal() the rest of the system uses, then either queues the trade for
 * one-click approval on the dashboard, or fires it straight to the bridge -- controlled by
 * settings.mt5AutoMode. Both paths go through the same risk gates as the webhook.
 */
import { Database, TradingSettings } from './db.js';
import { BasketManager } from './basketManager.js';
import { CentralRiskManager } from './risk.js';
import { enqueueMt5Command, getBridgeStatus } from './mt5bridge.js';

// Debounce: remember the last fired side and candle so we do not re-enter the same
// direction on every confirmed bar. Cooldown scales with the candle interval (a few bars).
let lastSide: 'buy' | 'sell' | null = null;
let lastCandleTime = 0;

export interface ExecuteResult {
  fired: boolean;
  message: string;
}

// Circuit-breaker state: the day's starting equity and whether we've already tripped today.
let cbDayKey = '';
let cbDayStartEquity = 0;
let cbTrippedToday = false;

/**
 * Intraday equity circuit breaker. Flattens all positions and trips the kill switch when
 * equity draws down past the configured percentage from the day's starting equity. Runs
 * independently of the signal engine so it protects manual and webhook trades too.
 */
export async function checkCircuitBreaker() {
  const db = Database.get();
  const s = db.settings;
  if (s.activeBroker !== 'mt5' || !s.isCircuitBreakerActive) return;

  const bridge = getBridgeStatus();
  if (!bridge.connected || bridge.equity == null || bridge.equity <= 0) return;

  const todayKey = new Date().toISOString().slice(0, 10);
  if (todayKey !== cbDayKey) {
    // New day: reset the high-water reference to the current equity.
    cbDayKey = todayKey;
    cbDayStartEquity = bridge.equity;
    cbTrippedToday = false;
    return;
  }
  if (cbTrippedToday) return;

  const dd = s.maxDrawdownPercent > 0 ? s.maxDrawdownPercent : 5;
  const floor = cbDayStartEquity * (1 - dd / 100);
  if (bridge.equity > floor) return;

  // Breach: flatten everything and halt new entries.
  cbTrippedToday = true;
  enqueueMt5Command({ action: 'FLATTEN', symbol: 'XAUUSD', comment: 'circuit breaker' });
  const updated = { ...s, isKillSwitchActive: true };
  Database.save({ ...db, settings: updated });

  Database.addLog({
    rawBody: { equity: bridge.equity, dayStart: cbDayStartEquity, floor, drawdownPercent: dd },
    status: 'execution_failed',
    action: 'close',
    symbol: 'XAUUSD',
    price: bridge.price ?? 0,
    quantity: 0,
    message: `[CircuitBreaker] TRIPPED — equity $${bridge.equity.toFixed(2)} breached the ${dd}% drawdown floor ($${floor.toFixed(2)} from $${cbDayStartEquity.toFixed(2)}). Flattened all positions and activated kill switch.`,
    mode: s.isPaperTrading ? 'paper' : 'live',
  });
  console.warn(`[CircuitBreaker] TRIPPED at equity ${bridge.equity} (floor ${floor.toFixed(2)})`);
}

/**
 * Execute a directional signal on the MT5 bridge, enforcing every gate. Shared by the
 * autonomous path and by manual approval, so both behave identically.
 */
export async function executeMt5Signal(opts: {
  side: 'buy' | 'sell';
  symbol: string;
  price: number;
  quantity: number;
  settings: TradingSettings;
  reason: string;
  source: 'auto' | 'approved';
}): Promise<ExecuteResult> {
  const { side, symbol, price, quantity, settings, reason, source } = opts;
  const mode = settings.isPaperTrading ? 'paper' : 'live';

  const block = (message: string): ExecuteResult => {
    Database.addLog({
      rawBody: { source, side, symbol, price, quantity, reason },
      status: 'execution_failed',
      action: side,
      symbol,
      price,
      quantity,
      message: `[Signal:${source}] BLOCKED — ${message}`,
      mode,
    });
    return { fired: false, message };
  };

  // Gate 1: kill switch.
  if (settings.isKillSwitchActive) return block('kill switch is active');

  // Gate 2: bridge must be connected. (The EA additionally rejects when disarmed.)
  const bridge = getBridgeStatus();
  if (!bridge.connected) return block('MT5 bridge is not connected (no recent heartbeat)');
  if (!bridge.armed) return block('MT5 bridge is DISARMED on the terminal');

  // Gate 3: central risk veto (daily loss, exposure, etc.).
  const risk = await CentralRiskManager.evaluateTradeRisk({ symbol, side, quantity, price, settings });
  if (!risk.allowed) return block(risk.reason || 'central risk manager vetoed the trade');
  const finalQty = risk.modifiedQuantity !== undefined ? risk.modifiedQuantity : quantity;

  // Stops, matching the webhook path.
  let sl: number | undefined;
  let tp: number | undefined;
  if (settings.isHybridStopsActive) {
    const stops = CentralRiskManager.calculateDynamicStops({
      price,
      side,
      settings,
      activeModule: settings.activeRegimeModule === 'range' ? 'range' : 'trend',
    });
    sl = stops.stopLossPrice;
    tp = stops.takeProfitPrice;
  }

  const cmd = enqueueMt5Command({
    action: side === 'buy' ? 'BUY' : 'SELL',
    symbol,
    volume: finalQty,
    sl,
    tp,
    price,
    comment: `moeby ${source}`,
  });

  Database.addLog({
    rawBody: { source, side, symbol, price, quantity: finalQty, reason },
    status: 'success',
    action: side,
    symbol,
    price,
    quantity: finalQty,
    message: `[Signal:${source}] ${cmd.action} ${finalQty} ${symbol} queued (id ${cmd.id.slice(0, 8)}). SL ${sl ?? '—'} / TP ${tp ?? '—'}. ${reason}`,
    mode,
  });

  return { fired: true, message: `Queued ${cmd.action} ${finalQty} ${symbol}` };
}

/**
 * Run one evaluation on a freshly confirmed candle. Called from the background poll loop.
 * candleMinutes is the interval the klines represent, used for cooldown and the reason text.
 */
export async function runSignalEngine(klines: any[], settings: TradingSettings, candleTime: number, candleMinutes = 5) {
  // A pending signal is stale after ~3 candles; scale expiry with the interval.
  const ttlMs = candleMinutes * 3 * 60 * 1000;
  Database.expirePendingSignals(ttlMs);

  if (settings.activeBroker !== 'mt5') return;
  const autoMode = settings.mt5AutoMode || 'off';
  if (autoMode === 'off') return;
  if (!klines || klines.length < 30) return;

  const signal = BasketManager.evaluateSignal(klines, settings);
  if (signal === 'NONE') return;

  const side: 'buy' | 'sell' = signal === 'BUY' ? 'buy' : 'sell';

  // Debounce repeated same-direction signals: hold off for ~4 candles.
  const cooldownMs = candleMinutes * 4 * 60 * 1000;
  if (lastSide === side && candleTime - lastCandleTime < cooldownMs) return;

  const price = Number(klines[klines.length - 1].close);
  const symbol = 'XAUUSD';
  const quantity = settings.defaultOrderSize || 0.1;
  const reason = `${signal} from live ${candleMinutes}m evaluation (RSI / %B / VWAP, ADX-gated)`;

  if (autoMode === 'approve') {
    // Surface for one-click firing; avoid stacking duplicates of the same side.
    const dup = Database.getPendingSignals().some(s => s.side === side);
    if (!dup) {
      Database.addPendingSignal({ side, symbol, price, quantity, reason });
      console.log(`[SignalEngine] Pending ${side} signal created for approval at ${price}`);
    }
    lastSide = side;
    lastCandleTime = candleTime;
    return;
  }

  // autoMode === 'auto'
  const result = await executeMt5Signal({ side, symbol, price, quantity, settings, reason, source: 'auto' });
  console.log(`[SignalEngine] auto ${side} @ ${price}: ${result.fired ? 'FIRED' : 'blocked'} — ${result.message}`);
  if (result.fired) {
    lastSide = side;
    lastCandleTime = candleTime;
  }
}
