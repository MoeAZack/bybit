import fs from 'fs';
import path from 'path';
import { Database, TradingSettings, getContractMultiplier, ClosedTrade } from './db.js';
import { BybitClient } from './bybit.js';
import { CentralRiskManager } from './risk.js';
import { isWithinTier1Blackout } from './newsCalendar.js';
import { calculateRSI, calculateATR, calculateADXArray, calculateBollingerBands, calculateSessionVWAP } from './indicators.js';

export interface ReversionBasket {
  basketId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  maxRungs: number;
  rungSpacingAtr: number;
  stopBeyondLastRungAtr: number;
  basketRiskUsd: number;
  atr: number;
  p0: number; // Rung 1 entry price
  q: number; // Quantity per rung
  worstCaseLoss: number;
  rungPrices: number[]; // rung prices [r1, r2, r3]
  stopLossPrice: number; // basket stop price
  tpTargetPrice: number; // take profit price (dynamically updated)
  rungsFilled: boolean[]; // [r1Filled, r2Filled, r3Filled]
  rungsOrderIds: (string | null)[]; // [r1OrderId, r2OrderId, r3OrderId]
  stopLossOrderId: string | null;
  takeProfitOrderId: string | null;
  status: 'ACTIVE' | 'CLOSED';
  entryTime: string;
  barsHeld: number; // Count of confirmed candles since R1 fill
}

const BASKET_FILE = path.join(process.cwd(), 'data', 'reversion_basket.json');

export class BasketManager {
  private static activeBasket: ReversionBasket | null = null;

  static {
    this.loadBasketState();
  }

  public static loadBasketState() {
    try {
      if (fs.existsSync(BASKET_FILE)) {
        const content = fs.readFileSync(BASKET_FILE, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed && parsed.status === 'ACTIVE') {
          this.activeBasket = parsed;
          console.log(`[BasketManager] Restored active basket: ${parsed.basketId} for ${parsed.symbol}`);
        }
      }
    } catch (e) {
      console.error('[BasketManager] Failed to load basket state from disk:', e);
    }
  }

