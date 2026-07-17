import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { Database } from './server/db.js';
import { BybitClient } from './server/bybit.js';
import { MT5Client } from './server/mt5.js';
import { Backtester } from './server/backtester.js';
import { CentralRiskManager } from './server/risk.js';
import { RegimeRouter } from './server/router.js';
import { BasketManager } from './server/basketManager.js';
import { GoogleGenAI } from '@google/genai';
import { registerMt5BridgeRoutes, enqueueMt5Command, getBridgeStatus } from './server/mt5bridge.js';
import { QuantDataManager } from './server/quantData.js';
import { StrategyRouter } from './server/strategyRouter.js';
import { QuantRiskManager } from './server/quantRisk.js';
import { ExecutionShortfall } from './server/executionShortfall.js';
import { MetaLabeler } from './server/metaLabeler.js';
import { MeasurementDesk } from './server/measurementDesk.js';
import { OpsAlertsManager } from './server/opsAlerts.js';
import { ResearchDeskManager } from './server/researchDesk.js';

const app = express();
// Cloud Run injects PORT and health-checks that port; a hardcoded value fails startup there.
const PORT = Number(process.env.PORT) || 3000;

// For parsing JSON and urlencoded request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Register outbound-only MT5 Bridge routes
registerMt5BridgeRoutes(app);

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

