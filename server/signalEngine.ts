/**
 * Server-side signal automation. Venue-agnostic.
 *
 * Replaces the manual TradingView webhook: on each confirmed candle the engine runs the
 * same evaluateSignal() the rest of the system uses, then either queues the trade for
 * one-click approval on the dashboard, or fires it straight at the active venue --
 * controlled by settings.autoMode (falling back to the legacy settings.mt5AutoMode).
 *
 * Two execution backends, selected by settings.activeBroker:
 *   - 'bybit' -> executeBybitSignal(), REST orders straight to the exchange (primary)
 *   - 'mt5'   -> executeMt5Signal(), queued to the MoebyBridge EA (kept for prop firms)
 * Both enforce the identical gate sequence: kill switch -> venue health -> no-stacking ->
 * fire lock -> central risk veto -> ATR stops.
 */
import { Database, TradingSettings, toVenueVolume } from './db.js';
import { BasketManager } from './basketManager.js';
import { CentralRiskManager } from './risk.js';
import { enqueueMt5Command, getBridgeStatus } from './mt5bridge.js';
import { BybitClient } from './bybit.js';
import { ExecutionShortfall } from './executionShortfall.js';
import { calculateATR } from './indicators.js';

/** Resolve the automation mode, tolerating the legacy MT5-only setting name. */
export function resolveAutoMode(s: TradingSettings): 'off' | 'approve' | 'auto' {
  const raw = (s as any).autoMode || (s as any).mt5AutoMode || 'off';
  return raw === 'approve' || raw === 'auto' ? raw : 'off';
}

/** Symbol the active venue expects for gold. */
export function venueSymbol(s: TradingSettings): string {
  return s.activeBroker === 'mt5' ? 'XAUUSD' : 'XAUUSDT';
}