  private static saveBasketState() {
    try {
      const dir = path.dirname(BASKET_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (this.activeBasket) {
        fs.writeFileSync(BASKET_FILE, JSON.stringify(this.activeBasket, null, 2), 'utf-8');
      } else {
        if (fs.existsSync(BASKET_FILE)) {
          fs.writeFileSync(BASKET_FILE, JSON.stringify({ status: 'CLOSED' }), 'utf-8');
        }
      }
    } catch (e) {
      console.error('[BasketManager] Failed to save basket state to disk:', e);
    }
  }

  public static getActiveBasket(): ReversionBasket | null {
    return this.activeBasket;
  }

  /**
   * Helper to perform mathematical sizing of rungs and stop levels
   */
  public static calculateReversionSizing(params: {
    maxRungs: number;
    rungSpacingAtr: number;
    stopBeyondLastRungAtr: number;
    atr: number;
    basketRiskUsd: number;
    symbol: string;
    p0: number;
    side: 'BUY' | 'SELL';
  }): {
    q: number;
    worstCaseLoss: number;
    rungPrices: number[];
    stopLossPrice: number;
  } {
    const { maxRungs, rungSpacingAtr, stopBeyondLastRungAtr, atr, basketRiskUsd, symbol, p0, side } = params;
    const m = getContractMultiplier(symbol);
    const d = rungSpacingAtr * atr;
    const s = stopBeyondLastRungAtr * atr;

    let q = 0;
    if (maxRungs === 3) {
      q = basketRiskUsd / (m * 3 * (d + s));
    } else if (maxRungs === 2) {
      q = basketRiskUsd / (m * (d + 2 * s));
    } else {
      q = basketRiskUsd / (m * s);
    }

    // Round q DOWN to the symbol's qty step (Bybit XAUUSDT is 0.01)
    const qtyStep = 0.01;
    q = Math.floor(q / qtyStep) * qtyStep;
    q = Math.round(q * 100) / 100;

    const rungPrices: number[] = [];
    let stopLossPrice = 0;

    if (side === 'BUY') {
      for (let i = 0; i < maxRungs; i++) {
        rungPrices.push(Number((p0 - i * d).toFixed(2)));
      }
      stopLossPrice = Number((p0 - ((maxRungs - 1) * d + s)).toFixed(2));
    } else {
      for (let i = 0; i < maxRungs; i++) {
        rungPrices.push(Number((p0 + i * d).toFixed(2)));
      }
      stopLossPrice = Number((p0 + ((maxRungs - 1) * d + s)).toFixed(2));
    }

    // Calculate actual worstCaseLoss using rounded q
    let worstCaseLoss = 0;
    if (maxRungs === 3) {
      const lossR1 = q * m * (rungPrices[0] - stopLossPrice);
      const lossR2 = q * m * (rungPrices[1] - stopLossPrice);
      const lossR3 = q * m * (rungPrices[2] - stopLossPrice);
      worstCaseLoss = Math.abs(lossR1 + lossR2 + lossR3);
    } else if (maxRungs === 2) {
      const lossR1 = q * m * (rungPrices[0] - stopLossPrice);
      const lossR2 = q * m * (rungPrices[1] - stopLossPrice);
      worstCaseLoss = Math.abs(lossR1 + lossR2);
    } else {
      worstCaseLoss = Math.abs(q * m * (rungPrices[0] - stopLossPrice));
    }

    return {
      q,
      worstCaseLoss: Math.round(worstCaseLoss * 100) / 100,
      rungPrices,
      stopLossPrice
    };
  }

  /**
   * Evaluates if a signal candle satisfies the RSI + %B + VWAP triple confirmation
   */
  public static evaluateSignal(klines: any[], settings: TradingSettings): 'BUY' | 'SELL' | 'NONE' {
    const config = settings.reversion;
    if (klines.length < Math.max(config.rsiPeriod, config.bbPeriod, 30)) {
      return 'NONE';
    }

    const highs = klines.map(k => Number(k.high));
    const lows = klines.map(k => Number(k.low));
    const closes = klines.map(k => Number(k.close));
    const volumes = klines.map(k => Number(k.volume || k.vol || 1));
    const times = klines.map(k => new Date(k.time));

    // Confirm indicators
    const rsiArr = calculateRSI(closes, config.rsiPeriod);
    const bbArr = calculateBollingerBands(closes, config.bbPeriod, config.bbStdDev);
    const atrArr = calculateATR(highs, lows, closes, 14);

    const vwapInput = klines.map(k => ({
      time: new Date(k.time),
      high: Number(k.high),
      low: Number(k.low),
      close: Number(k.close),
      volume: Number(k.volume || k.vol || 1),
    }));
    const vwapArr = calculateSessionVWAP(vwapInput);

    const lastIdx = klines.length - 1; // Signal evaluates on confirmed candle
    const lastPrice = closes[lastIdx];
    const lastRsi = rsiArr[lastIdx];
    const lastBb = bbArr[lastIdx];
    const lastAtr = atrArr[lastIdx];
    const lastVwap = vwapArr[lastIdx];

    // Triple confirmation logic:
    // 1. RSI
    const rsiLong = lastRsi < config.rsiLongBelow;
    const rsiShort = lastRsi > config.rsiShortAbove;

    // 2. Bollinger %B
    const bbLong = lastBb.pctB <= 0;
    const bbShort = lastBb.pctB >= 1;

    // 3. VWAP Stretch: |price - VWAP| > vwapStretchAtr * ATR
    const vwapStretchDistance = config.vwapStretchAtr * lastAtr;
    const isVwapStretched = Math.abs(lastPrice - lastVwap) > vwapStretchDistance;

    if (rsiLong && bbLong && isVwapStretched) {
      return 'BUY';
    }
    if (rsiShort && bbShort && isVwapStretched) {
      return 'SELL';
    }

    return 'NONE';
  }

  /**
   * Core function to evaluate gates and trigger a new basket if everything is aligned
   */
  public static async checkGatesAndTrigger(klines: any[], settings: TradingSettings): Promise<{ triggered: boolean; reason: string }> {
    const config = settings.reversion;

    // Gate 1: Module enabled & Allowed symbols
    if (!config.enabled) {
      return { triggered: false, reason: 'VETO: Reversion module is disabled in settings.' };
    }
    if (config.maxRungs > 3) {
      return { triggered: false, reason: 'VETO (Config Refused): maxRungs cannot exceed hard cap of 3.' };
    }

    // One-basket rule
    if (this.activeBasket && this.activeBasket.status === 'ACTIVE') {
      console.log('[BasketManager] Skipped active basket signal (already open).');
      return { triggered: false, reason: 'skipped_active_basket' };
    }

    const lastKline = klines[klines.length - 1];
    const currentTime = lastKline ? new Date(lastKline.time) : new Date();

    // Gate 2: Event Blackout Window
    const blackoutCheck = isWithinTier1Blackout(currentTime);
    if (blackoutCheck.active) {
      return { triggered: false, reason: blackoutCheck.reason || 'VETO: Tier-1 Event Blackout active.' };
    }

    // Gate 3: Regime Gate (ADX < adxRangeThreshold)
    const highs = klines.map(k => Number(k.high));
    const lows = klines.map(k => Number(k.low));
    const closes = klines.map(k => Number(k.close));
    const adxArr = calculateADXArray(highs, lows, closes, config.adxPeriod);
    const lastAdx = adxArr[closes.length - 1];

    if (lastAdx >= config.adxRangeThreshold) {
      return { triggered: false, reason: `VETO (Regime Gate): ADX ${lastAdx.toFixed(2)} is >= threshold ${config.adxRangeThreshold} (trending market, mean-reversion idle).` };
    }

    // Gate 4: Session Filter
    const sessionCheck = CentralRiskManager.isWithinAllowedSessions(settings);
    if (!sessionCheck.allowed) {
      return { triggered: false, reason: sessionCheck.reason || 'VETO: Session filter inactive.' };
    }

    // Spread Limit
    let bidAskSpread: number | null = null;
    try {
      let mappedSymbol = config.symbol;
      if (mappedSymbol === 'XAUUSD') mappedSymbol = 'XAUUSDT';
      const publicBybit = new BybitClient({ apiKey: '', apiSecret: '', environment: 'live' });
      const ticker = await publicBybit.getTicker(mappedSymbol);
      const rawTicker = (ticker as any).raw?.list?.[0];
      const bid = Number(rawTicker?.bid1Price || rawTicker?.bidPrice || ticker.lastPrice);
      const ask = Number(rawTicker?.ask1Price || rawTicker?.askPrice || ticker.lastPrice);
      if (bid > 0 && ask > 0) {
        bidAskSpread = ask - bid;
      }
    } catch (e: any) {
      return { triggered: false, reason: `VETO (Slippage Gate): Failed to fetch real-time spread for ${config.symbol}. Fail-closed.` };
    }

    if (bidAskSpread === null || isNaN(bidAskSpread)) {
      return { triggered: false, reason: `VETO (Slippage Gate): Failed to fetch real-time spread for ${config.symbol}. Fail-closed.` };
    }
    if (bidAskSpread > config.maxSpreadUsd) {
      return { triggered: false, reason: `VETO (Slippage Gate): Spread $${bidAskSpread.toFixed(2)} exceeds maximum spread safety limit $${config.maxSpreadUsd.toFixed(2)}.` };
    }

    // Gate 5: Signal Confirmation
    const signalSide = this.evaluateSignal(klines, settings);
    if (signalSide === 'NONE') {
      return { triggered: false, reason: 'NONE: Indicators did not form a triple-confirmation mean-reversion setup.' };
    }

    // Gate 6: CentralRiskManager: streak adjustment & risk sizing
    let adjustedRiskUsd = config.basketRiskUsd;
    const db = Database.get();
    const trades = db.trades || [];
    if (settings.isCompoundingActive && trades.length > 0) {
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
        adjustedRiskUsd = adjustedRiskUsd * winMult;
      } else {
        const lossMult = Math.max(0.1, Math.pow(settings.consecutiveLossDownscale, streakCount));
        adjustedRiskUsd = adjustedRiskUsd * lossMult;
      }
    }

    // Sizing Calculation
    const atrArr = calculateATR(highs, lows, closes, 14);
    const lastAtr = atrArr[closes.length - 1];
    const p0 = closes[closes.length - 1]; // Rung 1 limit price is confirmed candle close

    const sizing = this.calculateReversionSizing({
      maxRungs: config.maxRungs,
      rungSpacingAtr: config.rungSpacingAtr,
      stopBeyondLastRungAtr: config.stopBeyondLastRungAtr,
      atr: lastAtr,
      basketRiskUsd: adjustedRiskUsd,
      symbol: config.symbol,
      p0,
      side: signalSide,
    });

    if (sizing.q < 0.01) {
      return { triggered: false, reason: `VETO (Sizing Limit): Calculated quantity ${sizing.q} is below minimum allowed step size of 0.01. Signal skipped.` };
    }

    if (sizing.worstCaseLoss > adjustedRiskUsd * 1.02) {
      return { triggered: false, reason: `VETO (Sizing Error): Worst case loss of $${sizing.worstCaseLoss.toFixed(2)} exceeds allowed cap of $${(adjustedRiskUsd * 1.02).toFixed(2)}. Sizing formula refused.` };
    }

    // Determine initial Take Profit Target price (BB Mid or VWAP)
    let initialTpTarget = p0;
    const lastBb = calculateBollingerBands(closes, config.bbPeriod, config.bbStdDev)[closes.length - 1];
    const vwapInput = klines.map(k => ({
      time: new Date(k.time),
      high: Number(k.high),
      low: Number(k.low),
      close: Number(k.close),
      volume: Number(k.volume || k.vol || 1),
    }));
    const lastVwap = calculateSessionVWAP(vwapInput)[closes.length - 1];

    if (config.tpTarget === 'bbMid') {
      initialTpTarget = Number(lastBb.middle.toFixed(2));
    } else {
      initialTpTarget = Number(lastVwap.toFixed(2));
    }

    // Veto complete - Assemble basket!
    const basketId = 'rev-' + Date.now().toString(36);
    this.activeBasket = {
      basketId,
      symbol: config.symbol,
      side: signalSide,
      maxRungs: config.maxRungs,
      rungSpacingAtr: config.rungSpacingAtr,
      stopBeyondLastRungAtr: config.stopBeyondLastRungAtr,
      basketRiskUsd: adjustedRiskUsd,
      atr: lastAtr,
      p0,
      q: sizing.q,
      worstCaseLoss: sizing.worstCaseLoss,
      rungPrices: sizing.rungPrices,
      stopLossPrice: sizing.stopLossPrice,
      tpTargetPrice: initialTpTarget,
      rungsFilled: new Array(config.maxRungs).fill(false),
      rungsOrderIds: new Array(config.maxRungs).fill(null),
      stopLossOrderId: null,
      takeProfitOrderId: null,
      status: 'ACTIVE',
      entryTime: new Date().toISOString(),
      barsHeld: 0,
    };

    this.saveBasketState();

    // TRIGGER PLACE ORDERS (Limit / conditional order placement)
    await this.executeOrdersOnExchange(settings);

    return {
      triggered: true,
      reason: `SUCCESS: Mean-Reversion basket ${basketId} successfully triggered for ${config.symbol}. ${signalSide} at limit ${p0}. Stop Loss: ${sizing.stopLossPrice}. Sized risk: $${sizing.worstCaseLoss}.`
    };
  }

