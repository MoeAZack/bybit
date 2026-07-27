import fs from 'fs';
import path from 'path';

export interface WebhookLog {
  id: string;
  timestamp: string;
  rawBody: any;
  status: 'success' | 'auth_failed' | 'execution_failed' | 'ignored';
  action: 'buy' | 'sell' | 'close' | 'none';
  symbol: string;
  price: number;
  quantity: number;
  message: string;
  mode: 'paper' | 'live';
}

export interface PaperPosition {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  entryPrice: number;
  quantity: number;
  leverage: number;
  timestamp: string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  module?: 'trend' | 'range';
  routerReason?: string;
}

export interface ReversionSettings {
  enabled: boolean;              // default false — earns its slot via backtest first
  symbol: string;                // 'XAUUSDT'
  timeframe: string;             // '15' (minutes)
  // regime gate
  adxPeriod: number;             // 14
  adxRangeThreshold: number;     // 20 — module active ONLY when ADX < this
  // signal (all three must agree on the same confirmed candle)
  rsiPeriod: number;             // 14
  rsiLongBelow: number;          // 25
  rsiShortAbove: number;         // 75
  bbPeriod: number;              // 20
  bbStdDev: number;              // 2
  // long requires %B <= 0; short requires %B >= 1
  vwapStretchAtr: number;        // 1.5 — |price − sessionVWAP| must exceed this × ATR(14)
  // ladder
  maxRungs: number;              // 3 (HARD CAP — reject any config > 3)
  rungSpacingAtr: number;        // 0.75 — distance between rungs in ATR
  // risk
  basketRiskUsd: number;         // 75 — TOTAL loss if basket stop hits, all rungs filled
  stopBeyondLastRungAtr: number; // 1.0 — basket stop distance past rung 3 price
  // exits
  tpTarget: 'vwap' | 'bbMid';    // 'bbMid'
  timeStopBars: number;          // 16 (= 4 hours on 15m): flatten if TP not reached
  maxSpreadUsd: number;          // 0.60 — skip signal if spread wider (fail CLOSED)
}

export interface TradingSettings {
  bybitApiKey: string;
  bybitApiSecret: string;
  isTestnet: boolean;
  bybitEnvironment: 'demo' | 'testnet' | 'live';
  isPaperTrading: boolean;
  webhookPassphrase: string;
  defaultSymbol: string;
  defaultLeverage: number;
  defaultOrderSize: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  maxPositionSize: number;
  maxDailyLoss: number;
  maxConsecutiveLosses: number;
  isKillSwitchActive: boolean;
  ipWhitelist: string;
  clientOrderIdPrefix: string;
  isHybridStopsActive: boolean;
  isSessionFilterActive: boolean;
  allowedSessions: string[];
  isCentralRiskVetoActive: boolean;
  maxPortfolioRiskPercent: number;
  activeRegimeModule: 'trend' | 'range' | 'auto';
  isDynamicSlActive: boolean;
  atrMultiplier: number;
  isTrailingStopActive: boolean;
  breakevenMultiplier: number;
  isCompoundingActive: boolean;
  consecutiveWinMultiplier: number;
  consecutiveLossDownscale: number;
  maxSpreadUsd: number;
  isRolloverFilterActive: boolean;
  reversion: ReversionSettings;
  // MT5 Prop-Firm settings
  activeBroker: 'bybit' | 'mt5';
  // Which MT5 credential profile the venue switch targets. Distinguishes the two mt5
  // positions ("MT5 Demo" vs "Funded") without changing the routing itself.
  mt5AccountType: 'demo' | 'funded';
  // Server-side signal automation for MT5, replacing the manual TradingView webhook.
  //   off     — no server signals (TradingView webhook only)
  //   approve — signals surface on the dashboard for one-click firing
  //   auto    — signals fire straight to the bridge, hands-off
  mt5AutoMode: 'off' | 'approve' | 'auto';
  // Candle interval (minutes) the signal engine evaluates on. Bybit-supported values only.
  signalCandleMinutes: number;
  // Intraday equity circuit breaker: auto-flatten + kill switch when equity draws down
  // past maxDrawdownPercent from the day's starting equity. Protects a funded eval from
  // open-position losses, which the entry-only daily-loss veto does not cover.
  isCircuitBreakerActive: boolean;
  maxDrawdownPercent: number;
  mt5Host: string;
  mt5Login: string;
  mt5Password: string;
  mt5Server: string;
  mt5GatewayType: 'local' | 'cloud';
  mt5GatewayUrl: string;
  mt5GatewayToken: string;
}