// Guards against opening a second position before the heartbeat reflects the first one
// (heartbeat lags ~20s). Combined with the open-positions check, enforces one at a time.
let lastFireAt = 0;
const FIRE_LOCK_MS = 45 * 1000;

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
  if (!s.isCircuitBreakerActive) return;

  // Read equity from whichever venue is active. Bybit is the primary route; MT5 is kept
  // for prop-firm accounts. If equity is unreadable we simply skip this tick (never guess).
  let equity: number | null = null;
  let lastPrice = 0;
  let bybitClient: BybitClient | null = null;

  if (s.activeBroker === 'mt5') {
    const bridge = getBridgeStatus();
    if (!bridge.connected || bridge.equity == null || bridge.equity <= 0) return;
    equity = bridge.equity;
    lastPrice = bridge.price ?? 0;
  } else {
    if (!s.bybitApiKey || !s.bybitApiSecret) return;
    try {
      bybitClient = new BybitClient({
        apiKey: s.bybitApiKey,
        apiSecret: s.bybitApiSecret,
        environment: s.bybitEnvironment,
      });
      const wallet = await bybitClient.getWalletBalance();
      if (!wallet || !Number.isFinite(wallet.balance) || wallet.balance <= 0) return;
      equity = wallet.balance;
    } catch {
      return; // transient API failure — do not trip on missing data
    }
  }
  if (equity == null || equity <= 0) return;

  const todayKey = new Date().toISOString().slice(0, 10);
  if (todayKey !== cbDayKey) {
    // New day: reset the high-water reference to the current equity.
    cbDayKey = todayKey;
    cbDayStartEquity = equity;
    cbTrippedToday = false;
    return;
  }
  if (cbTrippedToday) return;

  const dd = s.maxDrawdownPercent > 0 ? s.maxDrawdownPercent : 5;
  const floor = cbDayStartEquity * (1 - dd / 100);
  if (equity > floor) return;

  // Breach: flatten everything and halt new entries.
  cbTrippedToday = true;
  const symbol = venueSymbol(s);
  let flattenNote = '';

  if (s.activeBroker === 'mt5') {
    enqueueMt5Command({ action: 'FLATTEN', symbol, comment: 'circuit breaker' });
    flattenNote = 'Flatten command queued to the MT5 bridge.';
  } else if (bybitClient) {
    // Close every open position with reduce-only market orders.
    try {
      const positions = await bybitClient.getPositions(symbol);
      const live = (positions || []).filter(p => Math.abs(Number(p.size || 0)) > 0);
      for (const p of live) {
        await bybitClient.placeOrder({
          symbol: p.symbol || symbol,
          side: String(p.side).toLowerCase() === 'buy' ? 'Sell' : 'Buy',
          qty: String(Math.abs(Number(p.size))),
          orderType: 'Market',
          reduceOnly: true,
          orderLinkId: `CB-${Date.now().toString(36)}`,
        });
      }
      flattenNote = `Closed ${live.length} Bybit position(s) with reduce-only market orders.`;
    } catch (e: any) {
      flattenNote = `WARNING: failed to flatten Bybit positions (${e.message || e}) — kill switch still engaged, close manually.`;
      console.error('[CircuitBreaker] Bybit flatten failed:', e);
    }
  }

  const updated = { ...s, isKillSwitchActive: true };
  Database.save({ ...db, settings: updated });

  Database.addLog({
    rawBody: { equity, dayStart: cbDayStartEquity, floor, drawdownPercent: dd, venue: s.activeBroker },
    status: 'execution_failed',
    action: 'close',
    symbol,
    price: lastPrice,
    quantity: 0,
    message: `[CircuitBreaker] TRIPPED — equity $${equity.toFixed(2)} breached the ${dd}% drawdown floor ($${floor.toFixed(2)} from $${cbDayStartEquity.toFixed(2)}). ${flattenNote} Kill switch activated.`,
    mode: s.isPaperTrading ? 'paper' : 'live',
  });
  console.warn(`[CircuitBreaker] TRIPPED at equity ${equity} (floor ${floor.toFixed(2)}) on ${s.activeBroker}`);
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
  atr?: number;
}): Promise<ExecuteResult> {
  const { side, symbol, price, quantity, settings, reason, source, atr } = opts;
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

  // Gate 3: no stacking. One position at a time — refuse if the terminal already has one,
  // and hold a short local lock so a slow heartbeat can't let two fire back-to-back.
  if (bridge.positions && bridge.positions.length > 0) {
    return block(`a position is already open (${bridge.positions.length}) — not stacking`);
  }
  if (Date.now() - lastFireAt < FIRE_LOCK_MS) {
    return block('an order was just queued — waiting for the terminal to confirm before another');
  }

  // Gate 4: central risk veto (daily loss, exposure, etc.).
  const risk = await CentralRiskManager.evaluateTradeRisk({ symbol, side, quantity, price, settings });
  if (!risk.allowed) return block(risk.reason || 'central risk manager vetoed the trade');
  const finalQty = risk.modifiedQuantity !== undefined ? risk.modifiedQuantity : quantity;

  // Stops, matching the webhook path. Real ATR (when supplied) drives dynamic stops;
  // without it calculateDynamicStops falls back to honest static-percent stops.
  let sl: number | undefined;
  let tp: number | undefined;
  if (settings.isHybridStopsActive) {
    const stops = CentralRiskManager.calculateDynamicStops({
      price,
      side,
      settings,
      payloadAtr: atr,
      activeModule: settings.activeRegimeModule === 'range' ? 'range' : 'trend',
    });
    sl = stops.stopLossPrice;
    tp = stops.takeProfitPrice;
  }

  // finalQty is in OUNCES. MT5 order volume is in LOTS (1 lot = 100 oz for XAUUSD), so it
  // must be converted or the position is 100x the intended size.
  const lots = toVenueVolume(finalQty, symbol, 'mt5');
  if (!(lots > 0)) {
    return block(`computed size ${finalQty} oz rounds to ${lots} lots — below the broker's minimum, refusing to send`);
  }

  const cmd = enqueueMt5Command({
    action: side === 'buy' ? 'BUY' : 'SELL',
    symbol,
    volume: lots,
    sl,
    tp,
    price,
    comment: `moeby ${source}`,
  });

  lastFireAt = Date.now();
  Database.addLog({
    rawBody: { source, side, symbol, price, quantity: finalQty, lots, reason },
    status: 'success',
    action: side,
    symbol,
    price,
    quantity: finalQty,
    message: `[Signal:${source}] ${cmd.action} ${lots} lots (${finalQty} oz) ${symbol} queued (id ${cmd.id.slice(0, 8)}). SL ${sl ?? '—'} / TP ${tp ?? '—'}. ${reason}`,
    mode,
  });

  return { fired: true, message: `Queued ${cmd.action} ${finalQty} ${symbol}` };
}

/**
 * Execute a directional signal on Bybit, enforcing the same gates as the MT5 path.
 * Primary execution route now that trading is personal-account (no prop firm).
 */