  /**
   * Places the ladder limits and initial stops on the exchange / paper engine
   */
  private static async executeOrdersOnExchange(settings: TradingSettings) {
    const basket = this.activeBasket;
    if (!basket) return;

    const isPaper = settings.isPaperTrading;
    console.log(`[BasketManager] Executing basket ${basket.basketId} on ${isPaper ? 'Paper Trading Engine' : 'Live Bybit Exchange'}`);

    if (isPaper) {
      // Simulate ordering
      basket.rungsOrderIds = basket.rungPrices.map((p, idx) => `paper-${basket.basketId}-r${idx + 1}`);
      basket.stopLossOrderId = `paper-${basket.basketId}-sl`;
      basket.takeProfitOrderId = `paper-${basket.basketId}-tp`;
      this.saveBasketState();
      
      // Auto-fill rung 1 at limit immediately for testing if close was satisfied
      basket.rungsFilled[0] = true;
      Database.addPaperPosition({
        symbol: basket.symbol,
        side: basket.side === 'BUY' ? 'buy' : 'sell',
        entryPrice: basket.p0,
        quantity: basket.q,
        leverage: settings.defaultLeverage,
        stopLossPrice: basket.stopLossPrice,
        takeProfitPrice: basket.tpTargetPrice,
        module: 'range',
        routerReason: `Mean Reversion Ladder Rung 1 of ${basket.maxRungs}`,
      });
      Database.addLog({
        rawBody: { basketId: basket.basketId, rung: 1 },
        status: 'success',
        action: basket.side === 'BUY' ? 'buy' : 'sell',
        symbol: basket.symbol,
        price: basket.p0,
        quantity: basket.q,
        message: `[BasketManager] Paper Rung 1 filled at ${basket.p0} (Size: ${basket.q} XAUUSDT).`,
        mode: 'paper',
      });
      this.saveBasketState();
    } else {
      // LIVE BYBIT ORDER PLACEMENT
      try {
        const client = new BybitClient({
          apiKey: settings.bybitApiKey,
          apiSecret: settings.bybitApiSecret,
          environment: settings.bybitEnvironment,
        });

        // Place Rung 1 Limit
        const r1Result = await client.placeOrder({
          symbol: basket.symbol,
          side: basket.side === 'BUY' ? 'Buy' : 'Sell',
          qty: String(basket.q),
          orderType: 'Limit',
          price: String(basket.p0),
          orderLinkId: `${basket.basketId}-r1`,
          timeInForce: 'PostOnly',
        });
        basket.rungsOrderIds[0] = r1Result?.orderId || `${basket.basketId}-r1`;

        // Place remaining rungs immediately
        for (let i = 1; i < basket.maxRungs; i++) {
          const rungPrice = basket.rungPrices[i];
          const orderLinkId = `${basket.basketId}-r${i + 1}`;
          const res = await client.placeOrder({
            symbol: basket.symbol,
            side: basket.side === 'BUY' ? 'Buy' : 'Sell',
            qty: String(basket.q),
            orderType: 'Limit',
            price: String(rungPrice),
            orderLinkId,
            timeInForce: 'PostOnly',
          });
          basket.rungsOrderIds[i] = res?.orderId || orderLinkId;
        }

        // Place Stop Loss as exchange conditional reduceOnly order
        const slResult = await client.placeOrder({
          symbol: basket.symbol,
          side: basket.side === 'BUY' ? 'Sell' : 'Buy',
          qty: String(basket.q), // Initially sized to R1 filled quantity
          orderType: 'Market',
          triggerPrice: String(basket.stopLossPrice),
          triggerDirection: basket.side === 'BUY' ? 2 : 1, // 2: fall below for Buy, 1: rise above for Sell
          reduceOnly: true,
          orderLinkId: `${basket.basketId}-sl`,
        });
        basket.stopLossOrderId = slResult?.orderId || `${basket.basketId}-sl`;

        // Place Take Profit target order
        const tpResult = await client.placeOrder({
          symbol: basket.symbol,
          side: basket.side === 'BUY' ? 'Sell' : 'Buy',
          qty: String(basket.q),
          orderType: 'Limit',
          price: String(basket.tpTargetPrice),
          reduceOnly: true,
          orderLinkId: `${basket.basketId}-tp`,
        });
        basket.takeProfitOrderId = tpResult?.orderId || `${basket.basketId}-tp`;

        this.saveBasketState();
      } catch (e: any) {
        console.error('[BasketManager] Error executing live basket orders:', e);
        this.closeBasket('failed_execution', basket.p0, settings);
      }
    }
  }