export interface MT5Account {
  id: string;
  name: string;
  login: string;
  password?: string;
  server: string;
  isActive: boolean;
  type: 'demo' | 'funded';
  gatewayType: 'local' | 'cloud';
  gatewayUrl: string;
  gatewayToken?: string;
  balance?: number;
  equity?: number;
  currency?: string;
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  leverage: number;
  entryTime: string;
  exitTime: string;
  pnl: number;
  durationMs: number;
  module?: 'trend' | 'range';
  routerReason?: string;
}

export interface PendingSignal {
  id: string;
  createdAt: number;
  side: 'buy' | 'sell';
  symbol: string;
  price: number;
  quantity: number;
  reason: string;          // why the engine produced this signal
  atr?: number;            // real ATR at signal time, for dynamic stops on approval
  status: 'pending' | 'fired' | 'dismissed' | 'expired';
}

export interface DbSchema {
  settings: TradingSettings;
  logs: WebhookLog[];
  paperAccount: {
    balance: number;
    positions: PaperPosition[];
  };
  trades: ClosedTrade[];
  mt5Accounts: MT5Account[];
  pendingSignals?: PendingSignal[];
}

// Storage location. Override with DATA_DIR to point at a mounted persistent volume
// (e.g. a GCS FUSE mount or attached disk) instead of the container's ephemeral layer.
const DB_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

// Loud warning when running on Cloud Run (or any container) without persistent storage:
// the container filesystem is wiped on every redeploy, scale-to-zero, and instance
// recycle, silently taking settings, API keys, paper state and trade history with it.
if (!process.env.DATA_DIR && (process.env.K_SERVICE || process.env.CLOUD_RUN_JOB)) {
  console.warn(
    '[DB] WARNING: running on Cloud Run with EPHEMERAL storage. ' +
    `State at ${DB_FILE} will be LOST on redeploy, scale-to-zero, or instance recycle. ` +
    'Set DATA_DIR to a mounted persistent volume, and run with --min-instances=1.'
  );
}

export function getContractMultiplier(symbol: string): number {
  if (!symbol) return 1;
  const s = symbol.toUpperCase().trim();
  if (s === 'XAUUSDT' || s === 'XAUUSD' || s === 'GOLD') {
    return 1; // Bybit linear gold: 1 contract = 1 oz
  }
  return 1; // default multiplier
}

