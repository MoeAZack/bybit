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
  // MT5 Prop-Firm settings
  activeBroker: 'bybit' | 'mt5';
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

export interface DbSchema {
  settings: TradingSettings;
  logs: WebhookLog[];
  paperAccount: {
    balance: number;
    positions: PaperPosition[];
  };
  trades: ClosedTrade[];
  mt5Accounts: MT5Account[];
}

const DB_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

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
    webhookPassphrase: 'GOLD_ALGO_88',
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
    activeBroker: 'bybit',
    mt5Host: 'http://localhost:5000',
    mt5Login: '',
    mt5Password: '',
    mt5Server: 'FTMO-Demo',
    mt5GatewayType: 'local',
    mt5GatewayUrl: 'https://api.mtapi.be',
    mt5GatewayToken: '',
  },
  logs: [
    {
      id: 'log-1',
      timestamp: new Date(Date.now() - 4 * 3600000).toISOString(),
      rawBody: {
        passphrase: 'GOLD_ALGO_88',
        action: 'buy',
        symbol: 'XAUUSDT',
        price: 2362.45,
        volume: 0.1,
        comment: 'TradingView Golden Cross alert on 15m timeframe',
      },
      status: 'success',
      action: 'buy',
      symbol: 'XAUUSDT',
      price: 2362.45,
      quantity: 0.1,
      message: 'Paper Trade executed successfully: Opened LONG 0.1 XAUUSDT at 2362.45',
      mode: 'paper',
    },
    {
      id: 'log-2',
      timestamp: new Date(Date.now() - 3.5 * 3600000).toISOString(),
      rawBody: {
        passphrase: 'GOLD_ALGO_88',
        action: 'sell',
        symbol: 'XAUUSDT',
        price: 2368.10,
        volume: 0.2,
        comment: 'TradingView RSI Overbought alert on 5m timeframe',
      },
      status: 'success',
      action: 'sell',
      symbol: 'XAUUSDT',
      price: 2368.10,
      quantity: 0.2,
      message: 'Paper Trade executed successfully: Opened SHORT 0.2 XAUUSDT at 2368.10',
      mode: 'paper',
    },
    {
      id: 'log-3',
      timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
      rawBody: {
        passphrase: 'WRONG_SECRET',
        action: 'buy',
        symbol: 'XAUUSDT',
        price: 2365.20,
        volume: 0.1,
      },
      status: 'auth_failed',
      action: 'buy',
      symbol: 'XAUUSDT',
      price: 2365.20,
      quantity: 0.1,
      message: 'Authentication failed: Webhook passphrase does not match configured passphrase.',
      mode: 'paper',
    },
    {
      id: 'log-4',
      timestamp: new Date(Date.now() - 1 * 3600000).toISOString(),
      rawBody: {
        passphrase: 'GOLD_ALGO_88',
        action: 'close',
        symbol: 'XAUUSDT',
        price: 2371.30,
      },
      status: 'success',
      action: 'close',
      symbol: 'XAUUSDT',
      price: 2371.30,
      quantity: 0.1,
      message: 'Paper Trade executed successfully: Closed LONG position at 2371.30. Realized PnL: +$8.85',
      mode: 'paper',
    },
  ],
  paperAccount: {
    balance: 10088.50,
    positions: [
      {
        id: 'pos-1',
        symbol: 'XAUUSDT',
        side: 'sell',
        entryPrice: 2368.10,
        quantity: 0.2,
        leverage: 10,
        timestamp: new Date(Date.now() - 3.5 * 3600000).toISOString(),
      },
    ],
  },
  trades: [
    {
      id: 'trade-1',
      symbol: 'XAUUSDT',
      side: 'buy',
      entryPrice: 2362.45,
      exitPrice: 2371.30,
      quantity: 0.1,
      leverage: 10,
      entryTime: new Date(Date.now() - 4 * 3600000).toISOString(),
      exitTime: new Date(Date.now() - 1 * 3600000).toISOString(),
      pnl: 8.85,
      durationMs: 3 * 3600000,
    },
    {
      id: 'trade-2',
      symbol: 'XAUUSDT',
      side: 'sell',
      entryPrice: 2374.20,
      exitPrice: 2365.80,
      quantity: 0.15,
      leverage: 10,
      entryTime: new Date(Date.now() - 8 * 3600000).toISOString(),
      exitTime: new Date(Date.now() - 5 * 3600000).toISOString(),
      pnl: 12.60,
      durationMs: 3 * 3600000,
    },
    {
      id: 'trade-3',
      symbol: 'XAUUSDT',
      side: 'buy',
      entryPrice: 2358.00,
      exitPrice: 2364.50,
      quantity: 0.2,
      leverage: 10,
      entryTime: new Date(Date.now() - 12 * 3600000).toISOString(),
      exitTime: new Date(Date.now() - 10 * 3600000).toISOString(),
      pnl: 13.00,
      durationMs: 2 * 3600000,
    },
    {
      id: 'trade-4',
      symbol: 'XAUUSDT',
      side: 'sell',
      entryPrice: 2352.10,
      exitPrice: 2356.40,
      quantity: 0.1,
      leverage: 10,
      entryTime: new Date(Date.now() - 18 * 3600000).toISOString(),
      exitTime: new Date(Date.now() - 17 * 3600000).toISOString(),
      pnl: -4.30,
      durationMs: 1 * 3600000,
    }
  ],
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

  public static addLog(log: Omit<WebhookLog, 'id' | 'timestamp'>): WebhookLog {
    const db = this.get();
    const newLog: WebhookLog = {
      ...log,
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

  public static resetPaperAccount(customBalance?: number): void {
    const db = this.get();
    db.paperAccount = {
      balance: customBalance || 10000,
      positions: [],
    };
    db.trades = [
      {
        id: 'trade-1',
        symbol: 'XAUUSDT',
        side: 'buy',
        entryPrice: 2362.45,
        exitPrice: 2371.30,
        quantity: 0.1,
        leverage: 10,
        entryTime: new Date(Date.now() - 4 * 3600000).toISOString(),
        exitTime: new Date(Date.now() - 1 * 3600000).toISOString(),
        pnl: 8.85,
        durationMs: 3 * 3600000,
      },
      {
        id: 'trade-2',
        symbol: 'XAUUSDT',
        side: 'sell',
        entryPrice: 2374.20,
        exitPrice: 2365.80,
        quantity: 0.15,
        leverage: 10,
        entryTime: new Date(Date.now() - 8 * 3600000).toISOString(),
        exitTime: new Date(Date.now() - 5 * 3600000).toISOString(),
        pnl: 12.60,
        durationMs: 3 * 3600000,
      },
      {
        id: 'trade-3',
        symbol: 'XAUUSDT',
        side: 'buy',
        entryPrice: 2358.00,
        exitPrice: 2364.50,
        quantity: 0.2,
        leverage: 10,
        entryTime: new Date(Date.now() - 12 * 3600000).toISOString(),
        exitTime: new Date(Date.now() - 10 * 3600000).toISOString(),
        pnl: 13.00,
        durationMs: 2 * 3600000,
      }
    ];
    this.save(db);
  }
}