  /**
   * Reconciles startup positions and restores the basket state
   */
  public static async reconcileStartup(settings: TradingSettings) {
    this.loadBasketState();
    if (settings.isPaperTrading) return;

    try {
      const client = new BybitClient({
        apiKey: settings.bybitApiKey,
        apiSecret: settings.bybitApiSecret,
        environment: settings.bybitEnvironment,
      });

      const positions = await client.getPositions(settings.reversion.symbol);
      const revPosition = positions.find(p => Number(p.size) > 0 && p.symbol === settings.reversion.symbol);

      if (revPosition) {
        console.log(`[BasketManager Reconcile] Position found: ${revPosition.size} units.`);
        
        // Check if our stop exists
        const openOrders = await client.getOpenOrders({ symbol: settings.reversion.symbol });
        const stopLossOrder = openOrders.find(o => o.orderLinkId?.includes('sl') || o.triggerPrice);

        if (!stopLossOrder && this.activeBasket) {
          console.warn('[BasketManager Reconcile] Missing exchange stop loss! Placing stop immediately.');
          const slResult = await client.placeOrder({
            symbol: this.activeBasket.symbol,
            side: this.activeBasket.side === 'BUY' ? 'Sell' : 'Buy',
            qty: String(revPosition.size),
            orderType: 'Market',
            triggerPrice: String(this.activeBasket.stopLossPrice),
            triggerDirection: this.activeBasket.side === 'BUY' ? 2 : 1,
            reduceOnly: true,
            orderLinkId: `${this.activeBasket.basketId}-sl`,
          });
          this.activeBasket.stopLossOrderId = slResult?.orderId || `${this.activeBasket.basketId}-sl`;
          this.saveBasketState();
        }
      }
    } catch (e) {
      console.error('[BasketManager] Startup reconciliation failed:', e);
    }
  }