const defaultDb: DbSchema = {
  settings: {
    bybitApiKey: '',
    bybitApiSecret: '',
    isTestnet: true,
    bybitEnvironment: 'demo',
    isPaperTrading: true,
    webhookPassphrase: 'XAU_SECURE_99X_WG',
    defaultSymbol: 'XAUUSDT',
    defaultLeverage: 10,
    defaultOrderSize: 0.1,
    stopLossPercent: 1.5,
    takeProfitPercent: 3.0,
    maxPositionSize: 1.0,
    maxDailyLoss: 500.0,
    maxConsecutiveLosses: 5,
    isKillSwitchActive: false,
    ipWhitelist: '0.0.0.0 (Allow All)',
    clientOrderIdPrefix: 'TF_GOLD_',
    isHybridStopsActive: true,
    isSessionFilterActive: false,
    allowedSessions: ['london', 'new_york'],
    isCentralRiskVetoActive: true,
    maxPortfolioRiskPercent: 3.0,
    activeRegimeModule: 'auto',
    isDynamicSlActive: true,
    atrMultiplier: 1.5,
    isTrailingStopActive: true,
    breakevenMultiplier: 1.0,
    isCompoundingActive: true,
    consecutiveWinMultiplier: 1.15,
    consecutiveLossDownscale: 0.50,
    maxSpreadUsd: 0.80,
    isRolloverFilterActive: true,
    reversion: {
      enabled: false,
      symbol: 'XAUUSDT',
      timeframe: '15',
      adxPeriod: 14,
      adxRangeThreshold: 20,
      rsiPeriod: 14,
      rsiLongBelow: 25,
      rsiShortAbove: 75,
      bbPeriod: 20,
      bbStdDev: 2,
      vwapStretchAtr: 1.5,
      maxRungs: 3,
      rungSpacingAtr: 0.75,
      basketRiskUsd: 75,
      stopBeyondLastRungAtr: 1.0,
      tpTarget: 'bbMid',
      timeStopBars: 16,
      maxSpreadUsd: 0.60,
    },
    activeBroker: 'bybit',
    mt5AccountType: 'demo',
    mt5AutoMode: 'off',
    signalCandleMinutes: 5,
    isCircuitBreakerActive: false,
    maxDrawdownPercent: 5,
    mt5Host: 'http://localhost:5000',
    mt5Login: '',
    mt5Password: '',
    mt5Server: 'FTMO-Demo',
    mt5GatewayType: 'local',
    mt5GatewayUrl: 'https://api.mtapi.be',
    mt5GatewayToken: '',
  },
  // Seed state is intentionally EMPTY. This block previously shipped four fabricated
  // closed trades (+8.85 / +12.60 / +13.00 / -4.30 -> a fake "75% win rate"), a phantom
  // SHORT 0.2 XAUUSDT @ 2368.10, and a $10,088.50 balance. Those rendered on the live
  // dashboard as if they were a real track record. Performance stats must start empty
  // so win rate, expectancy and PnL only ever reflect trades this bot actually took.
  logs: [],
  paperAccount: {
    balance: 10000,
    positions: [],
  },
  trades: [],
  mt5Accounts: [],
};

export class Database {
  private static cachedData: DbSchema | null = null;