export async function executeBybitSignal(opts: {
  side: 'buy' | 'sell';
  symbol: string;
  price: number;
  quantity: number;
  settings: TradingSettings;
  reason: string;
  source: 'auto' | 'approved';
  atr?: number;
}): Promise<ExecuteResult> {
  const { side, symbol, price, quantity, settings, reason, source, atr } = opts;
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

  // Gate 2: venue health — credentials must exist before we can touch the exchange.
  if (!settings.bybitApiKey || !settings.bybitApiSecret) {
    return block('Bybit API credentials are not configured');
  }
  const client = new BybitClient({
    apiKey: settings.bybitApiKey,
    apiSecret: settings.bybitApiSecret,
    environment: settings.bybitEnvironment,
  });

  // Gate 3: no stacking. Fail CLOSED — if we cannot read positions we must not fire,
  // otherwise a transient API error would let us pile into an existing position.
  let openPositions: any[];
  try {
    openPositions = await client.getPositions(symbol);
  } catch (e: any) {
    return block(`could not verify open positions (${e.message || e}) — refusing to fire`);
  }
  const live = (openPositions || []).filter(p => Math.abs(Number(p.size || 0)) > 0);
  if (live.length > 0) {
    return block(`a position is already open (${live.length}) — not stacking`);
  }
  if (Date.now() - lastFireAt < FIRE_LOCK_MS) {
    return block('an order was just placed — waiting for the exchange to confirm before another');
  }

  // Gate 4: central risk veto (daily loss, exposure, etc.).
  const risk = await CentralRiskManager.evaluateTradeRisk({ symbol, side, quantity, price, settings });
  if (!risk.allowed) return block(risk.reason || 'central risk manager vetoed the trade');
  const finalQty = risk.modifiedQuantity !== undefined ? risk.modifiedQuantity : quantity;

  // Stops: real ATR drives volatility-adaptive stops; calculateDynamicStops falls back to
  // honest static-percent stops when no ATR is available (never fabricates volatility).
  let sl: number | undefined;
  let tp: number | undefined;
  let stopsReason = 'Hybrid stops disabled — no SL/TP attached.';
  if (settings.isHybridStopsActive) {
    const stops = CentralRiskManager.calculateDynamicStops({
      price,
      side,
      settings,
      payloadAtr: atr,
      activeModule: settings.activeRegimeModule === 'range' ? 'range' : 'trend',
    });
    sl = stops.stopLossPrice;
    tp = stops.takeProfitPrice;
    stopsReason = stops.reason;
  }

  try {
    const order = await client.placeOrder({
      symbol,
      side: side === 'buy' ? 'Buy' : 'Sell',
      qty: String(finalQty),
      orderType: 'Market',
      stopLoss: sl !== undefined ? String(sl) : undefined,
      takeProfit: tp !== undefined ? String(tp) : undefined,
      orderLinkId: `AUTO-${Date.now().toString(36)}`,
    });

    lastFireAt = Date.now();

    // Measure the REAL fill: compare the signal price against the average price the
    // exchange actually filled at. Best-effort — a failure here must never affect the trade.
    let fillNote = '';
    try {
      await new Promise(r => setTimeout(r, 1200)); // let the market order settle
      const after = await client.getPositions(symbol);
      const live = (after || []).find(p => Math.abs(Number(p.size || 0)) > 0);
      const avg = Number(live?.avgPrice);
      if (Number.isFinite(avg) && avg > 0) {
        const shf = ExecutionShortfall.recordFill({
          symbol,
          module: settings.activeRegimeModule === 'range' ? 'range' : 'trend',
          side: side === 'buy' ? 'BUY' : 'SELL',
          signalPrice: price,
          fillPrice: avg,
          quantity: finalQty,
          executionType: 'MarketEscalation_Taker',
        });
        if (shf) fillNote = ` Filled @ ${avg} (shortfall ${shf.shortfallTicks} ticks / $${shf.shortfallUsd}).`;
      }
    } catch { /* measurement is best-effort */ }

    Database.addLog({
      rawBody: { source, side, symbol, price, quantity: finalQty, reason },
      status: 'success',
      action: side,
      symbol,
      price,
      quantity: finalQty,
      message: `[Signal:${source}] ${side.toUpperCase()} ${finalQty} ${symbol} sent to Bybit (${settings.bybitEnvironment || 'demo'}, order ${order?.orderId?.slice?.(0, 8) || 'n/a'}). SL ${sl ?? '—'} / TP ${tp ?? '—'}.${fillNote} ${stopsReason} ${reason}`,
      mode,
    });
    return { fired: true, message: `Placed ${side.toUpperCase()} ${finalQty} ${symbol} on Bybit` };
  } catch (e: any) {
    return block(`Bybit rejected the order: ${e.message || e}`);
  }
}