  /**
   * Monitor the basket and process fills & stops (called periodically on ticker or candle update)
   */
  public static async monitorUpdate(currentPrice: number, settings: TradingSettings) {
    const basket = this.activeBasket;
    if (!basket || basket.status !== 'ACTIVE') return;

    const isPaper = settings.isPaperTrading;

    // First, check blackout flattening rules
    const blackoutCheck = isWithinTier1Blackout(new Date());
    if (blackoutCheck.active) {
      console.log(`[BasketManager] Event blackout triggered flatten 15 mins before tier-1 print: ${blackoutCheck.reason}`);
      await this.closeBasket('blackout_flatten', currentPrice, settings);
      return;
    }

    if (isPaper) {
      // PAPER SYSTEM RECONCILIATION
      const totalRungs = basket.maxRungs;
      let filledCount = basket.rungsFilled.filter(f => f).length;

      if (basket.side === 'BUY') {
        // Check rungs
        for (let i = 1; i < totalRungs; i++) {
          if (basket.rungsFilled[i - 1] && !basket.rungsFilled[i] && currentPrice <= basket.rungPrices[i]) {
            basket.rungsFilled[i] = true;
            filledCount++;
            this.handlePaperRungFill(i + 1, settings);
          }
        }

        // Check SL
        if (currentPrice <= basket.stopLossPrice) {
          console.log(`[BasketManager] Paper Basket SL hit at ${currentPrice} <= ${basket.stopLossPrice}`);
          await this.closeBasket('basket_stop', basket.stopLossPrice, settings);
          return;
        }

        // Check TP
        if (currentPrice >= basket.tpTargetPrice) {
          console.log(`[BasketManager] Paper Basket TP hit at ${currentPrice} >= ${basket.tpTargetPrice}`);
          await this.closeBasket('tp', basket.tpTargetPrice, settings);
          return;
        }
      } else {
        // SELL Side
        for (let i = 1; i < totalRungs; i++) {
          if (basket.rungsFilled[i - 1] && !basket.rungsFilled[i] && currentPrice >= basket.rungPrices[i]) {
            basket.rungsFilled[i] = true;
            filledCount++;
            this.handlePaperRungFill(i + 1, settings);
          }
        }

        // Check SL
        if (currentPrice >= basket.stopLossPrice) {
          console.log(`[BasketManager] Paper Basket SL hit at ${currentPrice} >= ${basket.stopLossPrice}`);
          await this.closeBasket('basket_stop', basket.stopLossPrice, settings);
          return;
        }

        // Check TP
        if (currentPrice <= basket.tpTargetPrice) {
          console.log(`[BasketManager] Paper Basket TP hit at ${currentPrice} <= ${basket.tpTargetPrice}`);
          await this.closeBasket('tp', basket.tpTargetPrice, settings);
          return;
        }
      }
    } else {
      // LIVE EXCHANCE MONITORING
      try {
        const client = new BybitClient({
          apiKey: settings.bybitApiKey,
          apiSecret: settings.bybitApiSecret,
          environment: settings.bybitEnvironment,
        });

        // Fetch position to see current size and filled status
        const positions = await client.getPositions(basket.symbol);
        const position = positions.find(p => p.symbol === basket.symbol);
        const currentSize = position ? parseFloat(position.size || '0') : 0;

        if (currentSize === 0) {
          // Check if stop hit or exit was done manually
          const openOrders = await client.getOpenOrders({ symbol: basket.symbol });
          const hasRungs = openOrders.some(o => o.orderLinkId?.includes(basket.basketId));
          if (!hasRungs) {
            console.log('[BasketManager] Live position is flat and no orders found. Marking basket as CLOSED.');
            await this.closeBasket('completed', currentPrice, settings);
            return;
          }
        }

        // Check filled count based on size
        const filledRungs = Math.round(currentSize / basket.q);
        for (let i = 0; i < basket.maxRungs; i++) {
          if (i < filledRungs && !basket.rungsFilled[i]) {
            basket.rungsFilled[i] = true;
            console.log(`[BasketManager] Live Rung ${i + 1} fill detected.`);
            
            // Amend stop loss quantity on exchange to the new filled total
            const newQty = String(basket.q * (i + 1));
            await client.placeOrder({
              symbol: basket.symbol,
              side: basket.side === 'BUY' ? 'Sell' : 'Buy',
              qty: newQty,
              orderType: 'Market',
              triggerPrice: String(basket.stopLossPrice),
              triggerDirection: basket.side === 'BUY' ? 2 : 1,
              reduceOnly: true,
              orderLinkId: `${basket.basketId}-sl`,
            });
          }
        }

        this.saveBasketState();
      } catch (e) {
        console.error('[BasketManager] Failed live monitoring sync:', e);
      }
    }
  }