  private static ensureDbExists() {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2), 'utf-8');
    }
  }

  public static get(): DbSchema {
    this.ensureDbExists();
    try {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      // Migrate / merge default settings properties if missing
      parsed.settings = { ...defaultDb.settings, ...parsed.settings };
      if (!parsed.settings.reversion) {
        parsed.settings.reversion = { ...defaultDb.settings.reversion };
      } else {
        parsed.settings.reversion = { ...defaultDb.settings.reversion, ...parsed.settings.reversion };
      }
      if (!parsed.trades) {
        parsed.trades = [];
      }
      if (!parsed.mt5Accounts) {
        parsed.mt5Accounts = [];
      }
      this.cachedData = parsed;
      return this.cachedData!;
    } catch (e) {
      console.error('Error reading database file, returning default', e);
      return defaultDb;
    }
  }

  public static getMT5Accounts(): MT5Account[] {
    const db = this.get();
    return db.mt5Accounts || [];
  }

  public static addMT5Account(acc: Omit<MT5Account, 'id'> & { id?: string }): MT5Account {
    const db = this.get();
    if (!db.mt5Accounts) db.mt5Accounts = [];
    const newAcc: MT5Account = {
      ...acc,
      id: acc.id || 'mt5-acc-' + Math.random().toString(36).substr(2, 9),
    };
    
    // If set as active, deactivate others
    if (newAcc.isActive) {
      db.mt5Accounts.forEach(a => a.isActive = false);
    }
    
    // If first account, set as active
    if (db.mt5Accounts.length === 0) {
      newAcc.isActive = true;
    }

    db.mt5Accounts.push(newAcc);
    this.save(db);
    return newAcc;
  }

  public static updateMT5Account(id: string, updates: Partial<MT5Account>): MT5Account | null {
    const db = this.get();
    if (!db.mt5Accounts) db.mt5Accounts = [];
    const idx = db.mt5Accounts.findIndex(a => a.id === id);
    if (idx === -1) return null;

    if (updates.isActive) {
      db.mt5Accounts.forEach(a => a.isActive = false);
    }

    db.mt5Accounts[idx] = { ...db.mt5Accounts[idx], ...updates };
    this.save(db);
    return db.mt5Accounts[idx];
  }

  public static selectMT5Account(id: string): boolean {
    const db = this.get();
    if (!db.mt5Accounts) return false;
    const acc = db.mt5Accounts.find(a => a.id === id);
    if (!acc) return false;

    db.mt5Accounts.forEach(a => a.isActive = (a.id === id));
    
    // Sync to main settings
    db.settings.mt5Login = acc.login;
    db.settings.mt5Server = acc.server;
    if (acc.password) {
      db.settings.mt5Password = acc.password;
    }
    db.settings.mt5GatewayType = acc.gatewayType;
    db.settings.mt5GatewayUrl = acc.gatewayUrl;
    if (acc.gatewayType === 'local') {
      db.settings.mt5Host = acc.gatewayUrl;
    }
    if (acc.gatewayToken) {
      db.settings.mt5GatewayToken = acc.gatewayToken;
    }
    
    this.save(db);
    return true;
  }

  public static deleteMT5Account(id: string): boolean {
    const db = this.get();
    if (!db.mt5Accounts) return false;
    const idx = db.mt5Accounts.findIndex(a => a.id === id);
    if (idx === -1) return false;

    const wasActive = db.mt5Accounts[idx].isActive;
    db.mt5Accounts.splice(idx, 1);

    if (wasActive && db.mt5Accounts.length > 0) {
      db.mt5Accounts[0].isActive = true;
      const acc = db.mt5Accounts[0];
      db.settings.mt5Login = acc.login;
      db.settings.mt5Server = acc.server;
      if (acc.password) {
        db.settings.mt5Password = acc.password;
      }
      db.settings.mt5GatewayType = acc.gatewayType;
      db.settings.mt5GatewayUrl = acc.gatewayUrl;
      if (acc.gatewayType === 'local') {
        db.settings.mt5Host = acc.gatewayUrl;
      }
      if (acc.gatewayToken) {
        db.settings.mt5GatewayToken = acc.gatewayToken;
      }
    }
    this.save(db);
    return true;
  }

  public static save(data: DbSchema): void {
    this.ensureDbExists();
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
      this.cachedData = data;
    } catch (e) {
      console.error('Error writing database file', e);
    }
  }

  public static updateSettings(settings: Partial<TradingSettings>): TradingSettings {
    const db = this.get();
    db.settings = { ...db.settings, ...settings };
    this.save(db);
    return db.settings;
  }

  // Secrets must never reach the logs blob: it is served to the dashboard and stored in
  // db.json. Redact centrally so no call site can leak by passing a raw request body.
  private static redactSecrets(body: any): any {
    if (!body || typeof body !== 'object') return body;
    const SECRET_KEYS = ['passphrase', 'password', 'secret', 'token', 'apiKey', 'apiSecret'];
    const clone: Record<string, any> = Array.isArray(body) ? [...body] : { ...body };
    for (const k of Object.keys(clone)) {
      if (SECRET_KEYS.some(s => k.toLowerCase().includes(s.toLowerCase()))) {
        clone[k] = '••••••';
      } else if (clone[k] && typeof clone[k] === 'object') {
        clone[k] = this.redactSecrets(clone[k]);
      }
    }
    return clone;
  }

  public static addLog(log: Omit<WebhookLog, 'id' | 'timestamp'>): WebhookLog {
    const db = this.get();
    const newLog: WebhookLog = {
      ...log,
      rawBody: this.redactSecrets((log as any).rawBody),
      id: 'log-' + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
    };
    db.logs.unshift(newLog);
    // Keep logs list capped at 100 items to prevent file bloating
    if (db.logs.length > 100) {
      db.logs = db.logs.slice(0, 100);
    }
    this.save(db);
    return newLog;
  }

  public static clearLogs(): void {
    const db = this.get();
    db.logs = [];
    this.save(db);
  }

  // --- Pending signals (server-side automation) ---------------------------
  public static getPendingSignals(): PendingSignal[] {
    const db = this.get();
    return (db.pendingSignals || []).filter(s => s.status === 'pending');
  }

  public static addPendingSignal(sig: Omit<PendingSignal, 'id' | 'createdAt' | 'status'>): PendingSignal {
    const db = this.get();
    if (!db.pendingSignals) db.pendingSignals = [];
    const newSig: PendingSignal = {
      ...sig,
      id: 'sig-' + Math.random().toString(36).slice(2, 11),
      createdAt: Date.now(),
      status: 'pending',
    };
    db.pendingSignals.unshift(newSig);
    // Keep the list bounded.
    db.pendingSignals = db.pendingSignals.slice(0, 50);
    this.save(db);
    return newSig;
  }

  public static setPendingSignalStatus(id: string, status: PendingSignal['status']): PendingSignal | null {
    const db = this.get();
    const sig = (db.pendingSignals || []).find(s => s.id === id);
    if (!sig) return null;
    sig.status = status;
    this.save(db);
    return sig;
  }

  // Expire pending signals older than the given age so stale entries are never fired.
  public static expirePendingSignals(maxAgeMs: number): void {
    const db = this.get();
    if (!db.pendingSignals || db.pendingSignals.length === 0) return;
    const now = Date.now();
    let changed = false;
    for (const s of db.pendingSignals) {
      if (s.status === 'pending' && now - s.createdAt > maxAgeMs) {
        s.status = 'expired';
        changed = true;
      }
    }
    if (changed) this.save(db);
  }

  public static getPaperAccount() {
    const db = this.get();
    return db.paperAccount;
  }

  public static updatePaperBalance(amount: number): number {
    const db = this.get();
    db.paperAccount.balance += amount;
    this.save(db);
    return db.paperAccount.balance;
  }

  public static addPaperPosition(position: Omit<PaperPosition, 'id' | 'timestamp'>): PaperPosition {
    const db = this.get();
    const newPosition: PaperPosition = {
      ...position,
      id: 'pos-' + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
    };
    db.paperAccount.positions.push(newPosition);
    this.save(db);
    return newPosition;
  }

  public static closePaperPosition(symbol: string, currentPrice: number): { closed: boolean; pnl: number; msg: string } {
    const db = this.get();
    const posIndex = db.paperAccount.positions.findIndex(p => p.symbol.toLowerCase() === symbol.toLowerCase());
    if (posIndex === -1) {
      return { closed: false, pnl: 0, msg: `No open position found for ${symbol}` };
    }

    const pos = db.paperAccount.positions[posIndex];
    // Calculate PnL: Long: (current - entry) * qty * leverage, Short: (entry - current) * qty * leverage
    // Let's calculate standard contract perpetual PnL:
    // PnL = SideFactor * (CurrentPrice - EntryPrice) * Quantity * ContractMultiplier
    const sideFactor = pos.side === 'buy' ? 1 : -1;
    const pnl = sideFactor * (currentPrice - pos.entryPrice) * pos.quantity * getContractMultiplier(pos.symbol);

    // Remove position
    db.paperAccount.positions.splice(posIndex, 1);
    // Add PnL to balance
    db.paperAccount.balance += pnl;

    // Create a ClosedTrade record
    if (!db.trades) {
      db.trades = [];
    }
    const exitTime = new Date().toISOString();
    const durationMs = Date.now() - new Date(pos.timestamp).getTime();
    db.trades.unshift({
      id: 'trade-' + Math.random().toString(36).substr(2, 9),
      symbol: pos.symbol,
      side: pos.side,
      entryPrice: pos.entryPrice,
      exitPrice: currentPrice,
      quantity: pos.quantity,
      leverage: pos.leverage,
      entryTime: pos.timestamp,
      exitTime,
      pnl,
      durationMs,
      module: pos.module,
      routerReason: pos.routerReason,
    });

    this.save(db);

    return {
      closed: true,
      pnl,
      msg: `Closed ${pos.side.toUpperCase()} position of ${pos.quantity} ${symbol} at ${currentPrice}. Realized PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
    };
  }

  /**
   * Reset the paper account to a clean slate.
   *
   * This previously RE-SEEDED three fabricated winning trades (entries at 2362.45 /
   * 2374.20 / 2358.00, all profitable), so pressing "reset demo balance" installed a
   * 100%-win-rate track record the bot had never earned, and every win-rate, expectancy
   * and PnL figure downstream was computed from them. A reset must clear history, not
   * invent it.
   */
  public static resetPaperAccount(customBalance?: number): void {
    const db = this.get();
    db.paperAccount = {
      balance: customBalance || 10000,
      positions: [],
    };
    db.trades = [];
    this.save(db);
  }
}