/** Route a signal to whichever venue is active. */
export async function executeSignal(opts: {
  side: 'buy' | 'sell';
  symbol: string;
  price: number;
  quantity: number;
  settings: TradingSettings;
  reason: string;
  source: 'auto' | 'approved';
  atr?: number;
}): Promise<ExecuteResult> {
  return opts.settings.activeBroker === 'mt5'
    ? executeMt5Signal(opts)
    : executeBybitSignal(opts);
}

// Real ATR(14) from the evaluation klines, for volatility-adaptive stops.
function atrFromKlines(klines: any[]): number | undefined {
  if (!klines || klines.length < 15) return undefined;
  const highs = klines.map(k => Number(k.high));
  const lows = klines.map(k => Number(k.low));
  const closes = klines.map(k => Number(k.close));
  const arr = calculateATR(highs, lows, closes, 14);
  const last = arr[arr.length - 1];
  return Number.isFinite(last) && last > 0 ? last : undefined;
}

/**
 * Run one evaluation on a freshly confirmed candle. Called from the background poll loop.
 * candleMinutes is the interval the klines represent, used for cooldown and the reason text.
 */
export async function runSignalEngine(klines: any[], settings: TradingSettings, candleTime: number, candleMinutes = 5) {
  // A pending signal is stale after ~3 candles; scale expiry with the interval.
  const ttlMs = candleMinutes * 3 * 60 * 1000;
  Database.expirePendingSignals(ttlMs);

  const autoMode = resolveAutoMode(settings);
  if (autoMode === 'off') return;
  if (!klines || klines.length < 30) return;

  const signal = BasketManager.evaluateSignal(klines, settings);
  if (signal === 'NONE') return;

  const side: 'buy' | 'sell' = signal === 'BUY' ? 'buy' : 'sell';

  // Debounce repeated same-direction signals: hold off for ~4 candles.
  const cooldownMs = candleMinutes * 4 * 60 * 1000;
  if (lastSide === side && candleTime - lastCandleTime < cooldownMs) return;

  const price = Number(klines[klines.length - 1].close);
  const symbol = venueSymbol(settings);
  const quantity = settings.defaultOrderSize || 0.1;
  const atr = atrFromKlines(klines);
  const reason = `${signal} from live ${candleMinutes}m evaluation (RSI / %B / VWAP, ADX-gated)`;

  // SHADOW GATE. This must live here, in the path the autonomous loop actually runs.
  // StrategyRouter has its own shadow check but nothing calls StrategyRouter.evaluateSignals,
  // so gating only there would silently let a "shadowed" strategy keep trading.
  //
  // The live engine evaluates one strategy, labelled by activeRegimeModule. Shadowing it
  // records every signal it would have taken — entry, stops, targets — without sending an
  // order, so it accrues a genuine out-of-sample record on live data at zero risk.
  const activeModule = settings.activeRegimeModule === 'range' ? 'range' : 'trend';
  if ((settings.shadowModules || []).includes(activeModule)) {
    const stops = CentralRiskManager.calculateDynamicStops({
      price, side, settings, payloadAtr: atr,
      activeModule: activeModule === 'range' ? 'range' : 'trend',
    });
    Database.addLog({
      rawBody: { shadow: true, module: activeModule, side, symbol, price, quantity, atr, reason },
      status: 'shadow',
      action: side,
      symbol,
      price,
      quantity,
      message: `[SHADOW:${activeModule}] ${side.toUpperCase()} ${quantity} ${symbol} @ ${price} — recorded, NOT executed. SL ${stops.stopLossPrice} / TP ${stops.takeProfitPrice}. ${reason}`,
      mode: settings.isPaperTrading ? 'paper' : 'live',
    });
    console.log(`[SignalEngine] SHADOW ${side} @ ${price} — logged, not executed`);
    lastSide = side;
    lastCandleTime = candleTime;
    return;
  }

  if (autoMode === 'approve') {
    // Surface for one-click firing; avoid stacking duplicates of the same side.
    const dup = Database.getPendingSignals().some(s => s.side === side);
    if (!dup) {
      Database.addPendingSignal({ side, symbol, price, quantity, reason, atr });
      console.log(`[SignalEngine] Pending ${side} signal created for approval at ${price}`);
    }
    lastSide = side;
    lastCandleTime = candleTime;
    return;
  }

  // autoMode === 'auto'
  const result = await executeSignal({ side, symbol, price, quantity, settings, reason, source: 'auto', atr });
  console.log(`[SignalEngine] auto ${side} @ ${price}: ${result.fired ? 'FIRED' : 'blocked'} — ${result.message}`);
  if (result.fired) {
    lastSide = side;
    lastCandleTime = candleTime;
  }
}