  private static handlePaperRungFill(rungNum: number, settings: TradingSettings) {
    const basket = this.activeBasket;
    if (!basket) return;

    const filledCount = basket.rungsFilled.filter(f => f).length;
    
    // Add additional PaperPosition for this rung
    Database.addPaperPosition({
      symbol: basket.symbol,
      side: basket.side === 'BUY' ? 'buy' : 'sell',
      entryPrice: basket.rungPrices[rungNum - 1],
      quantity: basket.q,
      leverage: settings.defaultLeverage,
      stopLossPrice: basket.stopLossPrice,
      takeProfitPrice: basket.tpTargetPrice,
      module: 'range',
      routerReason: `Mean Reversion Ladder Rung ${rungNum} of ${basket.maxRungs}`,
    });

    Database.addLog({
      rawBody: { basketId: basket.basketId, rung: rungNum },
      status: 'success',
      action: basket.side === 'BUY' ? 'buy' : 'sell',
      symbol: basket.symbol,
      price: basket.rungPrices[rungNum - 1],
      quantity: basket.q,
      message: `[BasketManager] Paper Rung ${rungNum} filled at ${basket.rungPrices[rungNum - 1]} (Size: ${basket.q} XAUUSDT). Total filled size: ${(basket.q * filledCount).toFixed(2)}.`,
      mode: 'paper',
    });

    this.saveBasketState();
  }