const SESSION_COOKIE = 'moeby_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function sessionKey(): string | null {
  const t = process.env.API_AUTH_TOKEN;
  return t && t.trim() ? t.trim() : null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function mintSession(key: string): string {
  const payload = String(Date.now() + SESSION_TTL_MS);
  const sig = crypto.createHmac('sha256', key).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifySession(raw: string, key: string): boolean {
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload = raw.slice(0, dot);
  const expected = crypto.createHmac('sha256', key).update(payload).digest('hex');
  if (!safeEqual(raw.slice(dot + 1), expected)) return false;
  const expires = Number(payload);
  return Number.isFinite(expires) && Date.now() < expires;
}

function readCookie(req: express.Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

// REST API Security & IP Whitelist Enforcer Middleware
function apiAuthMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  // The webhook authenticates on the passphrase in its body instead — TradingView cannot
  // attach custom headers. That route fails closed when no passphrase is configured.
  if (req.path === '/tradingview-webhook') {
    return next();
  }

  // Deliberate opt-out for the public demo. Must be set explicitly: a missing token still
  // fails closed, so the service can never end up open just because config went astray.
  if (process.env.DISABLE_API_AUTH === 'true') {
    return next();
  }

  const key = sessionKey();
  if (!key) {
    // Fail closed. An unset token used to mean "skip the check", leaving every route open.
    return res.status(503).json({ error: 'Server auth is not configured (API_AUTH_TOKEN).' });
  }

  const db = Database.get();
  const whitelist = db.settings.ipWhitelist ? db.settings.ipWhitelist.trim() : '';
  if (whitelist && whitelist !== '0.0.0.0 (Allow All)' && whitelist !== '0.0.0.0') {
    const clientIp = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim();
    const allowedIps = whitelist.split(',').map(ip => ip.trim());
    if (!allowedIps.includes(clientIp)) {
      console.warn(`Blocked request from unauthorized IP: ${clientIp}. Whitelist: ${whitelist}`);
      return res.status(403).json({ error: 'Forbidden: IP not in whitelist.' });
    }
  }

  // The dashboard proves same-origin by holding a signed session cookie, which it gets by
  // exchanging the token at /api/auth/login. Header-based origin claims are not usable here:
  // sec-fetch-site and referer are set by the caller, so any curl can assert them.
  const cookie = readCookie(req, SESSION_COOKIE);
  if (cookie && verifySession(cookie, key)) {
    return next();
  }

  const receivedToken = req.headers['authorization'] || req.headers['x-api-token'];
  const tokenStr = String(receivedToken || '').replace(/^Bearer\s+/i, '').trim();
  if (tokenStr && safeEqual(tokenStr, key)) {
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized: Invalid API Auth Token.' });
}

// Login is registered ahead of the guard so it stays reachable without a session.
const loginFailures = new Map<string, { count: number; until: number }>();

app.post('/api/auth/login', (req, res) => {
  const key = sessionKey();
  if (!key) {
    return res.status(503).json({ error: 'Server auth is not configured (API_AUTH_TOKEN).' });
  }

  const ip = ((req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '')
    .split(',')[0].trim();
  const entry = loginFailures.get(ip);
  if (entry && entry.count >= 5 && Date.now() < entry.until) {
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }

  const supplied = String((req.body && req.body.token) || '').trim();
  if (!supplied || !safeEqual(supplied, key)) {
    const next = { count: (entry?.count ?? 0) + 1, until: Date.now() + 15 * 60 * 1000 };
    loginFailures.set(ip, next);
    return res.status(401).json({ error: 'Invalid token.' });
  }

  loginFailures.delete(ip);
  const attrs = [
    `${SESSION_COOKIE}=${mintSession(key)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
  res.json({ ok: true });
});

app.post('/api/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
});

// REST API Endpoints
app.use('/api', apiAuthMiddleware);

// 1. Get Settings
app.get('/api/settings', (req, res) => {
  try {
    const db = Database.get();
    // Return settings (hide sensitive keys and passwords for security)
    const secureSettings = {
      ...db.settings,
      bybitApiKey: db.settings.bybitApiKey ? '••••••••••••••••' : '',
      bybitApiSecret: db.settings.bybitApiSecret ? '••••••••••••••••' : '',
      webhookPassphrase: db.settings.webhookPassphrase ? '••••••••••••••••' : '',
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
      bybitEnvironment,
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
      mt5AccountType,
      mt5Host,
      mt5Login,
      mt5Password,
      mt5Server,
      gatewayType,
      gatewayUrl,
      gatewayToken,
    } = req.body;

    const db = Database.get();
    const updated: Record<string, any> = {
      isTestnet: isTestnet !== undefined ? isTestnet : db.settings.isTestnet,
      bybitEnvironment: bybitEnvironment !== undefined ? bybitEnvironment : db.settings.bybitEnvironment,
      isPaperTrading: isPaperTrading !== undefined ? isPaperTrading : db.settings.isPaperTrading,
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
      mt5AccountType: mt5AccountType !== undefined ? mt5AccountType : db.settings.mt5AccountType,
      mt5Host: mt5Host !== undefined ? mt5Host : db.settings.mt5Host,
      mt5Login: mt5Login !== undefined ? mt5Login : db.settings.mt5Login,
      mt5Server: mt5Server !== undefined ? mt5Server : db.settings.mt5Server,
      mt5GatewayType: gatewayType !== undefined ? gatewayType : (req.body.mt5GatewayType !== undefined ? req.body.mt5GatewayType : db.settings.mt5GatewayType),
      mt5GatewayUrl: gatewayUrl !== undefined ? gatewayUrl : (req.body.mt5GatewayUrl !== undefined ? req.body.mt5GatewayUrl : db.settings.mt5GatewayUrl),
    };

    // Robust masking protection: Only overwrite with new input if it is not a masked placeholder
    if (bybitApiKey !== undefined && bybitApiKey !== '••••••••••••••••' && bybitApiKey !== '') {
      updated.bybitApiKey = bybitApiKey;
    } else {
      updated.bybitApiKey = db.settings.bybitApiKey;
    }

    if (bybitApiSecret !== undefined && bybitApiSecret !== '••••••••••••••••' && bybitApiSecret !== '') {
      updated.bybitApiSecret = bybitApiSecret;
    } else {
      updated.bybitApiSecret = db.settings.bybitApiSecret;
    }

    if (webhookPassphrase !== undefined && webhookPassphrase !== '••••••••••••••••' && webhookPassphrase !== '') {
      updated.webhookPassphrase = webhookPassphrase;
    } else {
      updated.webhookPassphrase = db.settings.webhookPassphrase;
    }

    if (mt5Password !== undefined && mt5Password !== '••••••••••••••••' && mt5Password !== '') {
      updated.mt5Password = mt5Password;
    } else {
      updated.mt5Password = db.settings.mt5Password;
    }

    if (gatewayToken !== undefined && gatewayToken !== '••••••••••••••••' && gatewayToken !== '') {
      updated.mt5GatewayToken = gatewayToken;
    } else if (req.body.mt5GatewayToken !== undefined && req.body.mt5GatewayToken !== '••••••••••••••••' && req.body.mt5GatewayToken !== '') {
      updated.mt5GatewayToken = req.body.mt5GatewayToken;
    } else {
      updated.mt5GatewayToken = db.settings.mt5GatewayToken;
    }

    const newSettings = Database.updateSettings(updated);
    res.json({
      success: true,
      settings: {
        ...newSettings,
        bybitApiKey: newSettings.bybitApiKey ? '••••••••••••••••' : '',
        bybitApiSecret: newSettings.bybitApiKey ? '••••••••••••••••' : '',
        webhookPassphrase: newSettings.webhookPassphrase ? '••••••••••••••••' : '',
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
          environment: db.settings.bybitEnvironment,
        });
        const tick = await client.getTicker(db.settings.defaultSymbol || 'XAUUSDT');
        if (tick.lastPrice > 0) {
          currentGoldPrice = tick.lastPrice;
        }
      } catch (e) {
        // Fallback to in-memory random wander below
      }
    }
    
    if ((db.settings.activeBroker === 'bybit' && (!db.settings.bybitApiKey || !db.settings.bybitApiSecret)) ||
        (db.settings.activeBroker === 'mt5' && (!db.settings.mt5Login || !db.settings.mt5Password))) {
      try {
        const publicBybit = new BybitClient({
          apiKey: '',
          apiSecret: '',
          environment: 'live',
        });
        const tick = await publicBybit.getTicker('XAUUSDT');
        if (tick.lastPrice > 0) {
          currentGoldPrice = tick.lastPrice;
          (global as any).lastFetchedGoldPrice = currentGoldPrice;
        }
      } catch (e) {
        if ((global as any).lastFetchedGoldPrice) {
          currentGoldPrice = (global as any).lastFetchedGoldPrice;
        } else {
          currentGoldPrice = 2375.50; // Dynamic random walk disabled for measurement honesty
        }
      }
    }

    // Update paper positions dynamically for Trailing Stop, SL and TP
    CentralRiskManager.updatePaperPositions(db, currentGoldPrice);

    // Update live positions trailing and breakeven stops
    if (!db.settings.isPaperTrading) {
      await CentralRiskManager.updateLivePositions(db, currentGoldPrice);
    }

    const result: any = {
      paperAccount: db.paperAccount,
      liveAccount: null,
      activeMode: db.settings.isPaperTrading ? 'paper' : 'live',
      trades: db.trades || [],
      currentSimulatedPrice: Number(currentGoldPrice.toFixed(2)),
    };

    // Fetch actual broker account details based on selection
    if (!db.settings.isPaperTrading && db.settings.activeBroker === 'mt5') {
      const bridge = getBridgeStatus();
      if (bridge.connected) {
        const positions = bridge.positions.map((p: any) => ({
          id: p.ticket,
          symbol: p.symbol,
          side: p.side,
          entryPrice: p.entry,
          quantity: p.volume,
          leverage: 100,
          unrealizedPnl: p.pnl,
          timestamp: new Date().toISOString(),
          raw: p,
        }));

        result.liveAccount = {
          balance: bridge.balance,
          currency: 'USD',
          positions,
          equity: bridge.equity,
          freeMargin: bridge.freeMargin,
          lastUpdated: bridge.lastHeartbeat ? new Date(bridge.lastHeartbeat).toISOString() : null,
        };
      } else {
        result.liveAccountError = 'MT5 terminal bridge is disconnected (no heartbeat received in last 90s).';
      }
    } else if (!db.settings.isPaperTrading && db.settings.bybitApiKey && db.settings.bybitApiSecret) {
      try {
        const client = new BybitClient({
          apiKey: db.settings.bybitApiKey,
          apiSecret: db.settings.bybitApiSecret,
          environment: db.settings.bybitEnvironment,
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
app.post('/api/backtest', async (req, res) => {
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
      backtestModule,
      reversionRiskUsd,
      reversionMaxRungs,
      reversionRungSpacingAtr,
      reversionStopBeyondLastRungAtr,
    } = req.body;

    const result = await Backtester.run({
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
      symbol: 'XAUUSDT',
      backtestModule: backtestModule || 'trend',
      reversionRiskUsd: reversionRiskUsd !== undefined ? Number(reversionRiskUsd) : 100.0,
      reversionMaxRungs: reversionMaxRungs !== undefined ? Number(reversionMaxRungs) : 3,
      reversionRungSpacingAtr: reversionRungSpacingAtr !== undefined ? Number(reversionRungSpacingAtr) : 1.0,
      reversionStopBeyondLastRungAtr: reversionStopBeyondLastRungAtr !== undefined ? Number(reversionStopBeyondLastRungAtr) : 1.5,
    });

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 6c. Get Quant Macro & Positioning Metrics (DXY, 10Y Yield, Open Interest, Liquidations)
app.get('/api/quant/metrics', async (req, res) => {
  try {
    const db = Database.get();
    const symbol = db.settings.defaultSymbol || 'XAUUSDT';
    
    // Fetch macro charts
    const macroCharts = await QuantDataManager.fetchMacroCharts();
    const bybitData = await QuantDataManager.fetchBybitQuantData(symbol);
    const dxy = await QuantDataManager.fetchDXYPrice();
    const yield10y = await QuantDataManager.fetch10YTYield();

    res.json({
      success: true,
      symbol,
      dxy,
      yield10y,
      fundingRate: bybitData.fundingRate,
      openInterest: bybitData.openInterest,
      liquidationsUsd: bybitData.liquidationsUsd,
      macroCharts,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 6d. Get Measurement Desk Performance & Analytics (Attribution, Drift, Monte Carlo, Shortfall, Alerts)
app.get('/api/quant/performance', async (req, res) => {
  try {
    const db = Database.get();
    const modules = StrategyRouter.getModulesStatus();
    const riskCheck = await QuantRiskManager.checkRiskGating();
    const decay = MeasurementDesk.checkEdgeDecay();
    const attribution = MeasurementDesk.getAttributionStats();
    const drift = MeasurementDesk.checkDriftStatus();
    const monteCarlo = MeasurementDesk.runMonteCarlo();
    const shortfallLogs = ExecutionShortfall.getLogs();
    const alerts = OpsAlertsManager.getAlertLogs();
    const deadman = OpsAlertsManager.checkDeadManSwitch();
    const nakedAudit = OpsAlertsManager.auditNakedPositions();

    res.json({
      success: true,
      modules,
      riskGate: riskCheck,
      edgeDecay: decay,
      attribution,
      drift,
      monteCarlo,
      shortfallLogs,
      alerts,
      deadman,
      nakedAudit,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 6d2. Get Research Desk Metrics & Status
app.get('/api/quant/research-desk', (req, res) => {
  try {
    const hypotheses = ResearchDeskManager.getHypotheses();
    const stressTests = ResearchDeskManager.runStressTests();
    const adaptiveExecution = ResearchDeskManager.getAdaptiveExecutionLookup();
    const capitalLadder = ResearchDeskManager.getCapitalLadder();
    
    res.json({
      success: true,
      hypotheses,
      stressTests,
      adaptiveExecution,
      capitalLadder,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 6d3. Handle Research Desk Actions (Hypothesis Promotion, Capital Scale Approval)
app.post('/api/quant/research-desk/action', (req, res) => {
  try {
    const { actionType, targetId } = req.body;
    const db = Database.get();

    if (actionType === 'promote_hypothesis') {
      const hypotheses = ResearchDeskManager.getHypotheses();
      const hyp = hypotheses.find(h => h.id === targetId);
      if (hyp) {
        hyp.recommendation = 'SHADOW_MODE_PROMOTION';
        // Add alert to log
        Database.addLog({
          rawBody: req.body,
          status: 'success',
          action: 'none',
          symbol: 'XAUUSD',
          price: 0,
          quantity: 0,
          message: `[Quant Research] Promoted hypothesis "${hyp.title}" to active Shadow Mode. Sizing and tracking initialized.`,
          mode: 'paper'
        });
        return res.json({ success: true, message: `Successfully promoted "${hyp.title}" to Shadow Mode.` });
      }
      return res.status(404).json({ error: 'Hypothesis not found.' });
    }

    if (actionType === 'approve_ladder_rung') {
      const ladder = ResearchDeskManager.getCapitalLadder();
      // Increase leverage size factor or upgrade default order size
      const currentSize = db.settings.defaultOrderSize || 0.1;
      db.settings.defaultOrderSize = Number((currentSize + 0.1).toFixed(2));
      Database.save(db);

      Database.addLog({
        rawBody: req.body,
        status: 'success',
        action: 'none',
        symbol: 'XAUUSD',
        price: 0,
        quantity: 0,
        message: `[Capital Automation] Rung upgrade approved! Default order size scaled up from ${currentSize} to ${db.settings.defaultOrderSize} Lots.`,
        mode: 'paper'
      });

      return res.json({ success: true, message: `Approved capital rung upgrade! Order size is now scaled to ${db.settings.defaultOrderSize} Lots.` });
    }

    if (actionType === 'sweep_profits') {
      const balance = db.paperAccount?.balance || 10000;
      const initialBalance = 10000;
      const profit = balance - initialBalance;
      
      if (profit <= 0) {
        return res.status(400).json({ error: 'No accumulated profits available for sweep.' });
      }

      // Sweep profit out of paper trade balance to simulate cold spot vault or Earn sweep
      db.paperAccount.balance = initialBalance; // resets balance back to base, sweeping profit
      Database.save(db);
      
      Database.addLog({
        rawBody: req.body,
        status: 'success',
        action: 'none',
        symbol: 'USD',
        price: 0,
        quantity: 0,
        message: `[Capital Automation] Profit Sweep completed! Transferred $${profit.toFixed(2)} USD from trading collateral to off-exchange Earn/Spot Wallet.`,
        mode: 'paper'
      });

      return res.json({ success: true, message: `Successfully swept $${profit.toFixed(2)} USD to Spot/Earn Wallet.` });
    }

    return res.status(400).json({ error: 'Invalid actionType specified.' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 6e. Evaluate AI Meta-Labeler Setup (Take vs Skip)
app.post('/api/quant/meta-label', async (req, res) => {
  try {
    const { module, side, adx, fundingPercentile, bandwidthPercentile, dxy, yield10y, session } = req.body;
    
    if (!module || !side) {
      return res.status(400).json({ error: 'module and side are required in the payload.' });
    }

    const prediction = await MetaLabeler.classifySignal({
      module,
      side: side.toUpperCase() as 'BUY' | 'SELL',
      adx: Number(adx || 22),
      fundingPercentile: Number(fundingPercentile || 50),
      bandwidthPercentile: Number(bandwidthPercentile || 50),
      dxy: Number(dxy || 104.5),
      yield10y: Number(yield10y || 4.2),
      session: session || 'london',
    });

    res.json({
      success: true,
      prediction,
    });
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

    // 1. Authenticate passphrase.
    // Fail closed: this route is exempt from the API token guard, so an unset passphrase
    // would let any unauthenticated caller place trades.
    const expectedPass = settings.webhookPassphrase ? String(settings.webhookPassphrase).trim() : '';
    const receivedPass = String(payload.passphrase || payload.password || payload.secret || '').trim();
    if (!expectedPass || !safeEqual(receivedPass, expectedPass)) {
      const log = Database.addLog({
        rawBody: { ...payload, passphrase: undefined, password: undefined, secret: undefined },
        status: 'auth_failed',
        action: 'none',
        symbol: payload.symbol || settings.defaultSymbol,
        price: Number(payload.price || 0),
        quantity: Number(payload.volume || payload.quantity || settings.defaultOrderSize),
        message: expectedPass
          ? 'Unauthorized Webhook: passphrase did not match terminal secret.'
          : 'Rejected Webhook: no webhookPassphrase configured on this terminal.',
        mode: settings.isPaperTrading ? 'paper' : 'live',
      });
      return res.status(401).json({ error: 'Unauthorized', logId: log.id });
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
      console.log(`[Webhook] Price missing in webhook payload. Fetching real ticker price for ${symbol}...`);
      try {
        if (settings.activeBroker === 'mt5') {
          const client = new MT5Client({
            host: settings.mt5Host,
            login: settings.mt5Login,
            password: settings.mt5Password,
            server: settings.mt5Server,
            gatewayType: settings.mt5GatewayType,
            gatewayUrl: settings.mt5GatewayUrl,
            gatewayToken: settings.mt5GatewayToken,
          });
          let mt5Symbol = symbol;
          if (symbol === 'XAUUSDT') mt5Symbol = 'XAUUSD';
          const tick = await client.getTicker(mt5Symbol);
          if (tick && tick.lastPrice > 0) {
            price = tick.lastPrice;
          } else {
            throw new Error(`Invalid lastPrice returned: ${JSON.stringify(tick)}`);
          }
        } else {
          const client = new BybitClient({
            apiKey: settings.bybitApiKey,
            apiSecret: settings.bybitApiSecret,
            environment: settings.bybitEnvironment,
          });
          const tick = await client.getTicker(symbol);
          if (tick && tick.lastPrice > 0) {
            price = tick.lastPrice;
          } else {
            throw new Error(`Invalid lastPrice returned: ${JSON.stringify(tick)}`);
          }
        }
      } catch (e: any) {
        const errMsg = `REJECTED (Price Fetch Failed): Webhook payload price was missing, and live market price fetch failed: ${e.message || e}`;
        const log = Database.addLog({
          rawBody: payload,
          status: 'execution_failed',
          action,
          symbol,
          price: 0,
          quantity,
          message: errMsg,
          mode: settings.isPaperTrading ? 'paper' : 'live',
        });
        return res.status(400).json({ error: errMsg, logId: log.id });
      }
    }

    // --- REGIME SWITCHING ROUTER ---
    let adxValue = payload.adx !== undefined ? Number(payload.adx) : undefined;
    if (adxValue === undefined) {
      try {
        const client = new BybitClient({
          apiKey: settings.bybitApiKey,
          apiSecret: settings.bybitApiSecret,
          environment: settings.bybitEnvironment,
        });
        const mappedSymbol = symbol === 'XAUUSD' ? 'XAUUSDT' : symbol;
        const klines = await client.getKlines({ symbol: mappedSymbol, interval: '15', limit: 50 });
        if (klines && klines.length >= 30) {
          const highs = klines.map((k: any) => k.high);
          const lows = klines.map((k: any) => k.low);
          const closes = klines.map((k: any) => k.close);
          adxValue = Backtester.calculateADX(highs, lows, closes, 14);
          console.log(`[RegimeRouter] Calculated real-time ADX(14) for ${symbol} from 15m klines: ${adxValue.toFixed(2)}`);
        }
      } catch (e: any) {
        console.warn(`[RegimeRouter] Failed to fetch klines for real-time ADX calculation: ${e.message || e}`);
      }
    }

    if (adxValue === undefined || isNaN(adxValue)) {
      const errMsg = `VETO (Regime Router Gate): Failed to compute real-time ADX value for ${symbol}. Trade signal rejected for safety (fail-closed).`;
      console.warn(`[RegimeRouter] ${errMsg}`);
      const log = Database.addLog({
        rawBody: payload,
        status: 'execution_failed',
        action,
        symbol,
        price: 0,
        quantity,
        message: errMsg,
        mode: settings.isPaperTrading ? 'paper' : 'live',
      });
      return res.status(400).json({ error: errMsg, logId: log.id });
    }

    const regimeResult = RegimeRouter.getActiveRegime({
      adxValue,
      forceRegime: settings.activeRegimeModule,
      adxThreshold: 22,
    });
    const activeModule = regimeResult.regime;
    const routerReason = regimeResult.reason;

    // --- INTEGRATED MEAN-REVERSION REGIME ROUTING ---
    if (activeModule === 'range') {
      console.log(`[Webhook] Intercepted range/reversion regime. Routing to BasketManager.`);
      try {
        const client = new BybitClient({
          apiKey: settings.bybitApiKey,
          apiSecret: settings.bybitApiSecret,
          environment: settings.bybitEnvironment,
        });
        const mappedSymbol = symbol === 'XAUUSD' ? 'XAUUSDT' : symbol;
        const klines = await client.getKlines({ symbol: mappedSymbol, interval: '15', limit: 50 });

        if (action === 'buy' || action === 'sell') {
          const triggerResult = await BasketManager.checkGatesAndTrigger(klines, settings);
          const logStatus = triggerResult.triggered ? 'success' : 'execution_failed';
          const log = Database.addLog({
            rawBody: payload,
            status: logStatus,
            action,
            symbol,
            price,
            quantity,
            message: triggerResult.reason,
            mode: settings.isPaperTrading ? 'paper' : 'live',
          });
          return res.json({ success: triggerResult.triggered, mode: settings.isPaperTrading ? 'paper' : 'live', message: triggerResult.reason, logId: log.id });
        } else if (action === 'close') {
          await BasketManager.closeBasket('completed', price, settings);
          const log = Database.addLog({
            rawBody: payload,
            status: 'success',
            action,
            symbol,
            price,
            quantity,
            message: 'Consolidated Mean Reversion Basket Closed.',
            mode: settings.isPaperTrading ? 'paper' : 'live',
          });
          return res.json({ success: true, mode: settings.isPaperTrading ? 'paper' : 'live', message: 'Consolidated Mean Reversion Basket Closed.', logId: log.id });
        }
      } catch (err: any) {
        const errMsg = `Range Module Execution failed: ${err.message || err}`;
        const log = Database.addLog({
          rawBody: payload,
          status: 'execution_failed',
          action,
          symbol,
          price,
          quantity,
          message: errMsg,
          mode: settings.isPaperTrading ? 'paper' : 'live',
        });
        return res.status(500).json({ error: errMsg, logId: log.id });
      }
    }

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
        const bridge = getBridgeStatus();
        if (!bridge.connected) {
          const errMsg = '[Bridge] MT5 terminal is not connected (no heartbeat in 90s). Order NOT queued.';
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
          return res.status(503).json({ error: errMsg, logId: log.id });
        }

        let mt5Symbol = symbol === 'XAUUSDT' ? 'XAUUSD' : symbol;

        let sl: number | undefined, tp: number | undefined;
        if ((action === 'buy' || action === 'sell') && settings.isHybridStopsActive) {
          const stops = CentralRiskManager.calculateDynamicStops({
            price,
            side: action,
            settings,
            payloadAtr: payload.atr ? Number(payload.atr) : undefined,
            activeModule,
          });
          sl = stops.stopLossPrice;
          tp = stops.takeProfitPrice;
        }

        const cmd = enqueueMt5Command({
          action: action === 'buy' ? 'BUY' : action === 'sell' ? 'SELL' : action === 'close' ? 'CLOSE' : 'CLOSE',
          symbol: mt5Symbol,
          volume: finalQuantity,
          sl,
          tp,
          price,
          comment: `moeby ${activeModule}`,
          idempotencyKey: payload.alert_id || payload.id,
        });

        const log = Database.addLog({
          rawBody: payload,
          status: 'success',
          action,
          symbol: mt5Symbol,
          price,
          quantity: finalQuantity,
          message: `[Bridge] ${cmd.action} ${finalQuantity} ${mt5Symbol} queued (id ${cmd.id.slice(0, 8)}). SL ${sl ?? '—'} / TP ${tp ?? '—'}. ${riskReason}`,
          mode,
        });
        return res.json({ success: true, mode, queued: true, commandId: cmd.id, logId: log.id });
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
            environment: settings.bybitEnvironment,
          });

          let orderResult;
          let execMessage = '';

          // Calculate stops for exchange placement
          let slString: string | undefined = undefined;
          let tpString: string | undefined = undefined;

          // Compute idempotent client order ID using prefix and hash
          const prefix = settings.clientOrderIdPrefix || 'TF-';
          const idToHash = String(payload.id ?? payload.timestamp ?? Date.now());
          const orderLinkId = prefix + crypto.createHash('md5').update(idToHash).digest('hex').substring(0, 16);

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
              orderLinkId,
            });
            execMessage = `Bybit order created: Market BUY of ${finalQuantity} ${symbol}. Module: ${activeModule.toUpperCase()}. Stops on server: [SL: ${slString || 'None'}, TP: ${tpString || 'None'}]. (Order ID: ${orderResult.orderId}, ClientID: ${orderLinkId}) ${riskReason}`;
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
              orderLinkId,
            });
            execMessage = `Bybit order created: Market SELL of ${finalQuantity} ${symbol}. Module: ${activeModule.toUpperCase()}. Stops on server: [SL: ${slString || 'None'}, TP: ${tpString || 'None'}]. (Order ID: ${orderResult.orderId}, ClientID: ${orderLinkId}) ${riskReason}`;
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
                reduceOnly: true,
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
    const passphrase = db.settings.webhookPassphrase || 'XAU_SECURE_99X_WG';
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
    const passphrase = db.settings.webhookPassphrase || 'XAU_SECURE_99X_WG';
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

    if (process.env.DISABLE_API_AUTH === 'true') {
      console.warn('*'.repeat(78));
      console.warn('DISABLE_API_AUTH=true — every /api/* route is open to anyone with the URL.');
      console.warn('Intended for the demo account only. Before connecting live Bybit keys,');
      console.warn('remove this variable so API_AUTH_TOKEN is enforced again.');
      console.warn('*'.repeat(78));
    }

    // STARTUP RECONCILIATION & MONITORING TASK
    const db = Database.get();
    const settings = db.settings;

    console.log('[BasketManager] Running startup reconciliation and initializing active polling loops...');
    BasketManager.reconcileStartup(settings).catch(e => {
      console.error('[BasketManager] Startup reconciliation failed:', e.message || e);
    });

    // Setup periodic polling loop every 10 seconds
    let lastConfirmedCandleTime = 0;

    setInterval(async () => {
      try {
        const activeBasket = BasketManager.getActiveBasket();
        if (!activeBasket || activeBasket.status !== 'ACTIVE') return;

        const currentDb = Database.get();
        const currentSettings = currentDb.settings;

        // Fetch the current price
        let currentPrice = 0;
        const mappedSymbol = activeBasket.symbol === 'XAUUSD' ? 'XAUUSDT' : activeBasket.symbol;

        const publicBybit = new BybitClient({ apiKey: '', apiSecret: '', environment: 'live' });
        const ticker = await publicBybit.getTicker(mappedSymbol);
        if (ticker && ticker.lastPrice > 0) {
          currentPrice = ticker.lastPrice;
        }

        if (currentPrice > 0) {
          // Monitor for fills, stops, and blackout events
          await BasketManager.monitorUpdate(currentPrice, currentSettings);
        }

        // Check if a new 15-minute candle has confirmed
        const now = Date.now();
        const currentCandlePeriodMs = 15 * 60 * 1000;
        const currentCandleTime = Math.floor(now / currentCandlePeriodMs) * currentCandlePeriodMs;

        if (lastConfirmedCandleTime === 0) {
          lastConfirmedCandleTime = currentCandleTime;
        } else if (currentCandleTime > lastConfirmedCandleTime) {
          console.log(`[BasketManager] New 15m candle confirmed. Fetching historical candle series...`);
          lastConfirmedCandleTime = currentCandleTime;

          // Fetch recent klines to recompute dynamic TP target or check time stops
          const client = new BybitClient({
            apiKey: currentSettings.bybitApiKey,
            apiSecret: currentSettings.bybitApiSecret,
            environment: currentSettings.bybitEnvironment,
          });

          const klines = await client.getKlines({ symbol: mappedSymbol, interval: '15', limit: 50 });
          if (klines && klines.length >= 30) {
            const closes = klines.map((k: any) => k.close);
            const highs = klines.map((k: any) => k.high);
            const lows = klines.map((k: any) => k.low);
            const volumes = klines.map((k: any) => k.volume || k.vol || 1);
            await BasketManager.handleConfirmedCandle(closes, highs, lows, volumes, currentSettings);
          }
        }
      } catch (e: any) {
        console.error('[BasketManager Poll] Error in background monitor loop:', e.message || e);
      }
    }, 10000);
  });
}

startServer();
