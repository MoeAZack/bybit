import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { Database } from './server/db.js';
import { BybitClient } from './server/bybit.js';
import { MT5Client } from './server/mt5.js';
import { Backtester } from './server/backtester.js';
import { CentralRiskManager } from './server/risk.js';
import { RegimeRouter } from './server/router.js';
import { GoogleGenAI } from '@google/genai';

const app = express();
const PORT = 3000;

// For parsing JSON and urlencoded request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper to initialize Gemini Client safely
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.includes('MY_')) {
    console.log('Gemini API Key is not configured in secrets.');
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// REST API Endpoints

// 1. Get Settings
app.get('/api/settings', (req, res) => {
  try {
    const db = Database.get();
    // Return settings (hide API Secret for security, just send a masked placeholder if set)
    const secureSettings = {
      ...db.settings,
      bybitApiSecret: db.settings.bybitApiSecret ? '••••••••••••••••' : '',
      mt5Password: db.settings.mt5Password ? '••••••••••••••••' : '',
      mt5GatewayToken: db.settings.mt5GatewayToken ? '••••••••••••••••' : '',
    };
    res.json(secureSettings);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 2. Save Settings
app.post('/api/settings', (req, res) => {
  try {
    const {
      bybitApiKey,
      bybitApiSecret,
      isTestnet,
      isPaperTrading,
      webhookPassphrase,
      defaultSymbol,
      defaultLeverage,
      defaultOrderSize,
      stopLossPercent,
      takeProfitPercent,
      maxPositionSize,
      maxDailyLoss,
      maxConsecutiveLosses,
      isKillSwitchActive,
      ipWhitelist,
      clientOrderIdPrefix,
      isHybridStopsActive,
      isSessionFilterActive,
      allowedSessions,
      isCentralRiskVetoActive,
      maxPortfolioRiskPercent,
      activeRegimeModule,
      // MT5 fields
      activeBroker,
      mt5Host,
      mt5Login,
      mt5Password,
      mt5Server,
      mt5GatewayType,
      mt5GatewayUrl,
      mt5GatewayToken,
    } = req.body;

    const db = Database.get();
    const updated: Record<string, any> = {
      bybitApiKey: bybitApiKey !== undefined ? bybitApiKey : db.settings.bybitApiKey,
      isTestnet: isTestnet !== undefined ? isTestnet : db.settings.isTestnet,
      isPaperTrading: isPaperTrading !== undefined ? isPaperTrading : db.settings.isPaperTrading,
      webhookPassphrase: webhookPassphrase !== undefined ? webhookPassphrase : db.settings.webhookPassphrase,
      defaultSymbol: defaultSymbol !== undefined ? defaultSymbol : db.settings.defaultSymbol,
      defaultLeverage: defaultLeverage !== undefined ? Number(defaultLeverage) : db.settings.defaultLeverage,
      defaultOrderSize: defaultOrderSize !== undefined ? Number(defaultOrderSize) : db.settings.defaultOrderSize,
      stopLossPercent: stopLossPercent !== undefined ? Number(stopLossPercent) : db.settings.stopLossPercent,
      takeProfitPercent: takeProfitPercent !== undefined ? Number(takeProfitPercent) : db.settings.takeProfitPercent,
      maxPositionSize: maxPositionSize !== undefined ? Number(maxPositionSize) : db.settings.maxPositionSize,
      maxDailyLoss: maxDailyLoss !== undefined ? Number(maxDailyLoss) : db.settings.maxDailyLoss,
      maxConsecutiveLosses: maxConsecutiveLosses !== undefined ? Number(maxConsecutiveLosses) : db.settings.maxConsecutiveLosses,
      isKillSwitchActive: isKillSwitchActive !== undefined ? Boolean(isKillSwitchActive) : db.settings.isKillSwitchActive,
      ipWhitelist: ipWhitelist !== undefined ? ipWhitelist : db.settings.ipWhitelist,
      clientOrderIdPrefix: clientOrderIdPrefix !== undefined ? clientOrderIdPrefix : db.settings.clientOrderIdPrefix,
      isHybridStopsActive: isHybridStopsActive !== undefined ? Boolean(isHybridStopsActive) : db.settings.isHybridStopsActive,
      isSessionFilterActive: isSessionFilterActive !== undefined ? Boolean(isSessionFilterActive) : db.settings.isSessionFilterActive,
      allowedSessions: allowedSessions !== undefined ? allowedSessions : db.settings.allowedSessions,
      isCentralRiskVetoActive: isCentralRiskVetoActive !== undefined ? Boolean(isCentralRiskVetoActive) : db.settings.isCentralRiskVetoActive,
      maxPortfolioRiskPercent: maxPortfolioRiskPercent !== undefined ? Number(maxPortfolioRiskPercent) : db.settings.maxPortfolioRiskPercent,
      activeRegimeModule: activeRegimeModule !== undefined ? activeRegimeModule : db.settings.activeRegimeModule,
      // MT5 fields
      activeBroker: activeBroker !== undefined ? activeBroker : db.settings.activeBroker,
      mt5Host: mt5Host !== undefined ? mt5Host : db.settings.mt5Host,
      mt5Login: mt5Login !== undefined ? mt5Login : db.settings.mt5Login,
      mt5Server: mt5Server !== undefined ? mt5Server : db.settings.mt5Server,
      mt5GatewayType: mt5GatewayType !== undefined ? mt5GatewayType : db.settings.mt5GatewayType,
      mt5GatewayUrl: mt5GatewayUrl !== undefined ? mt5GatewayUrl : db.settings.mt5GatewayUrl,
    };

    // If API Secret is updated and is not the masked placeholder, save it
    if (bybitApiSecret !== undefined && bybitApiSecret !== '••••••••••••••••' && bybitApiSecret !== '') {
      updated.bybitApiSecret = bybitApiSecret;
    }
    if (mt5Password !== undefined && mt5Password !== '••••••••••••••••' && mt5Password !== '') {
      updated.mt5Password = mt5Password;
    }
    if (mt5GatewayToken !== undefined && mt5GatewayToken !== '••••••••••••••••' && mt5GatewayToken !== '') {
      updated.mt5GatewayToken = mt5GatewayToken;
    }

    const newSettings = Database.updateSettings(updated);
    res.json({
      success: true,
      settings: {
        ...newSettings,
        bybitApiSecret: newSettings.bybitApiSecret ? '••••••••••••••••' : '',
        mt5Password: newSettings.mt5Password ? '••••••••••••••••' : '',
        mt5GatewayToken: newSettings.mt5GatewayToken ? '••••••••••••••••' : '',
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 3. Clear logs
app.post('/api/logs/clear', (req, res) => {
  try {
    Database.clearLogs();
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// MT5 Accounts Management
app.get('/api/mt5/accounts', (req, res) => {
  try {
    const accounts = Database.getMT5Accounts().map(acc => ({
      ...acc,
      password: acc.password ? '••••••••••••••••' : '',
      gatewayToken: acc.gatewayToken ? '••••••••••••••••' : '',
    }));
    res.json(accounts);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mt5/accounts', (req, res) => {
  try {
    const { id, name, login, password, server, isActive, type, gatewayType, gatewayUrl, gatewayToken } = req.body;
    
    if (!name || !login || !server) {
      return res.status(400).json({ error: 'Name, login, and server are required' });
    }

    if (id) {
      // Update
      const existing = Database.getMT5Accounts().find(a => a.id === id);
      if (!existing) {
        return res.status(404).json({ error: 'Account not found' });
      }

      const updates: any = {
        name,
        login,
        server,
        isActive: Boolean(isActive),
        type: type || 'demo',
        gatewayType: gatewayType || 'local',
        gatewayUrl: gatewayUrl || 'https://api.mtapi.be',
      };

      if (password && password !== '••••••••••••••••') {
        updates.password = password;
      }
      if (gatewayToken && gatewayToken !== '••••••••••••••••') {
        updates.gatewayToken = gatewayToken;
      }

      const updated = Database.updateMT5Account(id, updates);
      if (isActive) {
        Database.selectMT5Account(id);
      }
      return res.json({ success: true, account: updated });
    } else {
      // Create
      const newAcc = Database.addMT5Account({
        name,
        login,
        password: password || '',
        server,
        isActive: Boolean(isActive),
        type: type || 'demo',
        gatewayType: gatewayType || 'local',
        gatewayUrl: gatewayUrl || 'https://api.mtapi.be',
        gatewayToken: gatewayToken || '',
      });
      if (newAcc.isActive) {
        Database.selectMT5Account(newAcc.id);
      }
      return res.json({ success: true, account: newAcc });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mt5/accounts/select', (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'ID is required' });
    }
    const success = Database.selectMT5Account(id);
    if (!success) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/mt5/accounts/:id', (req, res) => {
  try {
    const { id } = req.params;
    const success = Database.deleteMT5Account(id);
    if (!success) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 4. Get Webhook logs
app.get('/api/logs', (req, res) => {
  try {
    const db = Database.get();
    res.json(db.logs);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 4b. Get Regime Router module performance statistics
app.get('/api/router-stats', (req, res) => {
  try {
    const stats = RegimeRouter.getModulePerformance();
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 5. Reset paper account with optional custom balance size
app.post('/api/paper/reset', (req, res) => {
  try {
    const customBalance = req.body && req.body.balance ? parseFloat(req.body.balance) : undefined;
    Database.resetPaperAccount(customBalance);
    res.json({ success: true, paperAccount: Database.getPaperAccount() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 6. Get Account details & Open positions
app.get('/api/positions', async (req, res) => {
  try {
    const db = Database.get();
    
    // Simulating / Updating live mark prices for paper trading
    let currentGoldPrice = 2375.50;
    if (db.settings.activeBroker === 'mt5') {
      if (db.settings.mt5Login && db.settings.mt5Password) {
        try {
          const client = new MT5Client({
            host: db.settings.mt5Host,
            login: db.settings.mt5Login,
            password: db.settings.mt5Password,
            server: db.settings.mt5Server,
            gatewayType: db.settings.mt5GatewayType,
            gatewayUrl: db.settings.mt5GatewayUrl,
            gatewayToken: db.settings.mt5GatewayToken,
          });
          const tick = await client.getTicker(db.settings.defaultSymbol || 'XAUUSD');
          if (tick.lastPrice > 0) {
            currentGoldPrice = tick.lastPrice;
          }
        } catch (e) {
          // Fallback to memory
        }
      }
    } else if (db.settings.bybitApiKey && db.settings.bybitApiSecret) {
      try {
        const client = new BybitClient({
          apiKey: db.settings.bybitApiKey,
          apiSecret: db.settings.bybitApiSecret,
          isTestnet: db.settings.isTestnet,
        });
        const tick = await client.getTicker(db.settings.defaultSymbol || 'XAUUSDT');
        if (tick.lastPrice > 0) {
          currentGoldPrice = tick.lastPrice;
        }
      } catch (e) {
        // Fallback to in-memory random wander below
      }
    }
    
    if (db.settings.activeBroker === 'bybit' && (!db.settings.bybitApiKey || !db.settings.bybitApiSecret)) {
      if (!(global as any).simulatedGoldPrice) {
        (global as any).simulatedGoldPrice = 2375.50;
      }
      (global as any).simulatedGoldPrice += (Math.random() - 0.5) * 1.8;
      if ((global as any).simulatedGoldPrice < 2100) (global as any).simulatedGoldPrice = 2300;
      if ((global as any).simulatedGoldPrice > 2600) (global as any).simulatedGoldPrice = 2450;
      currentGoldPrice = (global as any).simulatedGoldPrice;
    } else if (db.settings.activeBroker === 'mt5' && (!db.settings.mt5Login || !db.settings.mt5Password)) {
      if (!(global as any).simulatedGoldPrice) {
        (global as any).simulatedGoldPrice = 2375.50;
      }
      (global as any).simulatedGoldPrice += (Math.random() - 0.5) * 1.8;
      if ((global as any).simulatedGoldPrice < 2100) (global as any).simulatedGoldPrice = 2300;
      if ((global as any).simulatedGoldPrice > 2600) (global as any).simulatedGoldPrice = 2450;
      currentGoldPrice = (global as any).simulatedGoldPrice;
    }

    // Update paper positions dynamically for Trailing Stop, SL and TP
    CentralRiskManager.updatePaperPositions(db, currentGoldPrice);

    const result: any = {
      paperAccount: db.paperAccount,
      liveAccount: null,
      activeMode: db.settings.isPaperTrading ? 'paper' : 'live',
      trades: db.trades || [],
      currentSimulatedPrice: Number(currentGoldPrice.toFixed(2)),
    };

    // Fetch actual broker account details based on selection
    if (!db.settings.isPaperTrading && db.settings.activeBroker === 'mt5' && db.settings.mt5Login && db.settings.mt5Password) {
      try {
        const client = new MT5Client({
          host: db.settings.mt5Host,
          login: db.settings.mt5Login,
          password: db.settings.mt5Password,
          server: db.settings.mt5Server,
          gatewayType: db.settings.mt5GatewayType,
          gatewayUrl: db.settings.mt5GatewayUrl,
          gatewayToken: db.settings.mt5GatewayToken,
        });

        const wallet = await client.getWalletBalance();
        const positionsRaw = await client.getPositions();
        
        // Format MT5 positions
        const positions = positionsRaw.map((p: any, idx: number) => {
          const size = parseFloat(p.volume || p.qty || p.size || '0.1');
          const side = (p.type || p.side || 'buy').toLowerCase().includes('sell') ? 'sell' : 'buy';
          const entryPrice = parseFloat(p.openPrice || p.price || p.entryPrice || currentGoldPrice);
          const currentPrice = parseFloat(p.currentPrice || p.price || currentGoldPrice);
          const unrealizedPnl = parseFloat(p.profit || p.pnl || '0');

          return {
            id: p.ticket || p.positionId || `mt5-pos-${idx}`,
            symbol: p.symbol || 'XAUUSD',
            side,
            entryPrice,
            quantity: size,
            leverage: parseFloat(p.leverage || '100'),
            unrealizedPnl,
            timestamp: p.time || new Date().toISOString(),
            raw: p,
          };
        });

        result.liveAccount = {
          balance: wallet.balance,
          currency: wallet.currency,
          positions,
        };
      } catch (e: any) {
        result.liveAccountError = e.message || 'Failed to fetch real MT5 account details.';
      }
    } else if (!db.settings.isPaperTrading && db.settings.bybitApiKey && db.settings.bybitApiSecret) {
      try {
        const client = new BybitClient({
          apiKey: db.settings.bybitApiKey,
          apiSecret: db.settings.bybitApiSecret,
          isTestnet: db.settings.isTestnet,
        });

        const wallet = await client.getWalletBalance();
        const positionsRaw = await client.getPositions();
        
        // Format Bybit positions to match standard structure
        const positions = positionsRaw
          .filter((p: any) => parseFloat(p.size) > 0)
          .map((p: any) => {
            const size = parseFloat(p.size);
            const side = p.side.toLowerCase() as 'buy' | 'sell';
            const entryPrice = parseFloat(p.entryPrice);
            const markPrice = parseFloat(p.markPrice || '0');
            
            // Calculate unrealized PnL
            const sideFactor = side === 'buy' ? 1 : -1;
            const unrealizedPnl = sideFactor * (markPrice - entryPrice) * size;

            return {
              id: p.positionIdx + '-' + p.symbol,
              symbol: p.symbol,
              side,
              entryPrice,
              quantity: size,
              leverage: parseFloat(p.leverage || '1'),
              unrealizedPnl,
              timestamp: new Date().toISOString(),
              raw: p,
            };
          });

        result.liveAccount = {
          balance: wallet.balance,
          currency: wallet.currency,
          positions,
        };
      } catch (e: any) {
        result.liveAccountError = e.message || 'Failed to fetch real Bybit account details.';
      }
    }

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 6b. Run Strategy Backtester
app.post('/api/backtest', (req, res) => {
  try {
    const {
      fastEma,
      slowEma,
      rsiPeriod,
      rsiOverbought,
      rsiOversold,
      atrPeriod,
      atrMultiplierSL,
      atrMultiplierTP,
      feePercent,
      slippageTicks,
      walkForward,
      isRegimeFilterActive,
      adxThreshold,
      isVolatilitySizingActive,
      riskPercent,
      isEquityThrottleActive,
      isEventBlackoutActive,
      orderType,
      isPartialTPActive,
      isTimeStopActive,
      timeStopBars,
    } = req.body;

    const result = Backtester.run({
      fastEma: Number(fastEma || 12),
      slowEma: Number(slowEma || 26),
      rsiPeriod: Number(rsiPeriod || 14),
      rsiOverbought: Number(rsiOverbought || 70),
      rsiOversold: Number(rsiOversold || 30),
      atrPeriod: Number(atrPeriod || 14),
      atrMultiplierSL: Number(atrMultiplierSL || 1.5),
      atrMultiplierTP: Number(atrMultiplierTP || 3.0),
      feePercent: Number(feePercent !== undefined ? feePercent : 0.055),
      slippageTicks: Number(slippageTicks !== undefined ? slippageTicks : 1),
      walkForward: walkForward || 'none',
      isRegimeFilterActive: Boolean(isRegimeFilterActive),
      adxThreshold: adxThreshold !== undefined ? Number(adxThreshold) : 22,
      isVolatilitySizingActive: Boolean(isVolatilitySizingActive),
      riskPercent: riskPercent !== undefined ? Number(riskPercent) : 1.0,
      isEquityThrottleActive: Boolean(isEquityThrottleActive),
      isEventBlackoutActive: Boolean(isEventBlackoutActive),
      orderType: orderType || 'MARKET',
      isPartialTPActive: Boolean(isPartialTPActive),
      isTimeStopActive: Boolean(isTimeStopActive),
      timeStopBars: timeStopBars !== undefined ? Number(timeStopBars) : 20,
    });

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 7. TradingView Webhook trigger
app.post('/api/tradingview-webhook', async (req, res) => {
  try {
    const db = Database.get();
    const { settings } = db;
    const payload = req.body;

    console.log('Received Webhook alert payload:', payload);

    // 1. Authenticate passphrase
    if (settings.webhookPassphrase) {
      const receivedPass = payload.passphrase || payload.password || payload.secret;
      if (receivedPass !== settings.webhookPassphrase) {
        const log = Database.addLog({
          rawBody: payload,
          status: 'auth_failed',
          action: 'none',
          symbol: payload.symbol || settings.defaultSymbol,
          price: Number(payload.price || 0),
          quantity: Number(payload.volume || payload.quantity || settings.defaultOrderSize),
          message: `Unauthorized Webhook: Received secret "${receivedPass}" did not match terminal secret.`,
          mode: settings.isPaperTrading ? 'paper' : 'live',
        });
        return res.status(401).json({ error: 'Unauthorized', logId: log.id });
      }
    }

    // 2. Extract Action & Parameters
    // Action supports: buy / sell / close / long / short
    let actionRaw = (payload.action || payload.side || payload.direction || payload.order || '').toLowerCase();
    let action: 'buy' | 'sell' | 'close' | 'none' = 'none';

    if (actionRaw.includes('buy') || actionRaw.includes('long')) {
      action = 'buy';
    } else if (actionRaw.includes('sell') || actionRaw.includes('short')) {
      action = 'sell';
    } else if (actionRaw.includes('close') || actionRaw.includes('exit')) {
      action = 'close';
    }

    if (action === 'none') {
      const log = Database.addLog({
        rawBody: payload,
        status: 'ignored',
        action: 'none',
        symbol: payload.symbol || settings.defaultSymbol,
        price: Number(payload.price || 0),
        quantity: Number(payload.volume || payload.quantity || settings.defaultOrderSize),
        message: `Webhook Ignored: No executable action (buy, sell, close) detected in body.`,
        mode: settings.isPaperTrading ? 'paper' : 'live',
      });
      return res.status(400).json({ error: 'No executable action found', logId: log.id });
    }

    // Extract asset symbol, order size, and price
    const rawSymbol = (payload.symbol || payload.ticker || settings.defaultSymbol).toUpperCase();
    // Standardize symbol for Bybit (e.g. GOLD/XAU/XAUUSD -> XAUUSDT)
    let symbol = rawSymbol;
    if (symbol === 'GOLD' || symbol === 'XAU' || symbol === 'XAUUSD') {
      symbol = 'XAUUSDT';
    }

    const quantity = Number(payload.volume || payload.qty || payload.quantity || settings.defaultOrderSize);
    
    // Resolve execute price (use payload price or fetch market ticker)
    let price = Number(payload.price || 0);
    if (!price) {
      price = 2375.50 + (Math.random() - 0.5) * 10; // realistic gold default price if ticker fetch is not live
    }

    // --- REGIME SWITCHING ROUTER ---
    const adxValue = payload.adx !== undefined ? Number(payload.adx) : (21.5 + Math.random() * 5);
    const regimeResult = RegimeRouter.getActiveRegime({
      adxValue,
      forceRegime: settings.activeRegimeModule,
      adxThreshold: 22,
    });
    const activeModule = regimeResult.regime;
    const routerReason = regimeResult.reason;

    // --- CENTRAL RISK LAYER (VETO POWER) ---
    let finalQuantity = quantity;
    let riskReason = '';

    if (action === 'buy' || action === 'sell') {
      const riskVerdict = await CentralRiskManager.evaluateTradeRisk({
        symbol,
        side: action,
        quantity,
        price,
        settings,
      });

      if (!riskVerdict.allowed) {
        const log = Database.addLog({
          rawBody: payload,
          status: 'execution_failed',
          action,
          symbol,
          price,
          quantity,
          message: riskVerdict.reason || 'Central Risk Object Vetoed execution.',
          mode: settings.isPaperTrading ? 'paper' : 'live',
        });
        return res.status(400).json({ error: riskVerdict.reason, logId: log.id });
      }

      if (riskVerdict.modifiedQuantity !== undefined) {
        finalQuantity = riskVerdict.modifiedQuantity;
        riskReason = riskVerdict.reason || '';
      }
    }

    // 3. EXECUTION
    const mode = settings.isPaperTrading ? 'paper' : 'live';

    if (mode === 'paper') {
      // PAPER TRADING MODE
      let execMessage = '';

      if (action === 'buy') {
        // Close short positions for this symbol
        const closeResult = Database.closePaperPosition(symbol, price);
        
        // Calculate dynamic or static stops
        let stopLossPrice: number | undefined = undefined;
        let takeProfitPrice: number | undefined = undefined;
        let stopsReason = '';
        if (settings.isHybridStopsActive) {
          const stops = CentralRiskManager.calculateDynamicStops({
            price,
            side: 'buy',
            settings,
            payloadAtr: payload.atr ? Number(payload.atr) : undefined,
            activeModule,
          });
          stopLossPrice = stops.stopLossPrice;
          takeProfitPrice = stops.takeProfitPrice;
          stopsReason = stops.reason;
        }

        const openResult = Database.addPaperPosition({
          symbol,
          side: 'buy',
          entryPrice: price,
          quantity: finalQuantity,
          leverage: settings.defaultLeverage,
          stopLossPrice,
          takeProfitPrice,
          module: activeModule,
          routerReason,
        });

        execMessage = `Paper execution success. ${closeResult.closed ? closeResult.msg + ' | ' : ''}Opened LONG: ${finalQuantity} ${symbol} at ${price}. Module: ${activeModule.toUpperCase()}. ${stopsReason} ${riskReason}`;
      } else if (action === 'sell') {
        // Close long positions for this symbol
        const closeResult = Database.closePaperPosition(symbol, price);

        // Calculate dynamic or static stops
        let stopLossPrice: number | undefined = undefined;
        let takeProfitPrice: number | undefined = undefined;
        let stopsReason = '';
        if (settings.isHybridStopsActive) {
          const stops = CentralRiskManager.calculateDynamicStops({
            price,
            side: 'sell',
            settings,
            payloadAtr: payload.atr ? Number(payload.atr) : undefined,
            activeModule,
          });
          stopLossPrice = stops.stopLossPrice;
          takeProfitPrice = stops.takeProfitPrice;
          stopsReason = stops.reason;
        }

        const openResult = Database.addPaperPosition({
          symbol,
          side: 'sell',
          entryPrice: price,
          quantity: finalQuantity,
          leverage: settings.defaultLeverage,
          stopLossPrice,
          takeProfitPrice,
          module: activeModule,
          routerReason,
        });

        execMessage = `Paper execution success. ${closeResult.closed ? closeResult.msg + ' | ' : ''}Opened SHORT: ${finalQuantity} ${symbol} at ${price}. Module: ${activeModule.toUpperCase()}. ${stopsReason} ${riskReason}`;
      } else if (action === 'close') {
        const closeResult = Database.closePaperPosition(symbol, price);
        execMessage = closeResult.closed 
          ? `Paper exit executed: ${closeResult.msg}`
          : `Paper exit failed: No active position found for ${symbol}.`;
      }

      const log = Database.addLog({
        rawBody: payload,
        status: 'success',
        action,
        symbol,
        price,
        quantity: finalQuantity,
        message: execMessage,
        mode,
      });

      return res.json({ success: true, mode, logId: log.id, message: execMessage });
    } else {
      // REAL LIVE API EXECUTION MODE
      if (settings.activeBroker === 'mt5') {
        if (!settings.mt5Login || !settings.mt5Password) {
          const errMsg = 'MT5 Account Login credentials are missing. Please configure them in Settings or enable Paper Trading.';
          const log = Database.addLog({
            rawBody: payload,
            status: 'execution_failed',
            action,
            symbol,
            price,
            quantity: finalQuantity,
            message: errMsg,
            mode,
          });
          return res.status(400).json({ error: errMsg, logId: log.id });
        }

        try {
          const client = new MT5Client({
            host: settings.mt5Host,
            login: settings.mt5Login,
            password: settings.mt5Password,
            server: settings.mt5Server,
            gatewayType: settings.mt5GatewayType,
            gatewayUrl: settings.mt5GatewayUrl,
            gatewayToken: settings.mt5GatewayToken,
          });

          let orderResult;
          let execMessage = '';

          // Calculate stops for exchange placement
          let slString: string | undefined = undefined;
          let tpString: string | undefined = undefined;

          // Standardize MT5 symbol format (usually XAUUSD for gold on prop firms)
          let mt5Symbol = symbol;
          if (symbol === 'XAUUSDT') {
            mt5Symbol = 'XAUUSD';
          }

          if (action === 'buy') {
            if (settings.isHybridStopsActive) {
              slString = (price * (1 - settings.stopLossPercent / 100)).toFixed(2);
              tpString = (price * (1 + settings.takeProfitPercent / 100)).toFixed(2);
            }

            orderResult = await client.placeOrder({
              symbol: mt5Symbol,
              side: 'Buy',
              qty: String(finalQuantity),
              orderType: 'Market',
              stopLoss: slString,
              takeProfit: tpString,
            });
            execMessage = `MT5 order created: Market BUY of ${finalQuantity} ${mt5Symbol}. Module: ${activeModule.toUpperCase()}. Stops: [SL: ${slString || 'None'}, TP: ${tpString || 'None'}]. (Order ID: ${orderResult.orderId}) ${riskReason}`;
          } else if (action === 'sell') {
            if (settings.isHybridStopsActive) {
              slString = (price * (1 + settings.stopLossPercent / 100)).toFixed(2);
              tpString = (price * (1 - settings.takeProfitPercent / 100)).toFixed(2);
            }

            orderResult = await client.placeOrder({
              symbol: mt5Symbol,
              side: 'Sell',
              qty: String(finalQuantity),
              orderType: 'Market',
              stopLoss: slString,
              takeProfit: tpString,
            });
            execMessage = `MT5 order created: Market SELL of ${finalQuantity} ${mt5Symbol}. Module: ${activeModule.toUpperCase()}. Stops: [SL: ${slString || 'None'}, TP: ${tpString || 'None'}]. (Order ID: ${orderResult.orderId}) ${riskReason}`;
          } else if (action === 'close') {
            const positions = await client.getPositions(mt5Symbol);
            const activePos = positions.find((p: any) => parseFloat(p.volume || p.qty || p.size || '0') > 0);
            
            if (!activePos) {
              execMessage = `MT5 exit aborted: No active position found on MT5 for ${mt5Symbol}.`;
            } else {
              const side = (activePos.type || activePos.side || 'Buy').toLowerCase().includes('sell') ? 'Buy' : 'Sell';
              const qty = activePos.volume || activePos.qty || activePos.size;
              orderResult = await client.placeOrder({
                symbol: mt5Symbol,
                side,
                qty: String(qty),
                orderType: 'Market',
              });
              execMessage = `MT5 exit order created: Closed position with Market ${side.toUpperCase()} of ${qty} ${mt5Symbol} (Order ID: ${orderResult.orderId})`;
            }
          }

          const log = Database.addLog({
            rawBody: payload,
            status: orderResult ? 'success' : 'execution_failed',
            action,
            symbol: mt5Symbol,
            price,
            quantity: finalQuantity,
            message: execMessage,
            mode,
          });

          return res.json({ success: true, mode, logId: log.id, message: execMessage, orderResult });
        } catch (err: any) {
          const errMsg = `MT5 Execution failed: ${err.message || err}`;
          const log = Database.addLog({
            rawBody: payload,
            status: 'execution_failed',
            action,
            symbol,
            price,
            quantity: finalQuantity,
            message: errMsg,
            mode,
          });
          return res.status(500).json({ error: errMsg, logId: log.id });
        }
      } else {
        // REAL BYBIT API EXECUTION MODE
        if (!settings.bybitApiKey || !settings.bybitApiSecret) {
          const errMsg = 'Bybit API Keys are missing. Please configure them in Settings or enable Paper Trading.';
          const log = Database.addLog({
            rawBody: payload,
            status: 'execution_failed',
            action,
            symbol,
            price,
            quantity: finalQuantity,
            message: errMsg,
            mode,
          });
          return res.status(400).json({ error: errMsg, logId: log.id });
        }

        try {
          const client = new BybitClient({
            apiKey: settings.bybitApiKey,
            apiSecret: settings.bybitApiSecret,
            isTestnet: settings.isTestnet,
          });

          let orderResult;
          let execMessage = '';

          // Calculate stops for exchange placement
          let slString: string | undefined = undefined;
          let tpString: string | undefined = undefined;

          if (action === 'buy') {
            if (settings.isHybridStopsActive) {
              slString = (price * (1 - settings.stopLossPercent / 100)).toFixed(2);
              tpString = (price * (1 + settings.takeProfitPercent / 100)).toFixed(2);
            }

            orderResult = await client.placeOrder({
              symbol,
              side: 'Buy',
              qty: String(finalQuantity),
              orderType: 'Market',
              stopLoss: slString,
              takeProfit: tpString,
            });
            execMessage = `Bybit order created: Market BUY of ${finalQuantity} ${symbol}. Module: ${activeModule.toUpperCase()}. Stops on server: [SL: ${slString || 'None'}, TP: ${tpString || 'None'}]. (Order ID: ${orderResult.orderId}) ${riskReason}`;
          } else if (action === 'sell') {
            if (settings.isHybridStopsActive) {
              slString = (price * (1 + settings.stopLossPercent / 100)).toFixed(2);
              tpString = (price * (1 - settings.takeProfitPercent / 100)).toFixed(2);
            }

            orderResult = await client.placeOrder({
              symbol,
              side: 'Sell',
              qty: String(finalQuantity),
              orderType: 'Market',
              stopLoss: slString,
              takeProfit: tpString,
            });
            execMessage = `Bybit order created: Market SELL of ${finalQuantity} ${symbol}. Module: ${activeModule.toUpperCase()}. Stops on server: [SL: ${slString || 'None'}, TP: ${tpString || 'None'}]. (Order ID: ${orderResult.orderId}) ${riskReason}`;
          } else if (action === 'close') {
            // Close: get active position and reverse it
            const positions = await client.getPositions(symbol);
            const activePos = positions.find((p: any) => parseFloat(p.size) > 0);
            
            if (!activePos) {
              execMessage = `Bybit exit aborted: No active position found on Bybit for ${symbol}.`;
            } else {
              const side = activePos.side === 'Buy' ? 'Sell' : 'Buy';
              const qty = activePos.size;
              orderResult = await client.placeOrder({
                symbol,
                side,
                qty,
                orderType: 'Market',
              });
              execMessage = `Bybit exit order created: Closed position with Market ${side.toUpperCase()} of ${qty} ${symbol} (Order ID: ${orderResult.orderId})`;
            }
          }

          const log = Database.addLog({
            rawBody: payload,
            status: orderResult ? 'success' : 'execution_failed',
            action,
            symbol,
            price,
            quantity: finalQuantity,
            message: execMessage,
            mode,
          });

          return res.json({ success: true, mode, logId: log.id, message: execMessage, orderResult });
        } catch (err: any) {
          const errMsg = `Bybit Execution failed: ${err.message || err}`;
          const log = Database.addLog({
            rawBody: payload,
            status: 'execution_failed',
            action,
            symbol,
            price,
            quantity: finalQuantity,
            message: errMsg,
            mode,
          });
          return res.status(500).json({ error: errMsg, logId: log.id });
        }
      }
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 8. Generate PineScript Alerts using Gemini
app.post('/api/generate-pinescript', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const ai = getGeminiClient();
  if (!ai) {
    // Elegant static fallback if Gemini API Key isn't loaded
    const db = Database.get();
    const passphrase = db.settings.webhookPassphrase || 'GOLD_ALGO_88';
    const staticPineScript = `//@version=5
strategy("Bybit Gold Webhook Strategy", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=10)

// Config Settings
passphrase = "${passphrase}"
symbol = "XAUUSDT"
volume = 0.1

// Strategy Logic (Simple MA Crossover)
fastMA = ta.sma(close, 9)
slowMA = ta.sma(close, 21)

buySignal = ta.crossover(fastMA, slowMA)
sellSignal = ta.crossunder(fastMA, slowMA)

plot(fastMA, color=color.green, title="Fast MA")
plot(slowMA, color=color.red, title="Slow MA")

// Send Webhook alert payloads as JSON using alert() or strategy alerts
if (buySignal)
    strategy.entry("Long", strategy.long)
    alert('{"passphrase": "' + passphrase + '", "action": "buy", "symbol": "' + symbol + '", "volume": ' + str.tostring(volume) + ', "price": ' + str.tostring(close) + ', "comment": "SMA Cross Long"}', alert.freq_once_per_bar)

if (sellSignal)
    strategy.entry("Short", strategy.short)
    alert('{"passphrase": "' + passphrase + '", "action": "sell", "symbol": "' + symbol + '", "volume": ' + str.tostring(volume) + ', "price": ' + str.tostring(close) + ', "comment": "SMA Cross Short"}', alert.freq_once_per_bar)
`;
    return res.json({
      script: staticPineScript,
      isDemo: true,
      message: 'Generated Pine Script template using responsive fallback. Configure your GEMINI_API_KEY secret in settings to get custom strategies tailored by AI.',
    });
  }

  try {
    const db = Database.get();
    const passphrase = db.settings.webhookPassphrase || 'GOLD_ALGO_88';
    const symbol = db.settings.defaultSymbol || 'XAUUSDT';
    const qty = db.settings.defaultOrderSize || 0.1;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: `You are an expert Pine Script (v5) developer. A gold trader wants a Pine Script for TradingView that connects with their custom webhook execution bot.
      The prompt description is: "${prompt}"

      The webhook endpoint accepts JSON alerts with the following exact schema:
      - passphrase: "${passphrase}"
      - action: "buy" | "sell" | "close"
      - symbol: "${symbol}" (standardized to XAUUSDT on Bybit)
      - volume: ${qty}
      - price: (the closing price, like double value)
      - comment: "Some optional string detail"

      Provide a fully complete, professional, compilation-ready Pine Script v5 that implements this logic.
      Make sure to embed the exact JSON alert payloads inside alert() functions so that when the signal triggers, it fires the webhook perfectly with the right parameters.
      Use clear variable names, elegant formatting, and add explanatory comments.
      Output ONLY the Pine Script v5 code inside a markdown code block, preceded and followed by a very short instruction on how to paste it in TradingView and set the Webhook URL.`,
    });

    res.json({ script: response.text });
  } catch (e: any) {
    res.status(500).json({ error: `AI Generation failed: ${e.message}` });
  }
});

// Vite server middleware integration for dev
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