  /**
   * Confirms a new candle close, handles time stops and dynamically updates target price
   */
  public static async handleConfirmedCandle(closes: number[], highs: number[], lows: number[], volumes: number[], settings: TradingSettings) {
    const basket = this.activeBasket;
    if (!basket || basket.status !== 'ACTIVE') return;

    const config = settings.reversion;

    // Only count bar if rung 1 has been filled
    if (basket.rungsFilled[0]) {
      basket.barsHeld++;
      console.log(`[BasketManager] Basket barsHeld: ${basket.barsHeld}/${config.timeStopBars}`);
      
      if (basket.barsHeld >= config.timeStopBars) {
        console.log(`[BasketManager] Time stop reached (${basket.barsHeld} bars). Flattening basket at market.`);
        const lastClose = closes[closes.length - 1];
        await this.closeBasket('time_stop', lastClose, settings);
        return;
      }
    }

    // Dynamic TP adjustment: recomputed each confirmed candle, amended if it drifts > 0.25 * ATR
    const lastBb = calculateBollingerBands(closes, config.bbPeriod, config.bbStdDev)[closes.length - 1];
    
    const vwapInput = closes.map((c, idx) => ({
      time: new Date(Date.now() - (closes.length - 1 - idx) * 15 * 60 * 1000), // approximate 15m intervals
      high: highs[idx],
      low: lows[idx],
      close: c,
      volume: volumes[idx] || 1,
    }));
    const lastVwap = calculateSessionVWAP(vwapInput)[closes.length - 1];
    const lastAtr = calculateATR(highs, lows, closes, 14)[closes.length - 1];

    let newTpPrice = basket.tpTargetPrice;
    if (config.tpTarget === 'bbMid') {
      newTpPrice = Number(lastBb.middle.toFixed(2));
    } else {
      newTpPrice = Number(lastVwap.toFixed(2));
    }

    const drift = Math.abs(basket.tpTargetPrice - newTpPrice);
    if (drift > 0.25 * lastAtr) {
      console.log(`[BasketManager] TP target updated due to drift. Old: ${basket.tpTargetPrice}, New: ${newTpPrice}. Drift: ${drift.toFixed(2)} > ${(0.25 * lastAtr).toFixed(2)} (0.25*ATR).`);
      basket.tpTargetPrice = newTpPrice;
      this.saveBasketState();

      if (!settings.isPaperTrading) {
        // Amend the live limit TP order
        try {
          const client = new BybitClient({
            apiKey: settings.bybitApiKey,
            apiSecret: settings.bybitApiSecret,
            environment: settings.bybitEnvironment,
          });
          const filledCount = basket.rungsFilled.filter(f => f).length;
          
          // Re-place or cancel/replace limit TP order
          if (basket.takeProfitOrderId) {
            await client.cancelOrder({ symbol: basket.symbol, orderId: basket.takeProfitOrderId });
          }
          const tpResult = await client.placeOrder({
            symbol: basket.symbol,
            side: basket.side === 'BUY' ? 'Sell' : 'Buy',
            qty: String(basket.q * filledCount),
            orderType: 'Limit',
            price: String(newTpPrice),
            reduceOnly: true,
            orderLinkId: `${basket.basketId}-tp`,
          });
          basket.takeProfitOrderId = tpResult?.orderId || `${basket.basketId}-tp`;
          this.saveBasketState();
        } catch (e) {
          console.error('[BasketManager] Failed to update TP on exchange:', e);
        }
      }
    }
  }

  /**
   * Flattens and logs one consolidated trade record
   */
  public static async closeBasket(reason: 'tp' | 'basket_stop' | 'time_stop' | 'blackout_flatten' | 'failed_execution' | 'completed', exitPrice: number, settings: TradingSettings) {
    const basket = this.activeBasket;
    if (!basket) return;

    basket.status = 'CLOSED';
    this.activeBasket = null;
    this.saveBasketState();

    console.log(`[BasketManager] Closing basket ${basket.basketId} for ${basket.symbol}. Reason: ${reason.toUpperCase()} at price ${exitPrice}`);

    const filledCount = basket.rungsFilled.filter(f => f).length;
    if (filledCount === 0) {
      console.log('[BasketManager] Basket closed with 0 rungs filled. No position trade logged.');
      return;
    }

    // Cancel all open orders
    if (!settings.isPaperTrading) {
      try {
        const client = new BybitClient({
          apiKey: settings.bybitApiKey,
          apiSecret: settings.bybitApiSecret,
          environment: settings.bybitEnvironment,
        });

        // Cancel all basket orders
        await client.cancelOrder({ symbol: basket.symbol, orderLinkId: `${basket.basketId}-r1` });
        await client.cancelOrder({ symbol: basket.symbol, orderLinkId: `${basket.basketId}-r2` });
        await client.cancelOrder({ symbol: basket.symbol, orderLinkId: `${basket.basketId}-r3` });
        await client.cancelOrder({ symbol: basket.symbol, orderLinkId: `${basket.basketId}-sl` });
        await client.cancelOrder({ symbol: basket.symbol, orderLinkId: `${basket.basketId}-tp` });
        
        // Final market order safety check to flatten any remaining fractional positions
        const positions = await client.getPositions(basket.symbol);
        const position = positions.find(p => p.symbol === basket.symbol);
        if (position && parseFloat(position.size || '0') > 0) {
          console.log(`[BasketManager] Emergency live flattening position of ${position.size} units.`);
          await client.placeOrder({
            symbol: basket.symbol,
            side: basket.side === 'BUY' ? 'Sell' : 'Buy',
            qty: position.size,
            orderType: 'Market',
            reduceOnly: true,
          });
        }
      } catch (e) {
        console.error('[BasketManager] Error clearing live orders on close:', e);
      }
    }

    // Process paper positions closure
    if (settings.isPaperTrading) {
      // Average entry price
      let totalValue = 0;
      let totalQty = 0;
      for (let i = 0; i < basket.maxRungs; i++) {
        if (basket.rungsFilled[i]) {
          totalValue += basket.rungPrices[i] * basket.q;
          totalQty += basket.q;
        }
      }
      const avgEntry = totalValue / totalQty;
      const sideFactor = basket.side === 'BUY' ? 1 : -1;
      const realizedPnL = sideFactor * (exitPrice - avgEntry) * totalQty * getContractMultiplier(basket.symbol);
      const realizedR = realizedPnL / basket.basketRiskUsd;

      // Reset positions in DB
      const db = Database.get();
      db.paperAccount.positions = db.paperAccount.positions.filter(p => p.module !== 'range');
      db.paperAccount.balance += realizedPnL;

      if (!db.trades) db.trades = [];
      db.trades.unshift({
        id: 'rev-trade-' + Math.random().toString(36).substr(2, 9),
        symbol: basket.symbol,
        side: basket.side === 'BUY' ? 'buy' : 'sell',
        entryPrice: avgEntry,
        exitPrice,
        quantity: totalQty,
        leverage: settings.defaultLeverage,
        entryTime: basket.entryTime,
        exitTime: new Date().toISOString(),
        pnl: realizedPnL,
        durationMs: Date.now() - new Date(basket.entryTime).getTime(),
        module: 'range',
        routerReason: `Mean Reversion basket closed: ${reason.toUpperCase()} (rungs filled: ${filledCount}/${basket.maxRungs})`,
      });

      Database.save(db);

      Database.addLog({
        rawBody: { basketId: basket.basketId, reason, pnl: realizedPnL, R: realizedR },
        status: 'success',
        action: 'close',
        symbol: basket.symbol,
        price: exitPrice,
        quantity: totalQty,
        message: `[BasketManager] Consolidated Reversion Trade Closed: ${reason.toUpperCase()}. Avg Entry: ${avgEntry.toFixed(2)}, Exit: ${exitPrice.toFixed(2)}, Rungs filled: ${filledCount}. PnL: $${realizedPnL.toFixed(2)} (${realizedR.toFixed(2)} R)`,
        mode: 'paper',
      });
    }
  }
}
