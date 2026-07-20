import React, { useState, useEffect, useRef, FormEvent } from 'react';
import { 
  Shield, 
  Terminal, 
  Settings, 
  RefreshCw, 
  Copy, 
  Check, 
  Cpu, 
  Play, 
  AlertTriangle, 
  Trash2, 
  TrendingUp, 
  DollarSign, 
  Activity, 
  Sparkles,
  ArrowRightLeft,
  X,
  Zap,
  Sliders,
  HelpCircle,
  History,
  Info,
  Plus,
  Edit,
  Brain,
  LineChart,
  Layers,
  Timer
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

interface WebhookLog {
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

interface ClosedTrade {
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
}

interface PaperPosition {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  entryPrice: number;
  quantity: number;
  leverage: number;
  timestamp: string;
  module?: string;
  routerReason?: string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

interface AccountDetails {
  balance: number;
  currency: string;
  positions: Array<{
    id: string;
    symbol: string;
    side: 'buy' | 'sell';
    entryPrice: number;
    quantity: number;
    leverage: number;
    unrealizedPnl?: number;
    timestamp: string;
    module?: string;
    routerReason?: string;
    stopLossPrice?: number;
    takeProfitPrice?: number;
  }>;
}

interface RegimeModuleStats {
  name: string;
  tradesCount: number;
  winRate: number;
  totalPnl: number;
  expectancyR: number;
  status: 'Active' | 'Idle';
}

interface SettingsState {
  bybitApiKey: string;
  bybitApiSecret: string;
  isTestnet: boolean;
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
  // 5 Profitability Modules
  isDynamicSlActive: boolean;
  atrMultiplier: number;
  isTrailingStopActive: boolean;
  breakevenMultiplier: number;
  isCompoundingActive: boolean;
  consecutiveWinMultiplier: number;
  consecutiveLossDownscale: number;
  isRolloverFilterActive: boolean;
  maxSpreadUsd: number;
  reversion: {
    enabled: boolean;
    symbol: string;
    timeframe: string;
    adxPeriod: number;
    adxRangeThreshold: number;
    rsiPeriod: number;
    rsiLongBelow: number;
    rsiShortAbove: number;
    bbPeriod: number;
    bbStdDev: number;
    vwapStretchAtr: number;
    maxRungs: number;
    rungSpacingAtr: number;
    basketRiskUsd: number;
    stopBeyondLastRungAtr: number;
    tpTarget: 'vwap' | 'bbMid';
    timeStopBars: number;
    maxSpreadUsd: number;
  };
  // MT5 Prop-Firm settings
  activeBroker: 'bybit' | 'mt5';
  mt5AccountType: 'demo' | 'funded';
  mt5AutoMode: 'off' | 'approve' | 'auto';
  signalCandleMinutes: number;
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

interface MT5Account {
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

export default function App() {
  // Application State
  const [settings, setSettings] = useState<SettingsState>({
    bybitApiKey: '',
    bybitApiSecret: '',
    isTestnet: true,
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
    // 5 Profitability Modules
    isDynamicSlActive: true,
    atrMultiplier: 1.5,
    isTrailingStopActive: true,
    breakevenMultiplier: 1.2,
    isCompoundingActive: true,
    consecutiveWinMultiplier: 1.25,
    consecutiveLossDownscale: 0.85,
    isRolloverFilterActive: true,
    maxSpreadUsd: 0.75,
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
    // MT5 Prop-Firm defaults
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
  });

  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [account, setAccount] = useState<{
    paperAccount: AccountDetails;
    liveAccount: AccountDetails | null;
    activeMode: 'paper' | 'live';
    liveAccountError?: string;
  }>({
    paperAccount: { balance: 10000, currency: 'USDT', positions: [] },
    liveAccount: null,
    activeMode: 'paper',
  });

  // Ticker and Chart state. Price history starts empty and fills only from the live feed,
  // so the high/low and chart never mix seeded numbers with real quotes.
  const [goldPrice, setGoldPrice] = useState<number>(0);
  const [priceHistory, setPriceHistory] = useState<number[]>([]);
  const [priceChange, setPriceChange] = useState<'up' | 'down' | null>(null);
  const [flashKey, setFlashKey] = useState<number>(0);
  // Live gold price source: MT5 terminal via the bridge heartbeat. null = no live feed yet.
  const [priceSource, setPriceSource] = useState<string | null>(null);
  // Server-generated signals awaiting one-click approval (approve mode).
  const [pendingSignals, setPendingSignals] = useState<Array<{
    id: string; side: 'buy' | 'sell'; symbol: string; price: number; quantity: number; reason: string; createdAt: number;
  }>>([]);
  // P&L calendar: which month is shown (first of month).
  const [calMonth, setCalMonth] = useState<Date>(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  // AI trade review.
  const [review, setReview] = useState<{ stats: any; report: string } | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const handleGenerateReview = async () => {
    setReviewLoading(true);
    try {
      const res = await fetch('/api/trades/review', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { showCustomAlert('Review failed', data.error || 'Unknown error'); return; }
      setReview(data);
    } catch (e: any) {
      showCustomAlert('Error', `Review failed: ${e.message}`);
    } finally {
      setReviewLoading(false);
    }
  };

  // UI state
  const [activeTab, setActiveTab] = useState<'monitor' | 'setup' | 'settings' | 'trades' | 'sandbox' | 'quant'>('monitor');
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([]);
  const [routerStats, setRouterStats] = useState<{ trend: RegimeModuleStats; range: RegimeModuleStats } | null>(null);

  // Quant Terminal state variables
  const [quantMetrics, setQuantMetrics] = useState<any | null>(null);
  const [quantPerformance, setQuantPerformance] = useState<any | null>(null);
  const [quantLoading, setQuantLoading] = useState<boolean>(false);
  const [quantError, setQuantError] = useState<string | null>(null);

  // Meta-Labeler playground form/prediction states
  const [metaLabelForm, setMetaLabelForm] = useState({
    module: 'trend',
    side: 'buy',
    adx: 24,
    fundingPercentile: 52,
    bandwidthPercentile: 65,
    dxy: 104.2,
    yield10y: 4.15,
    session: 'london'
  });
  const [metaLabelPrediction, setMetaLabelPrediction] = useState<any | null>(null);
  const [metaLabelLoading, setMetaLabelLoading] = useState<boolean>(false);

  // Research Desk state variables
  const [researchDeskData, setResearchDeskData] = useState<{
    hypotheses: any[];
    stressTests: any[];
    adaptiveExecution: any[];
    capitalLadder: any;
  } | null>(null);
  const [deskActionLoading, setDeskActionLoading] = useState<boolean>(false);

  // MT5 Multi-Account management state
  const [mt5Accounts, setMt5Accounts] = useState<MT5Account[]>([]);
  const [showAddMT5Modal, setShowAddMT5Modal] = useState<boolean>(false);
  const [editingMT5Acc, setEditingMT5Acc] = useState<MT5Account | null>(null);
  const [mt5Form, setMt5Form] = useState({
    name: '',
    login: '',
    password: '',
    server: 'FTMO-Demo',
    type: 'demo' as 'demo' | 'funded',
    gatewayType: 'local' as 'local' | 'cloud',
    gatewayUrl: 'https://api.mtapi.be',
    gatewayToken: '',
    isActive: false,
  });
  const [mt5Error, setMt5Error] = useState<string | null>(null);

  // Real 30-day equity curve from actual closed trades. No synthetic drift: days with no
  // trades are flat. Balance 30 days ago is derived as current minus the period's total PnL,
  // then real daily PnL is added forward so the last point equals the current balance.
  const generateHistoricalPnLData = (currentBalance: number, trades: ClosedTrade[]) => {
    const data: { date: string; balance: number; pnl: number }[] = [];
    const now = new Date();
    const windowStart = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);

    const windowTrades = trades.filter(t => new Date(t.exitTime) >= windowStart);
    const totalPnL = windowTrades.reduce((sum, t) => sum + t.pnl, 0);
    const startingBalance = currentBalance - totalPnL;

    let running = startingBalance;
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const dayPnL = trades
        .filter(t => new Date(t.exitTime).toDateString() === d.toDateString())
        .reduce((sum, t) => sum + t.pnl, 0);

      running += dayPnL;
      data.push({
        date: dateStr,
        balance: Math.round(running * 100) / 100,
        pnl: Math.round((running - startingBalance) * 100) / 100,
      });
    }

    return data;
  };

  // Daily realized P&L for a given month, keyed by day-of-month, from real closed trades.
  const buildPnLCalendar = (month: Date, trades: ClosedTrade[]) => {
    const year = month.getFullYear();
    const mon = month.getMonth();
    const daysInMonth = new Date(year, mon + 1, 0).getDate();
    const firstWeekday = new Date(year, mon, 1).getDay(); // 0=Sun
    const byDay: Record<number, { pnl: number; count: number }> = {};
    for (const t of trades) {
      const d = new Date(t.exitTime);
      if (d.getFullYear() === year && d.getMonth() === mon) {
        const day = d.getDate();
        if (!byDay[day]) byDay[day] = { pnl: 0, count: 0 };
        byDay[day].pnl += t.pnl;
        byDay[day].count += 1;
      }
    }
    const monthPnl = Object.values(byDay).reduce((s, v) => s + v.pnl, 0);
    return { year, mon, daysInMonth, firstWeekday, byDay, monthPnl };
  };

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [showMt5Guide, setShowMt5Guide] = useState(false);

  // Backtest Sandbox state
  const [backtestParams, setBacktestParams] = useState({
    fastEma: 12,
    slowEma: 26,
    rsiPeriod: 14,
    rsiOverbought: 70,
    rsiOversold: 30,
    atrPeriod: 14,
    atrMultiplierSL: 1.5,
    atrMultiplierTP: 3.0,
    feePercent: 0.055,
    slippageTicks: 1,
    walkForward: 'none' as 'none' | 'fit_jan_mar' | 'val_apr_jun',
    isRegimeFilterActive: true,
    adxThreshold: 22,
    isVolatilitySizingActive: true,
    riskPercent: 1.0,
    isEquityThrottleActive: true,
    isEventBlackoutActive: true,
    orderType: 'MARKET' as 'MARKET' | 'LIMIT_POST_ONLY',
    isPartialTPActive: true,
    isTimeStopActive: true,
    timeStopBars: 20,
  });
  const [backtestResult, setBacktestResult] = useState<any | null>(null);
  const [backtestLoading, setBacktestLoading] = useState<boolean>(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);

  // Parameter optimizer state. Each sweepable param has a preset range; the user toggles
  // which ones to include. Fewer selected = fewer combinations = faster.
  const OPTIMIZER_RANGES: Record<string, { label: string; values: number[] }> = {
    fastEma: { label: 'Fast EMA', values: [8, 12, 20] },
    slowEma: { label: 'Slow EMA', values: [26, 50, 100] },
    atrMultiplierSL: { label: 'SL × ATR', values: [1.0, 1.5, 2.0] },
    atrMultiplierTP: { label: 'TP × ATR', values: [2.0, 3.0, 4.0] },
    adxThreshold: { label: 'ADX threshold', values: [18, 22, 26, 30] },
    rsiOversold: { label: 'RSI oversold', values: [25, 30, 35] },
  };
  const [optSweeps, setOptSweeps] = useState<string[]>(['atrMultiplierSL', 'atrMultiplierTP']);
  const [optRankBy, setOptRankBy] = useState<'expectancyR' | 'expectancy' | 'profitFactor' | 'winRate' | 'netPnl'>('expectancyR');
  const [optResults, setOptResults] = useState<any[] | null>(null);
  const [optLoading, setOptLoading] = useState(false);
  const [optMeta, setOptMeta] = useState<{ ran: number; capped: boolean } | null>(null);

  const optComboCount = optSweeps.reduce((n, k) => n * (OPTIMIZER_RANGES[k]?.values.length || 1), 1);

  const handleOptimize = async () => {
    if (optSweeps.length === 0) { showCustomAlert('Pick a parameter', 'Select at least one parameter to sweep.'); return; }
    setOptLoading(true);
    setOptResults(null);
    try {
      const sweeps: Record<string, number[]> = {};
      for (const k of optSweeps) sweeps[k] = OPTIMIZER_RANGES[k].values;
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...backtestParams, sweeps, rankBy: optRankBy, maxCombos: 60 }),
      });
      const data = await res.json();
      if (!res.ok) { showCustomAlert('Optimize failed', data.error || 'Unknown error'); return; }
      setOptResults(data.ranked || []);
      setOptMeta({ ran: data.ran, capped: data.capped });
    } catch (e: any) {
      showCustomAlert('Error', `Optimizer failed: ${e.message}`);
    } finally {
      setOptLoading(false);
    }
  };

  const applyOptimizedParams = (swept: Record<string, number>) => {
    setBacktestParams(prev => ({ ...prev, ...swept }));
    setBacktestResult(null);
    showCustomAlert('Applied', 'Winning parameters loaded into the backtest form. Run a backtest to confirm, then copy them into your live settings.');
  };
  
  // Custom manual simulation tool state
  const [simAction, setSimAction] = useState<'buy' | 'sell' | 'close'>('buy');
  const [simSymbol, setSimSymbol] = useState<string>('XAUUSDT');
  const [simPrice, setSimPrice] = useState<string>('');
  const [simVolume, setSimVolume] = useState<string>('');
  const [isSimulating, setIsSimulating] = useState(false);
  const [simSuccessMsg, setSimSuccessMsg] = useState<string | null>(null);

  // Pine Script Strategy state
  const [aiPrompt, setAiPrompt] = useState<string>('EMA 50 & 200 crossover strategy with ATR-based dynamic stops');
  const [pineScript, setPineScript] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [genMessage, setGenMessage] = useState<string>('');

  // Performance & system metrics (simulated real-time)
  // Real telemetry measured from the bridge poll. null = not yet known / offline.
  const [bridgeMetrics, setBridgeMetrics] = useState<{
    latencyMs: number | null;
    bridgeAgeSec: number | null;
    queueDepth: number | null;
    connected: boolean;
  }>({ latencyMs: null, bridgeAgeSec: null, queueDepth: null, connected: false });

  // Fetch initial data & start poll
  useEffect(() => {
    fetchSettings();
    fetchLogs();
    fetchPositions();
    fetchRouterStats();
    fetchMT5Accounts();
    fetchPendingSignals();

    const interval = setInterval(() => {
      fetchLogs();
      fetchPositions();
      fetchRouterStats();
      fetchMT5Accounts();
      fetchPendingSignals();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const fetchQuantData = async () => {
    try {
      setQuantLoading(true);
      const [resMetrics, resPerformance, resDesk] = await Promise.all([
        fetch('/api/quant/metrics'),
        fetch('/api/quant/performance'),
        fetch('/api/quant/research-desk')
      ]);

      if (resMetrics.ok && resPerformance.ok && resDesk.ok) {
        const metricsData = await resMetrics.json();
        const performanceData = await resPerformance.json();
        const deskData = await resDesk.json();
        
        setQuantMetrics(metricsData);
        setQuantPerformance(performanceData);
        setResearchDeskData(deskData);
      } else {
        setQuantError('Failed to fetch quant terminal analytics and research desk details from the API.');
      }
    } catch (e: any) {
      setQuantError(e.message || 'Error occurred while loading quant metrics.');
    } finally {
      setQuantLoading(false);
    }
  };

  const handleDeskAction = async (actionType: string, targetId?: string) => {
    setDeskActionLoading(true);
    try {
      const res = await fetch('/api/quant/research-desk/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionType, targetId })
      });
      const data = await res.json();
      if (res.ok) {
        showCustomAlert('Desk Action Completed', data.message || 'Action executed successfully.');
        await fetchQuantData();
        await fetchPositions();
        await fetchLogs();
      } else {
        showCustomAlert('Action Failed', data.error || 'Failed to complete requested research desk operation.');
      }
    } catch (e: any) {
      showCustomAlert('Error', e.message || 'Network error executing desk action.');
    } finally {
      setDeskActionLoading(false);
    }
  };

  const handleCheckMetaLabel = async (e: React.FormEvent) => {
    e.preventDefault();
    setMetaLabelLoading(true);
    try {
      const res = await fetch('/api/quant/meta-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metaLabelForm)
      });
      if (res.ok) {
        const data = await res.json();
        setMetaLabelPrediction(data.prediction);
      } else {
        const err = await res.json();
        setDialog({
          isOpen: true,
          type: 'alert',
          title: 'Prediction Error',
          message: err.error || 'Failed to generate meta-label prediction.'
        });
      }
    } catch (e: any) {
      setDialog({
        isOpen: true,
        type: 'alert',
        title: 'Connection Error',
        message: e.message || 'Error connecting to Gemini Meta-Labeler.'
      });
    } finally {
      setMetaLabelLoading(false);
    }
  };

  // Quant Tab fetch polling
  useEffect(() => {
    if (activeTab === 'quant') {
      fetchQuantData();
      const interval = setInterval(fetchQuantData, 4000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  const fetchMT5Accounts = async () => {
    try {
      const res = await fetchWithRetry('/api/mt5/accounts');
      if (res.ok) {
        const data = await res.json();
        setMt5Accounts(data);
      }
    } catch (e) {
      console.warn('Silent fallback: load MT5 accounts delayed', e);
    }
  };

  const handleSelectMT5Account = async (id: string) => {
    try {
      const res = await fetch('/api/mt5/accounts/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        await fetchMT5Accounts();
        await fetchSettings();
        await fetchPositions();
      }
    } catch (e) {
      console.error('Error selecting MT5 account', e);
    }
  };

  // Main-page venue switch. Writes only the routing fields; paper/live is managed
  // separately in Settings, deliberately untouched here.
  const [venueSwitching, setVenueSwitching] = useState(false);
  const handleSelectVenue = async (
    broker: 'bybit' | 'mt5',
    accountType: 'demo' | 'funded' = settings.mt5AccountType,
  ) => {
    setVenueSwitching(true);
    // Optimistic: reflect the choice immediately, reconcile on refetch.
    setSettings(prev => ({ ...prev, activeBroker: broker, mt5AccountType: accountType }));
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeBroker: broker, mt5AccountType: accountType }),
      });
      if (res.ok) {
        await fetchSettings();
        await fetchPositions();
      }
    } catch (e) {
      console.error('Error switching venue', e);
      await fetchSettings();
    } finally {
      setVenueSwitching(false);
    }
  };

  // Poll pending signals while in approve mode so the panel stays current.
  const fetchPendingSignals = async () => {
    try {
      const res = await fetch('/api/signals');
      if (res.ok) setPendingSignals(await res.json());
    } catch {
      /* transient; keep last known */
    }
  };

  const handleApproveSignal = async (id: string) => {
    try {
      const res = await fetch(`/api/signals/${id}/approve`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) showCustomAlert('Signal not fired', data.error || 'Execution was blocked.');
      await fetchPendingSignals();
      await fetchPositions();
      await fetchLogs();
    } catch (e: any) {
      showCustomAlert('Error', `Could not approve signal: ${e.message}`);
    }
  };

  const handleDismissSignal = async (id: string) => {
    try {
      await fetch(`/api/signals/${id}/dismiss`, { method: 'POST' });
      await fetchPendingSignals();
    } catch (e) {
      console.error('dismiss signal failed', e);
    }
  };

  const handleDeleteMT5Account = async (id: string) => {
    try {
      const res = await fetch(`/api/mt5/accounts/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchMT5Accounts();
        await fetchSettings();
        await fetchPositions();
      }
    } catch (e) {
      console.error('Error deleting MT5 account', e);
    }
  };

  const handleSaveMT5Account = async (e: React.FormEvent) => {
    e.preventDefault();
    setMt5Error(null);
    try {
      const res = await fetch('/api/mt5/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingMT5Acc?.id,
          ...mt5Form,
        }),
      });
      if (res.ok) {
        setShowAddMT5Modal(false);
        setEditingMT5Acc(null);
        setMt5Form({
          name: '',
          login: '',
          password: '',
          server: 'FTMO-Demo',
          type: 'demo',
          gatewayType: 'local',
          gatewayUrl: 'https://api.mtapi.be',
          gatewayToken: '',
          isActive: false,
        });
        await fetchMT5Accounts();
        await fetchSettings();
        await fetchPositions();
      } else {
        const err = await res.json();
        setMt5Error(err.error || 'Failed to save account');
      }
    } catch (e: any) {
      setMt5Error(e.message || 'An error occurred while saving the account');
    }
  };

  // Auto-run backtest on Sandbox tab visit
  useEffect(() => {
    if (activeTab === 'sandbox' && !backtestResult && !backtestLoading) {
      handleRunBacktest();
    }
  }, [activeTab]);

  // Live gold price from the MT5 terminal via the bridge heartbeat.
  // Per project rules, the price must be real market data -- no random walk. When the
  // bridge has no fresh quote, the last known value is held and marked stale rather than
  // invented.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const t0 = performance.now();
        const res = await fetch('/api/bridge/status');
        if (!res.ok || cancelled) return;
        const s = await res.json();
        const latencyMs = Math.round(performance.now() - t0);
        setBridgeMetrics({
          latencyMs,
          bridgeAgeSec: s.lastHeartbeat ? Math.max(0, Math.round((Date.now() - s.lastHeartbeat) / 1000)) : null,
          queueDepth: typeof s.queueDepth === 'number' ? s.queueDepth : null,
          connected: !!s.connected,
        });

        const live = typeof s.price === 'number' && s.price > 0;
        setPriceSource(live ? (s.priceSymbol || 'MT5') : null);
        if (!live) return;

        const newPrice = Number(s.price.toFixed(2));
        setGoldPrice(prev => {
          if (newPrice > prev) { setPriceChange('up'); setFlashKey(k => k + 1); }
          else if (newPrice < prev) { setPriceChange('down'); setFlashKey(k => k + 1); }
          if (newPrice !== prev) {
            setPriceHistory(history => {
              const next = [...history, newPrice];
              while (next.length > 25) next.shift();
              return next;
            });
          }
          return newPrice;
        });
      } catch {
        // Network blip: keep last known price, do not fabricate.
        if (!cancelled) {
          setPriceSource(null);
          setBridgeMetrics(m => ({ ...m, connected: false, latencyMs: null }));
        }
      }
    };
    poll();
    const priceInterval = setInterval(poll, 1500);
    return () => { cancelled = true; clearInterval(priceInterval); };
  }, []);

  const fetchWithRetry = async (url: string, options?: RequestInit, retries = 5, delay = 1000): Promise<Response> => {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, options);
        if (res.ok) {
          return res;
        }
        if (res.status >= 500 && i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        return res;
      } catch (e) {
        if (i === retries - 1) {
          throw e;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} retries`);
  };

  const fetchSettings = async () => {
    try {
      const res = await fetchWithRetry('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        if (!simPrice) setSimPrice(String(goldPrice));
        if (!simVolume) setSimVolume(String(data.defaultOrderSize || 0.1));
      }
    } catch (e) {
      console.warn('Silent fallback: load settings delayed', e);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetchWithRetry('/api/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (e) {
      console.warn('Silent fallback: load logs delayed', e);
    }
  };

  const fetchPositions = async () => {
    try {
      const res = await fetchWithRetry('/api/positions');
      if (res.ok) {
        const data = await res.json();
        setAccount(data);
        if (data.trades) {
          setClosedTrades(data.trades);
        }
      }
    } catch (e) {
      console.warn('Silent fallback: load account details delayed', e);
    }
  };

  const fetchRouterStats = async () => {
    try {
      const res = await fetchWithRetry('/api/router-stats');
      if (res.ok) {
        const data = await res.json();
        setRouterStats(data);
      }
    } catch (e) {
      console.warn('Silent fallback: load router stats delayed', e);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus('saving');
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        const data = await res.json();
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
      }
    } catch (e) {
      setSaveStatus('error');
    }
  };

  // Custom modal dialog states to bypass iframe restrictions
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    type: 'alert' | 'confirm' | 'prompt';
    title: string;
    message: string;
    placeholder?: string;
    defaultValue?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: (value?: string) => void;
    onCancel?: () => void;
  }>({
    isOpen: false,
    type: 'alert',
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel'
  });

  const [dialogInputValue, setDialogInputValue] = useState('');

  const showCustomAlert = (title: string, message: string) => {
    setDialog({
      isOpen: true,
      type: 'alert',
      title,
      message,
      confirmText: 'OK',
      onConfirm: () => setDialog(prev => ({ ...prev, isOpen: false }))
    });
  };

  const showCustomConfirm = (title: string, message: string, onConfirm: () => void) => {
    setDialog({
      isOpen: true,
      type: 'confirm',
      title,
      message,
      confirmText: 'Yes, Proceed',
      cancelText: 'Cancel',
      onConfirm: () => {
        setDialog(prev => ({ ...prev, isOpen: false }));
        onConfirm();
      },
      onCancel: () => setDialog(prev => ({ ...prev, isOpen: false }))
    });
  };

  const showCustomPrompt = (title: string, message: string, defaultValue: string, onConfirm: (val: string) => void) => {
    setDialogInputValue(defaultValue);
    setDialog({
      isOpen: true,
      type: 'prompt',
      title,
      message,
      defaultValue,
      confirmText: 'Submit',
      cancelText: 'Cancel',
      onConfirm: (val) => {
        setDialog(prev => ({ ...prev, isOpen: false }));
        onConfirm(val || '');
      },
      onCancel: () => setDialog(prev => ({ ...prev, isOpen: false }))
    });
  };

  const handleClearLogs = () => {
    showCustomConfirm(
      'Clear Logs History',
      'Are you sure you want to clear the execution log history? This action is irreversible.',
      async () => {
        try {
          await fetch('/api/logs/clear', { method: 'POST' });
          fetchLogs();
        } catch (e) {
          console.error(e);
        }
      }
    );
  };

  const handleResetPaper = () => {
    const defaultVal = settings.activeBroker === 'mt5' ? '100000' : '10000';
    showCustomPrompt(
      'Reset Demo Balance',
      'Enter your target Prop-Firm Challenge or Demo balance size (USD/USDT):',
      defaultVal,
      (sizeStr) => {
        const balanceVal = parseFloat(sizeStr);
        if (isNaN(balanceVal) || balanceVal <= 0) {
          showCustomAlert('Invalid Balance', 'Please enter a valid positive number.');
          return;
        }

        showCustomConfirm(
          'Confirm Reset',
          `Reset Paper Trading balance to $${balanceVal.toLocaleString()} and close all open positions?`,
          async () => {
            try {
              await fetch('/api/paper/reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ balance: balanceVal }),
              });
              await fetchRouterStats();
              await fetchPositions();
              await fetchLogs();
            } catch (e) {
              console.error(e);
            }
          }
        );
      }
    );
  };

  const handleTogglePaperTrading = async (enabled: boolean) => {
    try {
      const updatedSettings = { ...settings, isPaperTrading: enabled };
      setSettings(updatedSettings);
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSettings),
      });
      if (res.ok) {
        await fetchSettings();
        await fetchPositions();
        await fetchRouterStats();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleKillSwitch = () => {
    showCustomConfirm(
      '💥 EMERGENCY KILL SWITCH',
      'WARNING: Emergency liquidation triggered! Close all open positions on this account immediately?',
      async () => {
        const activeMode = account.activeMode;
        const activePositions = activeMode === 'live' && account.liveAccount 
          ? account.liveAccount.positions 
          : account.paperAccount.positions;

        if (activePositions.length === 0) {
          showCustomAlert('No Active Positions', 'No active positions to liquidate.');
          return;
        }

        try {
          for (const pos of activePositions) {
            await fetch('/api/tradingview-webhook', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                passphrase: settings.webhookPassphrase,
                action: 'close',
                symbol: pos.symbol,
                price: activeMode === 'paper' ? goldPrice : undefined,
              }),
            });
          }
          showCustomAlert('Success', '💥 Kill switch activated. All positions closed successfully!');
          fetchPositions();
          fetchLogs();
        } catch (e: any) {
          showCustomAlert('Error', `Kill switch failed: ${e.message}`);
        }
      }
    );
  };

  const handleRunBacktest = async () => {
    setBacktestLoading(true);
    setBacktestError(null);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backtestParams),
      });
      if (res.ok) {
        const data = await res.json();
        setBacktestResult(data);
      } else {
        const errData = await res.json();
        setBacktestError(errData.error || 'Failed to execute backtest simulation.');
      }
    } catch (e: any) {
      setBacktestError(e.message || 'Network error executing backtest.');
    } finally {
      setBacktestLoading(false);
    }
  };

  const handleManualClose = async (symbol: string) => {
    try {
      const res = await fetch('/api/tradingview-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passphrase: settings.webhookPassphrase,
          action: 'close',
          symbol,
          price: account.activeMode === 'paper' ? goldPrice : undefined,
        }),
      });
      if (res.ok) {
        fetchPositions();
        fetchLogs();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Run manually custom simulated alert from the UI
  const handleSimulateAlert = async () => {
    setIsSimulating(true);
    setSimSuccessMsg(null);
    try {
      const res = await fetch('/api/tradingview-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passphrase: settings.webhookPassphrase,
          action: simAction,
          symbol: simSymbol,
          price: simPrice ? parseFloat(simPrice) : undefined,
          volume: simVolume ? parseFloat(simVolume) : undefined,
          comment: `Manual terminal simulation at ${new Date().toLocaleTimeString()}`,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setSimSuccessMsg(data.message || 'Alert simulated successfully!');
        fetchPositions();
        fetchLogs();
      } else {
        showCustomAlert('Simulation Error', `Simulation error: ${data.error || 'Server error'}`);
      }
    } catch (e: any) {
      showCustomAlert('Simulation Failed', `Simulation failed: ${e.message || e}`);
    } finally {
      setIsSimulating(false);
    }
  };

  // AI-Powered Pine Script Generation
  const handleGeneratePineScript = async () => {
    setIsGenerating(true);
    setPineScript('');
    setGenMessage('');
    try {
      const res = await fetch('/api/generate-pinescript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt }),
      });
      const data = await res.json();
      if (res.ok) {
        setPineScript(data.script || '');
        if (data.isDemo) {
          setGenMessage(data.message);
        }
      } else {
        showCustomAlert('Generation Failed', `Generation failed: ${data.error || 'Server error'}`);
      }
    } catch (e: any) {
      showCustomAlert('Error Generating Script', `Error generating script: ${e.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(id);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const activeAccount = account.activeMode === 'live' && account.liveAccount
    ? account.liveAccount
    : account.paperAccount;

  // Regime module active-state, driven by real router data (no forced-on fallback).
  const trendActive = settings.activeRegimeModule === 'trend' ||
    (settings.activeRegimeModule === 'auto' && routerStats?.trend?.status === 'Active');
  const rangeActive = settings.activeRegimeModule === 'range' ||
    (settings.activeRegimeModule === 'auto' && routerStats?.range?.status === 'Active');
  // Render a router stat, or an em dash when there is no real data yet.
  const stat = (v: number | undefined, suffix = '') => (v == null ? '—' : `${v}${suffix}`);

  // SVG chart path from the live price history. Empty/single-point history yields no path.
  const renderChartPath = () => {
    if (priceHistory.length < 2) return '';
    const min = Math.min(...priceHistory);
    const max = Math.max(...priceHistory);
    const range = max - min || 1;
    const height = 120;
    const width = 450;

    return priceHistory.map((val, idx) => {
      const x = (idx / (priceHistory.length - 1)) * width;
      // Invert Y coordinate so higher prices appear higher
      const y = height - ((val - min) / range) * height + 10;
      return `${x},${y}`;
    }).join(' ');
  };

  // Extract variables for setup tab representation
  const webhookUrl = `${window.location.origin}/api/tradingview-webhook`;
  const samplePayload = {
    passphrase: settings.webhookPassphrase || 'YOUR_PASSPHRASE',
    action: 'buy',
    symbol: settings.defaultSymbol || 'XAUUSDT',
    volume: settings.defaultOrderSize || 0.1,
    price: goldPrice,
    comment: 'TradingView alert trigger'
  };

  return (
    <div className="bg-neutral-950 text-neutral-100 font-sans min-h-screen flex flex-col overflow-x-hidden border-t-4 border-amber-500 selection:bg-amber-500 selection:text-black">
      
      {/* HEADER SECTION - BOLD & STARK TYPOGRAPHY */}
      <header className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between px-6 py-5 bg-neutral-900 border-b border-neutral-800 gap-4" id="header-container">
        <div className="flex flex-wrap items-center gap-4 lg:gap-6">
          <div className="text-3xl font-black italic tracking-tighter text-amber-500 flex items-center gap-2">
            <Zap className="fill-amber-500 stroke-none w-7 h-7" />
            QUANTUM.GOLD
          </div>
          <div className="h-6 w-[1px] bg-neutral-800 hidden md:block"></div>
          
          <div className="flex items-center gap-2 bg-neutral-950/80 px-3 py-1.5 rounded border border-neutral-800">
            <div className={`w-2.5 h-2.5 rounded-full ${settings.isPaperTrading ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]' : 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]'} animate-pulse`}></div>
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">
              MODE: {settings.isPaperTrading ? 'PAPER SIMULATOR' : 'LIVE PRODUCTION'}
            </span>
          </div>

          <div className="flex items-center gap-2 bg-neutral-950/80 px-3 py-1.5 rounded border border-neutral-800">
            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]"></div>
            <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-widest">
              WEBHOOKS: ACTIVE
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 lg:gap-8 justify-between lg:justify-end">
          <div className="flex items-center gap-6 text-sm">
            <div className="text-right">
              <div className="text-[9px] text-neutral-500 font-bold uppercase tracking-widest">API</div>
              <div className="text-sm font-mono text-amber-500 font-bold">
                {bridgeMetrics.latencyMs != null ? `${bridgeMetrics.latencyMs}ms` : '—'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] text-neutral-500 font-bold uppercase tracking-widest">Bridge</div>
              <div className={'text-sm font-mono font-bold ' + (bridgeMetrics.connected ? 'text-green-400' : 'text-red-500')}>
                {bridgeMetrics.connected && bridgeMetrics.bridgeAgeSec != null ? `${bridgeMetrics.bridgeAgeSec}s ago` : 'OFFLINE'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] text-neutral-500 font-bold uppercase tracking-widest">Queue</div>
              <div className="text-sm font-mono text-neutral-300">
                {bridgeMetrics.queueDepth != null ? bridgeMetrics.queueDepth : '—'}
              </div>
            </div>
          </div>
          
          <button 
            id="kill-switch-btn"
            onClick={handleKillSwitch}
            className="bg-red-600 hover:bg-red-700 text-white font-black text-xs px-6 py-3 rounded-none skew-x-[-10deg] shadow-[4px_4px_0_rgba(220,38,38,0.3)] transition-all uppercase tracking-wider cursor-pointer transform hover:-translate-y-0.5 active:translate-y-0"
          >
            KILL SWITCH
          </button>
        </div>
      </header>

      {/* SUB-HEADER BAR WITH STATS */}
      <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-2.5 flex flex-wrap gap-x-8 gap-y-2 text-xs font-mono text-neutral-400">
        <div className="flex items-center gap-2">
          <span className="text-neutral-500 uppercase tracking-wider">ACTIVE PAIR:</span>
          <span className="text-amber-500 font-bold">{settings.activeBroker === 'mt5' ? (priceSource || 'XAUUSD') : settings.defaultSymbol}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-neutral-500 uppercase tracking-wider">LEVERAGE:</span>
          <span className="text-white font-bold">{settings.defaultLeverage}x</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-neutral-500 uppercase tracking-wider">ORDER SIZE:</span>
          <span className="text-white font-bold">{settings.defaultOrderSize} Lot</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-neutral-500 uppercase tracking-wider">SL/TP:</span>
          <span className="text-neutral-300">{settings.stopLossPercent}% / {settings.takeProfitPercent}%</span>
        </div>
        <div className="ml-auto hidden md:flex items-center gap-4 text-neutral-500 text-[11px]">
          <span>NETWORK: {settings.activeBroker === 'mt5'
            ? `MT5 · ${settings.mt5Server || 'unknown server'}`
            : (settings.isTestnet ? 'BYBIT TESTNET' : 'BYBIT MAINNET')}</span>
        </div>
      </div>

      {/* INTERACTIVE TAB SELECTOR */}
      <div className="border-b border-neutral-800 bg-neutral-950 flex">
        <button
          onClick={() => setActiveTab('monitor')}
          className={`px-8 py-4 text-xs font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 border-r border-neutral-800 cursor-pointer ${
            activeTab === 'monitor'
              ? 'bg-neutral-900 text-amber-500 border-b-2 border-b-amber-500'
              : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900/50'
          }`}
        >
          <Activity className="w-4 h-4" />
          Terminal Monitor
        </button>
        <button
          onClick={() => setActiveTab('trades')}
          className={`px-8 py-4 text-xs font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 border-r border-neutral-800 cursor-pointer ${
            activeTab === 'trades'
              ? 'bg-neutral-900 text-amber-500 border-b-2 border-b-amber-500'
              : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900/50'
          }`}
        >
          <History className="w-4 h-4" />
          Closed Trades
        </button>
        <button
          onClick={() => setActiveTab('sandbox')}
          className={`px-8 py-4 text-xs font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 border-r border-neutral-800 cursor-pointer ${
            activeTab === 'sandbox'
              ? 'bg-neutral-900 text-amber-500 border-b-2 border-b-amber-500'
              : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900/50'
          }`}
        >
          <Sliders className="w-4 h-4" />
          Backtest Sandbox
        </button>
        <button
          onClick={() => setActiveTab('quant')}
          className={`px-8 py-4 text-xs font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 border-r border-neutral-800 cursor-pointer ${
            activeTab === 'quant'
              ? 'bg-neutral-900 text-amber-500 border-b-2 border-b-amber-500'
              : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900/50'
          }`}
        >
          <Brain className="w-4 h-4" />
          Quant Terminal
        </button>
        <button
          onClick={() => setActiveTab('setup')}
          className={`px-8 py-4 text-xs font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 border-r border-neutral-800 cursor-pointer ${
            activeTab === 'setup'
              ? 'bg-neutral-900 text-amber-500 border-b-2 border-b-amber-500'
              : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900/50'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          TV Alert Setup & PineScript
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-8 py-4 text-xs font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'settings'
              ? 'bg-neutral-900 text-amber-500 border-b-2 border-b-amber-500'
              : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900/50'
          }`}
        >
          <Settings className="w-4 h-4" />
          API & Risk Settings
        </button>
      </div>

      {/* CORE TERMINAL VIEWPORT */}
      <main className="flex-1 grid grid-cols-12 gap-px bg-neutral-800">
        
        {/* TAB 1: TERMINAL MONITOR (MAIN PANEL) */}
        {activeTab === 'monitor' && (
          <>
            {/* SERVER SIGNAL AUTOMATION BANNER */}
            {settings.activeBroker === 'mt5' && settings.mt5AutoMode !== 'off' && (
              <section className="col-span-12 bg-neutral-950 border-b border-neutral-800 px-6 py-4">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-300">
                      Signal Automation
                    </span>
                    <span className={'text-[9px] font-black uppercase px-2 py-0.5 border tracking-wider ' +
                      (settings.mt5AutoMode === 'auto'
                        ? 'bg-red-500/10 text-red-400 border-red-500/30'
                        : 'bg-sky-500/10 text-sky-400 border-sky-500/30')}>
                      {settings.mt5AutoMode === 'auto' ? 'AUTONOMOUS — HANDS OFF' : 'APPROVE TO FIRE'}
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-neutral-600">
                    Server evaluates a signal each 15m candle close. Change mode in Settings.
                  </span>
                </div>

                {settings.mt5AutoMode === 'approve' && (
                  pendingSignals.length === 0 ? (
                    <div className="text-[11px] font-mono text-neutral-500">No pending signals — waiting for the next qualifying candle.</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {pendingSignals.map(sig => (
                        <div key={sig.id} className="flex items-center justify-between gap-3 flex-wrap bg-neutral-900 border border-neutral-800 px-3 py-2">
                          <div className="flex items-center gap-3">
                            <span className={'text-xs font-black uppercase px-2 py-1 ' +
                              (sig.side === 'buy' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400')}>
                              {sig.side === 'buy' ? 'BUY' : 'SELL'} {sig.symbol}
                            </span>
                            <span className="text-[11px] font-mono text-neutral-300">
                              {sig.quantity} lot @ ${sig.price.toFixed(2)}
                            </span>
                            <span className="text-[9px] font-mono text-neutral-500 hidden md:inline">{sig.reason}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleApproveSignal(sig.id)}
                              className="bg-green-600 hover:bg-green-500 text-white font-black text-[10px] uppercase tracking-wider px-4 py-1.5 border-none cursor-pointer transition-all"
                            >
                              Fire
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDismissSignal(sig.id)}
                              className="bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-black text-[10px] uppercase tracking-wider px-3 py-1.5 border-none cursor-pointer transition-all"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </section>
            )}

            {/* LEFT COLUMN: ACTIVE POSITIONS AND PAPER BALANCE */}
            <section className="col-span-12 lg:col-span-4 bg-neutral-950 p-6 flex flex-col gap-6" id="positions-column">
              <div>
                <h2 className="text-xs font-black text-neutral-500 uppercase tracking-[0.2em] mb-4 flex items-center justify-between">
                  <span>Balance & Margin</span>
                  {settings.isPaperTrading && (
                    <button 
                      onClick={handleResetPaper}
                      className="text-[10px] text-amber-500 hover:underline font-mono lowercase tracking-normal flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" /> reset demo balance
                    </button>
                  )}
                </h2>
                
                <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-none relative overflow-hidden flex flex-col gap-3">
                  <div className="absolute right-4 top-4 text-neutral-700 font-black text-2xl italic tracking-tighter uppercase opacity-30 select-none">
                    {settings.isPaperTrading ? 'SIMULATOR' : 'PRODUCTION'}
                  </div>
                  
                  <div>
                    <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
                      AVAILABLE BALANCE ({settings.activeBroker === 'mt5' ? 'USD' : 'USDT'})
                    </div>
                    <div className="text-4xl font-black tracking-tight text-white mt-1 font-mono">
                      <span className="text-amber-500">$</span>{activeAccount.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>

                  {/* REAL-TIME CONNECTION STATUS */}
                  <div className="mt-1">
                    {settings.isPaperTrading ? (
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-indigo-400 bg-indigo-950/20 border border-indigo-900/30 px-2.5 py-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse"></span>
                        <span>SIMULATOR MODE: Mock paper trading with demo balance.</span>
                      </div>
                    ) : (settings.activeBroker === 'mt5' && (!settings.mt5Login || !settings.mt5Password)) ? (
                      <div className="flex flex-col gap-1 text-[10px] font-mono text-amber-400 bg-amber-950/20 border border-amber-900/30 p-2.5">
                        <div className="flex items-center gap-1.5 font-bold">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
                          <span>MT5 CREDENTIALS REQUIRED</span>
                        </div>
                        <span className="text-neutral-400 leading-normal">
                          Your MT5 account is in Live Mode, but login credentials are not set. Please go to the <strong>Settings</strong> tab.
                        </span>
                      </div>
                    ) : (settings.activeBroker === 'bybit' && (!settings.bybitApiKey || !settings.bybitApiSecret)) ? (
                      <div className="flex flex-col gap-1 text-[10px] font-mono text-amber-400 bg-amber-950/20 border border-amber-900/30 p-2.5">
                        <div className="flex items-center gap-1.5 font-bold">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
                          <span>BYBIT KEYS REQUIRED</span>
                        </div>
                        <span className="text-neutral-400 leading-normal">
                          Bybit is set as your active broker, but API keys are missing. Please configure them in the <strong>Settings</strong> tab.
                        </span>
                      </div>
                    ) : account.liveAccountError ? (
                      <div className="flex flex-col gap-2.5 text-[10px] font-mono text-red-400 bg-red-950/20 border border-red-900/40 p-3 text-left">
                        <div className="flex items-center gap-1.5 font-bold">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                          <span>CONNECTION ERROR</span>
                        </div>
                        <span className="text-neutral-400 leading-normal">{account.liveAccountError}</span>
                        <span className="text-[9px] text-neutral-500 block">Verify bridge status and credentials in Settings tab.</span>
                        <button
                          type="button"
                          onClick={() => handleTogglePaperTrading(true)}
                          className="mt-1 w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-black text-[10px] py-1.5 px-3 uppercase tracking-wider transition-all cursor-pointer border-none flex items-center justify-center gap-1.5 font-sans"
                        >
                          <Zap className="w-3.5 h-3.5 fill-current" /> Switch to Paper Simulator Mode
                        </button>
                      </div>
                    ) : !account.liveAccount ? (
                      <div className="flex flex-col gap-2.5 text-[10px] font-mono text-orange-400 bg-orange-950/20 border border-orange-900/30 p-3 text-left">
                        <div className="flex items-center gap-1.5 font-bold">
                          <span className="w-2.5 h-2.5 rounded-full bg-orange-500 animate-pulse"></span>
                          <span>LIVE SYNCHRONIZATION OFFLINE</span>
                        </div>
                        <span className="text-neutral-300 leading-normal">
                          Unable to stream live account balance. Ensure your <strong>MoebyBridge EA</strong> is loaded on your MT5 terminal, configured with your correct server URL and bridge token, and actively heartbeating.
                        </span>
                        <span className="text-neutral-400 text-[9px] font-sans">Showing simulated paper fallback in the meantime.</span>
                        <button
                          type="button"
                          onClick={() => handleTogglePaperTrading(true)}
                          className="mt-1 w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-black text-[10px] py-1.5 px-3 uppercase tracking-wider transition-all cursor-pointer border-none flex items-center justify-center gap-1.5 font-sans"
                        >
                          <Zap className="w-3.5 h-3.5 fill-current" /> Switch to Paper Simulator Mode
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-[10px] font-mono text-green-400 bg-green-950/20 border border-green-900/30 px-2.5 py-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></span>
                        <div className="leading-snug">
                          <div className="font-bold">CONNECTED & AUTHORIZED</div>
                          <div className="text-[9px] text-neutral-400">
                            {settings.activeBroker === 'mt5' ? (
                              <>MT5 Account #{settings.mt5Login || 'Unknown'} on {settings.mt5Server || 'FTMO-Demo'}</>
                            ) : (
                              <>Bybit Live Account ({settings.isTestnet ? 'Testnet Sandbox' : 'Mainnet'})</>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-4 mt-2 pt-3 border-t border-neutral-800/80 text-[11px] font-mono">
                    <div>
                      <span className="text-neutral-500">ASSET:</span> <span className="text-neutral-200">{settings.activeBroker === 'mt5' ? 'XAUUSD (Gold)' : 'USDT Contract'}</span>
                    </div>
                    <div>
                      <span className="text-neutral-500">BROKER:</span> <span className="text-neutral-200">
                        {settings.activeBroker === 'mt5' ? `MT5: ${settings.mt5Server}` : (settings.isTestnet ? 'Bybit Testnet' : 'Bybit Live')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xs font-black text-neutral-500 uppercase tracking-[0.2em]">Active Positions ({activeAccount.positions.length})</h2>
                  <div className="text-[10px] font-mono text-neutral-500">Auto-hedging is ENABLED</div>
                </div>

                {activeAccount.positions.length === 0 ? (
                  <div className="border border-dashed border-neutral-800 p-8 text-center text-neutral-600 rounded-none bg-neutral-900/10">
                    <TrendingUp className="w-8 h-8 text-neutral-700 mx-auto mb-2" />
                    <p className="text-sm font-bold uppercase tracking-wider text-neutral-500">No active positions</p>
                    {settings.activeBroker === 'mt5' && settings.mt5AutoMode !== 'off' ? (
                      <>
                        <p className="text-xs text-neutral-600 mt-1">
                          Signal automation {settings.mt5AutoMode === 'auto' ? 'AUTONOMOUS' : 'APPROVE'} — evaluating every {settings.signalCandleMinutes || 5}m candle close.
                        </p>
                        {!bridgeMetrics.connected ? (
                          <p className="text-[11px] text-red-400 mt-1 font-mono">Bridge offline — no execution until it reconnects.</p>
                        ) : (
                          <p className="text-[11px] text-amber-500 mt-1 font-mono">Arm the bridge on the MT5 chart to allow execution.</p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-neutral-600 mt-1">Waiting for TradingView trigger webhook...</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {activeAccount.positions.map((pos) => {
                      const unrealized = pos.unrealizedPnl !== undefined 
                        ? pos.unrealizedPnl 
                        : (pos.side === 'buy' ? 1 : -1) * (goldPrice - pos.entryPrice) * pos.quantity;
                      
                      const isProfit = unrealized >= 0;

                      return (
                        <div key={pos.id} className={`border p-4 rounded-none bg-neutral-900 relative ${pos.side === 'buy' ? 'border-green-500/30' : 'border-red-500/30'}`}>
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={`text-xs px-2 py-0.5 font-bold uppercase tracking-wide ${pos.side === 'buy' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                  {pos.side === 'buy' ? 'LONG' : 'SHORT'}
                                </span>
                                <span className="font-bold text-sm tracking-tight">{pos.symbol}</span>
                                <span className="text-xs text-neutral-500 font-mono">({pos.leverage}x)</span>
                              </div>
                              <span className="text-[10px] font-mono text-neutral-500 block mt-1">Entry: ${pos.entryPrice.toFixed(2)} | Qty: {pos.quantity}</span>
                              
                              {pos.module && (
                                <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                                  <span className="text-[9px] font-mono bg-amber-500/10 text-amber-400 px-1.5 py-0.5 border border-amber-500/20 uppercase tracking-widest font-semibold">
                                    {pos.module} Module
                                  </span>
                                  {pos.routerReason && (
                                    <span className="text-[9px] font-mono text-neutral-400">
                                      ({pos.routerReason})
                                    </span>
                                  )}
                                </div>
                              )}

                              {(pos.stopLossPrice || pos.takeProfitPrice) && (
                                <div className="mt-2 text-[9px] font-mono text-neutral-400 flex gap-3 bg-neutral-950 p-1.5 border border-neutral-800">
                                  {pos.stopLossPrice && <span>SL: <span className="text-red-400 font-semibold">${pos.stopLossPrice.toFixed(2)}</span></span>}
                                  {pos.takeProfitPrice && <span>TP: <span className="text-green-400 font-semibold">${pos.takeProfitPrice.toFixed(2)}</span></span>}
                                  <span className="text-[8px] text-neutral-600 font-sans uppercase">Exchange-Side stops</span>
                                </div>
                              )}
                            </div>

                            <button 
                              onClick={() => handleManualClose(pos.symbol)}
                              className="text-neutral-500 hover:text-red-400 p-1 hover:bg-neutral-800 transition-colors rounded cursor-pointer"
                              title="Manual Close"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="flex justify-between items-end mt-4 pt-3 border-t border-neutral-800/60">
                            <div>
                              <span className="text-[9px] font-mono text-neutral-500 uppercase tracking-widest block">UNREALIZED PNL</span>
                              <span className={`text-xl font-black font-mono tracking-tight ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                                {isProfit ? '+' : ''}${unrealized.toFixed(2)}
                              </span>
                            </div>
                            <button
                              onClick={() => handleManualClose(pos.symbol)}
                              className="px-3 py-1.5 bg-neutral-800 hover:bg-red-950/40 hover:text-red-400 text-neutral-300 hover:border-red-900/50 text-[10px] font-black uppercase tracking-wider border border-neutral-700 transition-all cursor-pointer"
                            >
                              MARKET CLOSE
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* APPLIED TRADE SETTINGS — what actually gets sent on a trade */}
              <div className="border border-neutral-800 bg-neutral-900/40 p-4">
                <h3 className="text-xs font-black text-neutral-300 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-amber-500" /> Applied Trade Settings
                </h3>
                {(() => {
                  const dynamicStops = settings.isHybridStopsActive;
                  const rows: { label: string; value: string; kind: 'FIXED' | 'VARIABLE' }[] = [
                    { label: 'Position size', value: `${settings.defaultOrderSize} lot`, kind: 'VARIABLE' },
                    { label: 'Leverage', value: `${settings.defaultLeverage}x`, kind: 'FIXED' },
                    { label: 'Stop loss', value: dynamicStops ? 'Dynamic (ATR)' : `${settings.stopLossPercent}% fixed`, kind: dynamicStops ? 'VARIABLE' : 'FIXED' },
                    { label: 'Take profit', value: dynamicStops ? 'Dynamic (ATR)' : `${settings.takeProfitPercent}% fixed`, kind: dynamicStops ? 'VARIABLE' : 'FIXED' },
                    { label: 'Signal timeframe', value: `${settings.signalCandleMinutes || 5}m candle`, kind: 'FIXED' },
                  ];
                  return (
                    <div className="flex flex-col gap-1.5 text-[11px] font-mono">
                      {rows.map(r => (
                        <div key={r.label} className="flex items-center justify-between gap-2">
                          <span className="text-neutral-500">{r.label}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-neutral-200 font-bold">{r.value}</span>
                            <span className={'text-[8px] font-black px-1 py-0.5 border ' + (r.kind === 'VARIABLE' ? 'text-sky-400 border-sky-500/30 bg-sky-500/5' : 'text-neutral-500 border-neutral-700')}>{r.kind}</span>
                          </div>
                        </div>
                      ))}
                      <div className="border-t border-neutral-800 mt-1.5 pt-1.5 flex flex-wrap gap-1.5">
                        {[
                          { on: settings.isKillSwitchActive, label: 'KILL SWITCH', danger: true },
                          { on: settings.isCircuitBreakerActive, label: `BREAKER ${settings.maxDrawdownPercent}%` },
                          { on: settings.isCentralRiskVetoActive, label: 'RISK VETO' },
                          { on: settings.isSessionFilterActive, label: 'SESSION FILTER' },
                        ].map(g => (
                          <span key={g.label} className={'text-[8px] font-black px-1.5 py-0.5 border tracking-wider ' +
                            (g.on ? (g.danger ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'bg-green-500/10 text-green-400 border-green-500/30') : 'bg-neutral-900 text-neutral-600 border-neutral-800')}>
                            {g.label} {g.on ? 'ON' : 'OFF'}
                          </span>
                        ))}
                      </div>
                      <p className="text-[9px] text-neutral-600 mt-1.5 leading-snug">
                        Base size is fixed but the risk manager auto-reduces it after loss streaks — hence VARIABLE. Stops are ATR-dynamic when hybrid stops are on.
                      </p>
                    </div>
                  );
                })()}
              </div>

              {/* SIMULATION TESTING SUITE IN PANEL */}
              <div className="mt-auto border border-amber-500/10 bg-amber-500/5 p-4 rounded-none">
                <h3 className="text-xs font-black text-amber-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                  <Cpu className="w-3.5 h-3.5" /> Webhook simulator suite
                </h3>
                <p className="text-[11px] text-neutral-400 mb-3 leading-relaxed">
                  Simulate live TradingView alert triggers to verify execution speeds and custom parameters locally.
                </p>

                <div className="grid grid-cols-3 gap-1 mb-2.5">
                  <button
                    onClick={() => setSimAction('buy')}
                    className={`py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all border cursor-pointer ${
                      simAction === 'buy'
                        ? 'bg-green-600/20 text-green-400 border-green-500'
                        : 'bg-neutral-900 text-neutral-500 border-neutral-800 hover:text-neutral-400'
                    }`}
                  >
                    BUY (LONG)
                  </button>
                  <button
                    onClick={() => setSimAction('sell')}
                    className={`py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all border cursor-pointer ${
                      simAction === 'sell'
                        ? 'bg-red-600/20 text-red-400 border-red-500'
                        : 'bg-neutral-900 text-neutral-500 border-neutral-800 hover:text-neutral-400'
                    }`}
                  >
                    SELL (SHORT)
                  </button>
                  <button
                    onClick={() => setSimAction('close')}
                    className={`py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all border cursor-pointer ${
                      simAction === 'close'
                        ? 'bg-neutral-800 text-white border-neutral-700'
                        : 'bg-neutral-900 text-neutral-500 border-neutral-800 hover:text-neutral-400'
                    }`}
                  >
                    CLOSE (EXIT)
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <label className="text-[9px] text-neutral-500 uppercase block mb-1">Asset Symbol</label>
                    <input
                      type="text"
                      value={simSymbol}
                      onChange={(e) => setSimSymbol(e.target.value.toUpperCase())}
                      className="w-full bg-neutral-900 border border-neutral-800 text-xs px-2 py-1 font-mono text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-neutral-500 uppercase block mb-1">Alert Volume</label>
                    <input
                      type="number"
                      step="0.01"
                      value={simVolume}
                      onChange={(e) => setSimVolume(e.target.value)}
                      className="w-full bg-neutral-900 border border-neutral-800 text-xs px-2 py-1 font-mono text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <button
                  onClick={handleSimulateAlert}
                  disabled={isSimulating}
                  className="w-full py-2 bg-amber-500 text-neutral-950 font-black uppercase text-[10px] tracking-widest hover:bg-amber-400 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {isSimulating ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin" /> EXECUTING ALGO...
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3 fill-current" /> EXECUTE MOCK TV ALERT
                    </>
                  )}
                </button>

                {simSuccessMsg && (
                  <div className="mt-2 text-[10px] font-mono text-green-400 bg-green-950/20 border border-green-900/40 p-2">
                    {simSuccessMsg}
                  </div>
                )}
              </div>
            </section>

            {/* MIDDLE/RIGHT COLUMN: GOLD TICKER, INTERACTIVE SVG CHART & WEBHOOK EVENT LOGS */}
            <section className="col-span-12 lg:col-span-8 bg-neutral-950 flex flex-col border-l border-neutral-800">
              {/* VENUE SWITCH */}
              <div className="px-6 py-3 border-b border-neutral-800 bg-neutral-950 flex items-center gap-3 flex-wrap">
                <span className="text-[9px] font-black text-neutral-500 uppercase tracking-[0.2em]">Active Venue</span>
                <div className="inline-flex border border-neutral-700 rounded overflow-hidden">
                  {([
                    { label: 'Bybit', broker: 'bybit' as const, type: 'demo' as const, dot: 'bg-amber-500' },
                    { label: 'MT5 Demo', broker: 'mt5' as const, type: 'demo' as const, dot: 'bg-sky-400' },
                    { label: 'Funded', broker: 'mt5' as const, type: 'funded' as const, dot: 'bg-green-500' },
                  ]).map(v => {
                    const active =
                      settings.activeBroker === v.broker &&
                      (v.broker === 'bybit' || settings.mt5AccountType === v.type);
                    return (
                      <button
                        key={v.label}
                        type="button"
                        disabled={venueSwitching}
                        onClick={() => handleSelectVenue(v.broker, v.type)}
                        className={
                          'flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider border-none cursor-pointer transition-all ' +
                          (active
                            ? 'bg-neutral-100 text-neutral-950'
                            : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800') +
                          (venueSwitching ? ' opacity-60 cursor-wait' : '')
                        }
                      >
                        <span className={'w-1.5 h-1.5 rounded-full ' + v.dot}></span>
                        {v.label}
                      </button>
                    );
                  })}
                </div>
                <span className="text-[9px] font-mono text-neutral-600">
                  Routing only — paper/live stays in Settings
                </span>
              </div>

              {/* TICKER STATS BAR */}
              <div className="p-6 border-b border-neutral-800 flex flex-wrap justify-between items-end gap-4 bg-neutral-900/30">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black tracking-[0.2em] text-neutral-500 uppercase">SPOT EXCHANGE SPOTLIGHT</span>
                    {priceSource ? (
                      <span className="bg-green-500/10 text-green-400 border border-green-500/20 text-[9px] px-1.5 py-0.5 font-bold uppercase tracking-wider rounded flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                        {priceSource} LIVE
                      </span>
                    ) : (
                      <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[9px] px-1.5 py-0.5 font-bold uppercase tracking-wider rounded">AWAITING BRIDGE</span>
                    )}
                  </div>
                  <h1 className="text-6xl md:text-7xl font-black tracking-tighter leading-none mt-2 font-mono">
                    <span className="text-neutral-600">$</span>
                    <span
                      key={flashKey}
                      className={
                        priceChange === 'up'
                          ? 'animate-flash-green inline-block'
                          : priceChange === 'down'
                          ? 'animate-flash-red inline-block'
                          : 'inline-block'
                      }
                    >
                      {goldPrice > 0 ? goldPrice.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—.——'}
                    </span>
                  </h1>
                </div>

                <div className="flex gap-6 text-right pb-1">
                  <div>
                    <div className="text-[9px] font-black text-neutral-500 uppercase tracking-widest">SESSION HIGH</div>
                    <div className="text-base font-bold font-mono text-white">{priceHistory.length ? `$${Math.max(...priceHistory).toFixed(2)}` : '—'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] font-black text-neutral-500 uppercase tracking-widest font-mono">SESSION LOW</div>
                    <div className="text-base font-bold font-mono text-neutral-400">{priceHistory.length ? `$${Math.min(...priceHistory).toFixed(2)}` : '—'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] font-black text-green-400 uppercase tracking-widest font-mono">WIN RATE</div>
                    <div className="text-base font-bold font-mono text-green-400">
                      {closedTrades.length ? `${Math.round((closedTrades.filter(t => t.pnl > 0).length / closedTrades.length) * 100)}%` : '—'}
                    </div>
                  </div>
                </div>
              </div>

              {/* TICKING INTERACTIVE LIVE CHART */}
              <div className="p-6 border-b border-neutral-800 bg-neutral-950 relative">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xs font-black text-neutral-500 uppercase tracking-[0.2em] flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-amber-500 rounded-full animate-ping"></span> Live Execution Stream Engine
                  </h3>
                  <span className="text-[10px] font-mono text-neutral-500">{priceHistory.length ? `RANGE: $${Math.min(...priceHistory).toFixed(1)} - $${Math.max(...priceHistory).toFixed(1)}` : 'AWAITING LIVE TICKS'}</span>
                </div>

                <div className="h-56 w-full bg-neutral-900 border border-neutral-800 flex items-center justify-center relative overflow-hidden">
                  <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #fff 1px, transparent 0)', backgroundSize: '16px 16px' }}></div>
                  
                  {/* Grid Lines */}
                  <div className="absolute inset-0 flex flex-col justify-between p-4 opacity-10 pointer-events-none">
                    <div className="border-b border-white w-full"></div>
                    <div className="border-b border-white w-full"></div>
                    <div className="border-b border-white w-full"></div>
                    <div className="border-b border-white w-full"></div>
                  </div>

                  <svg className="w-full h-full p-4 overflow-visible" viewBox="0 0 450 140" preserveAspectRatio="none">
                    <polyline 
                      fill="none" 
                      stroke="#f59e0b" 
                      strokeWidth="2.5" 
                      points={renderChartPath()} 
                      className="transition-all duration-300"
                    />
                    {/* Pulsing point on last price item */}
                    {priceHistory.length > 1 && (
                      <circle
                        cx={450}
                        cy={140 - ((priceHistory[priceHistory.length - 1] - Math.min(...priceHistory)) / (Math.max(...priceHistory) - Math.min(...priceHistory) || 1)) * 120 + 10}
                        r="5"
                        fill="#f59e0b"
                        className="animate-pulse"
                      />
                    )}
                  </svg>
                  
                  <div className="absolute bottom-4 left-4 bg-black/80 px-2 py-1 text-[10px] font-mono text-amber-500 border border-amber-500/20 tracking-wider">
                    {priceSource ? `${priceSource} · LIVE FEED` : 'AWAITING BRIDGE'}
                  </div>
                </div>
              </div>

              {/* REGIME ROUTER MULTI-STRATEGY ENGINE PERFORMANCE */}
              <div className="p-6 border-b border-neutral-800 bg-neutral-900/10">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-2">
                  <div>
                    <h3 className="text-xs font-black text-neutral-500 uppercase tracking-[0.2em] flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-amber-500" /> Regime-Switching Multi-Strategy Engine
                    </h3>
                    <p className="text-[10px] text-neutral-400 mt-1">
                      Dynamic Router routing signals based on ADX (Threshold: 22). Active Module runs execution.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 bg-neutral-900 px-3 py-1.5 border border-neutral-800 font-mono text-[10px]">
                    <span className="text-neutral-500">ROUTER STATE:</span>
                    <span className="text-amber-400 font-black uppercase">
                      {settings.activeRegimeModule === 'auto' ? 'AUTO-REGIME' : `FORCED ${settings.activeRegimeModule.toUpperCase()}`}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Trend Module Card */}
                  <div className={`border p-4 bg-neutral-950/80 relative transition-all ${
                    trendActive
                      ? 'border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.05)]'
                      : 'border-neutral-800 opacity-60'
                  }`}>
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <span className="text-xs font-black text-white uppercase tracking-wider block">
                          Trend Follower Module
                        </span>
                        <span className="text-[9px] text-neutral-500 font-mono block">
                          High ADX Momentum Engine
                        </span>
                      </div>
                      <span className={`text-[9px] font-mono font-black uppercase px-2 py-0.5 border ${
                        trendActive
                          ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 animate-pulse'
                          : 'bg-neutral-900 text-neutral-600 border-neutral-800'
                      }`}>
                        {trendActive ? 'ACTIVE' : 'IDLE'}
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-1 border-t border-neutral-900 pt-3">
                      <div>
                        <span className="text-[8px] font-mono text-neutral-500 block uppercase">TRADES</span>
                        <span className="text-sm font-bold font-mono text-neutral-200">{stat(routerStats?.trend?.tradesCount)}</span>
                      </div>
                      <div>
                        <span className="text-[8px] font-mono text-neutral-500 block uppercase">WIN RATE</span>
                        <span className="text-sm font-bold font-mono text-green-400">{stat(routerStats?.trend?.winRate, '%')}</span>
                      </div>
                      <div>
                        <span className="text-[8px] font-mono text-neutral-500 block uppercase">TOTAL PNL</span>
                        <span className="text-sm font-bold font-mono text-emerald-400">{routerStats?.trend ? `$${routerStats.trend.totalPnl.toFixed(2)}` : '—'}</span>
                      </div>
                      <div>
                        <span className="text-[8px] font-mono text-neutral-500 block uppercase">EXPECTANCY</span>
                        <span className="text-sm font-bold font-mono text-amber-500">{stat(routerStats?.trend?.expectancyR, 'R')}</span>
                      </div>
                    </div>
                  </div>

                  {/* Range Module Card */}
                  <div className={`border p-4 bg-neutral-950/80 relative transition-all ${
                    rangeActive
                      ? 'border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.05)]'
                      : 'border-neutral-800 opacity-60'
                  }`}>
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <span className="text-xs font-black text-white uppercase tracking-wider block">
                          Range Scalper Module
                        </span>
                        <span className="text-[9px] text-neutral-500 font-mono block">
                          Low ADX Mean Reversion Engine
                        </span>
                      </div>
                      <span className={`text-[9px] font-mono font-black uppercase px-2 py-0.5 border ${
                        rangeActive
                          ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 animate-pulse'
                          : 'bg-neutral-900 text-neutral-600 border-neutral-800'
                      }`}>
                        {rangeActive ? 'ACTIVE' : 'IDLE'}
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-1 border-t border-neutral-900 pt-3">
                      <div>
                        <span className="text-[8px] font-mono text-neutral-500 block uppercase">TRADES</span>
                        <span className="text-sm font-bold font-mono text-neutral-200">{stat(routerStats?.range?.tradesCount)}</span>
                      </div>
                      <div>
                        <span className="text-[8px] font-mono text-neutral-500 block uppercase">WIN RATE</span>
                        <span className="text-sm font-bold font-mono text-green-400">{stat(routerStats?.range?.winRate, '%')}</span>
                      </div>
                      <div>
                        <span className="text-[8px] font-mono text-neutral-500 block uppercase">TOTAL PNL</span>
                        <span className="text-sm font-bold font-mono text-emerald-400">{routerStats?.range ? `$${routerStats.range.totalPnl.toFixed(2)}` : '—'}</span>
                      </div>
                      <div>
                        <span className="text-[8px] font-mono text-neutral-500 block uppercase">EXPECTANCY</span>
                        <span className="text-sm font-bold font-mono text-amber-500">{stat(routerStats?.range?.expectancyR, 'R')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* HISTORICAL BALANCE GROWTH & PNL (30 DAYS) */}
              <div className="p-6 border-b border-neutral-800 bg-neutral-950">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xs font-black text-neutral-500 uppercase tracking-[0.2em] flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-emerald-500" /> 30-Day Historical Account Growth & PnL
                  </h3>
                  <div className="flex gap-4 text-xs font-mono">
                    <div className="text-neutral-500">
                      INITIAL: <span className="text-neutral-300 font-bold">$10,000.00</span>
                    </div>
                    <div className="text-emerald-500 font-bold">
                      CURRENT: ${activeAccount.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                <div className="h-48 w-full bg-neutral-900 border border-neutral-800 p-4 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={generateHistoricalPnLData(activeAccount.balance, closedTrades)}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                      <XAxis 
                        dataKey="date" 
                        stroke="#737373" 
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="#737373" 
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        domain={['dataMin - 100', 'dataMax + 100']}
                        tickFormatter={(v) => `$${v}`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#171717',
                          borderColor: '#404040',
                          color: '#fff',
                          fontSize: '11px',
                          fontFamily: 'monospace'
                        }}
                        formatter={(value: any) => [`$${parseFloat(value).toFixed(2)}`, 'Balance']}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="balance" 
                        stroke="#10b981" 
                        strokeWidth={2}
                        fillOpacity={1} 
                        fill="url(#colorBalance)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* INCOMING ALERTS LOG STREAM */}
              <div className="p-6 flex-1 flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xs font-black text-neutral-500 uppercase tracking-[0.2em] flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-amber-500" />
                    Incoming Webhook Alerts Log
                  </h3>
                  <button 
                    onClick={handleClearLogs}
                    className="text-xs text-neutral-500 hover:text-red-400 hover:underline flex items-center gap-1 uppercase tracking-wider cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Clear logs
                  </button>
                </div>

                {logs.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-neutral-800 p-12 text-neutral-600">
                    <Terminal className="w-12 h-12 text-neutral-800 mb-2" />
                    <span className="font-bold uppercase tracking-wider text-neutral-500 text-xs">No alerts recorded yet</span>
                    <span className="text-[11px] text-neutral-600 text-center mt-1 max-w-sm">Connect your TradingView Premium webhook alert parameters to generate automated executions instantly.</span>
                  </div>
                ) : (
                  <div className="space-y-2 overflow-y-auto max-h-[360px] pr-2 scrollbar-thin scrollbar-thumb-neutral-800">
                    {logs.map((log) => {
                      const isAuthFailed = log.status === 'auth_failed';
                      const isExecFailed = log.status === 'execution_failed';
                      const isSuccess = log.status === 'success';

                      let badgeColor = 'bg-neutral-800 text-neutral-400 border-neutral-700';
                      if (isSuccess) badgeColor = 'bg-green-500/10 text-green-400 border-green-500/20';
                      if (isAuthFailed) badgeColor = 'bg-red-500/10 text-red-400 border-red-500/20';
                      if (isExecFailed) badgeColor = 'bg-amber-500/10 text-amber-400 border-amber-500/20';

                      return (
                        <div key={log.id} className="animate-log-fade-in bg-neutral-900 border border-neutral-800/80 p-3 flex flex-col md:flex-row gap-4 items-start md:items-center font-mono text-xs">
                          <div className="flex items-center gap-3 w-full md:w-auto">
                            <span className="text-neutral-500 text-[10px] whitespace-nowrap">
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </span>
                            <span className={`text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider border whitespace-nowrap ${badgeColor}`}>
                              {log.status.toUpperCase()}
                            </span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-neutral-200 font-bold truncate">
                              {log.message}
                            </p>
                            <p className="text-[10px] text-neutral-500 mt-0.5 truncate">
                              Payload: {JSON.stringify(log.rawBody)}
                            </p>
                          </div>

                          <div className="text-right text-[11px] text-neutral-400 font-bold shrink-0">
                            {log.action !== 'none' && (
                              <span>
                                {log.action.toUpperCase()} {log.quantity} {log.symbol} @ ${log.price}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </>
        )}

        {/* TAB 2: TV ALERT SETUP & PINESCRIPT GENERATOR */}
        {activeTab === 'setup' && (
          <section className="col-span-12 bg-neutral-950 p-6 lg:p-8 flex flex-col lg:grid lg:grid-cols-12 gap-8">
            {/* LEFT COLUMN: WEBHOOK SETUP PARAMETERS */}
            <div className="lg:col-span-5 space-y-6">
              <div>
                <h2 className="text-xl font-black italic tracking-tighter text-amber-500 mb-2 uppercase">Webhook Integration Guideline</h2>
                <p className="text-sm text-neutral-400 leading-relaxed">
                  Configure your premium TradingView Alerts to point to this private receiver terminal. Every alert payload is parsed and executed with microsecond delays.
                </p>
              </div>

              <div className="space-y-4">
                <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-none">
                  <div className="text-[10px] font-black text-neutral-500 uppercase tracking-widest mb-1.5">WEBHOOK ENDPOINT TARGET</div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={webhookUrl}
                      className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2 font-mono text-amber-500 select-all focus:outline-none"
                    />
                    <button
                      onClick={() => copyToClipboard(webhookUrl, 'webhook-url')}
                      className="px-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 transition-colors cursor-pointer"
                    >
                      {copiedText === 'webhook-url' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <span className="text-[10px] text-neutral-500 block mt-2">
                    ⚠️ Enter this exact URL inside the "Webhook URL" field of your TradingView Alert setup.
                  </span>
                </div>

                <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-none">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">EXAMPLE ALREADY SCHEMA (JSON)</span>
                    <button
                      onClick={() => copyToClipboard(JSON.stringify(samplePayload, null, 2), 'webhook-payload')}
                      className="text-[10px] text-amber-500 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      {copiedText === 'webhook-payload' ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />} copy schema
                    </button>
                  </div>
                  <pre className="text-[10.5px] font-mono text-neutral-300 bg-neutral-950 p-3 border border-neutral-800 overflow-x-auto">
                    {JSON.stringify(samplePayload, null, 2)}
                  </pre>
                  <p className="text-[10px] text-neutral-500 mt-2 leading-relaxed">
                    Ensure variables match. Webhook supports <code className="text-amber-500">"buy"</code>, <code className="text-amber-500">"sell"</code>, and <code className="text-amber-500">"close"</code> actions. Symbol defaults to Bybit pairs e.g. <code className="text-neutral-300">"XAUUSDT"</code>.
                  </p>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: AI PINE SCRIPT GENERATOR */}
            <div className="lg:col-span-7 bg-neutral-900 border border-neutral-800 p-6 flex flex-col h-full justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="text-amber-500 w-5 h-5 fill-amber-500/20" />
                  <h3 className="text-base font-black text-neutral-100 uppercase tracking-wider">AI Pine Script Strategy Builder</h3>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed mb-4">
                  Input any technical indicators or logic strategies. The built-in AI assistant will compile a fully configured Pine Script (v5) matching the webhooks and risk setup directly.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest block mb-1.5">Strategy Prompt Description</label>
                    <textarea
                      rows={3}
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="e.g. Bollinger Bands breakout strategy combined with an RSI oversold confirmation filter on 15-minute intervals"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-none text-xs p-3 text-neutral-200 focus:outline-none focus:border-amber-500 font-sans"
                    />
                  </div>

                  <button
                    onClick={handleGeneratePineScript}
                    disabled={isGenerating || !aiPrompt}
                    className="w-full py-3 bg-amber-500 text-neutral-950 hover:bg-amber-400 font-black uppercase text-xs tracking-widest transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    {isGenerating ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> COMPILED BY AI ASSISTANT...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" /> GENERATE PRIVATE PineScript V5
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* PINE SCRIPT OUTPUT CONTAINER */}
              {(pineScript || genMessage) && (
                <div className="mt-6 flex-1 flex flex-col">
                  {genMessage && (
                    <div className="text-[11px] font-mono text-amber-500 bg-amber-500/5 border border-amber-500/10 p-3 mb-3 leading-relaxed">
                      {genMessage}
                    </div>
                  )}

                  {pineScript && (
                    <div className="flex-1 flex flex-col">
                      <div className="flex justify-between items-center bg-neutral-950 border-t border-x border-neutral-800 px-4 py-2 text-[10px] font-mono text-neutral-400">
                        <span>Pinescript_v5_Strategy.txt</span>
                        <button
                          onClick={() => copyToClipboard(pineScript, 'pinescript')}
                          className="text-amber-500 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          {copiedText === 'pinescript' ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />} copy script
                        </button>
                      </div>
                      <textarea
                        readOnly
                        value={pineScript}
                        rows={12}
                        className="w-full bg-neutral-950 border border-neutral-800 text-xs p-4 font-mono text-green-400 select-all focus:outline-none resize-none leading-relaxed"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* TAB 3: API & RISK SETTINGS */}
        {activeTab === 'settings' && (
          <section className="col-span-12 bg-neutral-950 p-6 lg:p-8">
            <form onSubmit={handleSaveSettings} className="max-w-4xl space-y-8">
              
              {/* BROKER SELECTION & AUTHENTICATION */}
              <div>
                <h3 className="text-base font-black text-amber-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Shield className="w-4 h-4" /> Exchange & Prop Firm API Integration
                </h3>
                <p className="text-xs text-neutral-400 mb-4 leading-relaxed">
                  Select your active target broker platform and provide connection credentials. You can route orders to standard Bybit API or MT5 WebAPI (perfect for Prop-Firm evaluations like FTMO, FundedNext, etc.).
                </p>

                <div className="flex gap-2 mb-4 border-b border-neutral-800 pb-3">
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, activeBroker: 'bybit' })}
                    className={`px-4 py-2.5 text-xs font-black uppercase tracking-wider transition-all border rounded-none cursor-pointer ${
                      settings.activeBroker === 'bybit'
                        ? 'bg-amber-500 text-neutral-950 border-amber-500'
                        : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:bg-neutral-800 hover:text-white'
                    }`}
                  >
                    BYBIT UNIFIED / CONTRACT API
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, activeBroker: 'mt5' })}
                    className={`px-4 py-2.5 text-xs font-black uppercase tracking-wider transition-all border rounded-none cursor-pointer ${
                      settings.activeBroker === 'mt5'
                        ? 'bg-amber-500 text-neutral-950 border-amber-500'
                        : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:bg-neutral-800 hover:text-white'
                    }`}
                  >
                    METATRADER 5 (MT5) WEBAPI / BRIDGE
                  </button>
                </div>

                {settings.activeBroker === 'bybit' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-neutral-900 border border-neutral-800 p-6">
                    <div>
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">BYBIT API KEY</label>
                      <input
                        type="text"
                        value={settings.bybitApiKey}
                        onChange={(e) => setSettings({ ...settings, bybitApiKey: e.target.value })}
                        placeholder="Insert Bybit API key"
                        className="w-full bg-neutral-950 border border-neutral-800 text-sm px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">BYBIT API SECRET</label>
                      <input
                        type="password"
                        value={settings.bybitApiSecret}
                        onChange={(e) => setSettings({ ...settings, bybitApiSecret: e.target.value })}
                        placeholder={settings.bybitApiSecret ? '••••••••••••••••' : 'Insert API Secret'}
                        className="w-full bg-neutral-950 border border-neutral-800 text-sm px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id="paper-trading-chk"
                          checked={settings.isPaperTrading}
                          onChange={(e) => setSettings({ ...settings, isPaperTrading: e.target.checked })}
                          className="w-4 h-4 text-amber-500 focus:ring-0 focus:ring-offset-0 accent-amber-500 bg-neutral-950 border-neutral-800"
                        />
                        <div>
                          <label htmlFor="paper-trading-chk" className="text-xs font-bold text-white uppercase block cursor-pointer">
                            Enable Paper Trading / Simulator Mode
                          </label>
                          <span className="text-[10px] text-neutral-500">
                            Bypasses Bybit execution entirely and runs simulated orders with market ticker rates.
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id="testnet-chk"
                          checked={settings.isTestnet}
                          onChange={(e) => setSettings({ ...settings, isTestnet: e.target.checked })}
                          className="w-4 h-4 text-amber-500 focus:ring-0 focus:ring-offset-0 accent-amber-500 bg-neutral-950 border-neutral-800"
                        />
                        <div>
                          <label htmlFor="testnet-chk" className="text-xs font-bold text-white uppercase block cursor-pointer">
                            Use Bybit Sandbox (Testnet)
                          </label>
                          <span className="text-[10px] text-neutral-500">
                            Connects to <code className="text-neutral-400">api-testnet.bybit.com</code> instead of standard production servers.
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Multi-Account Registry List */}
                    <div className="bg-neutral-900 border border-neutral-800 p-6 text-left">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                        <div>
                          <h4 className="text-xs font-black text-white uppercase tracking-wider">Registered MT5 & FundedNext Accounts</h4>
                          <p className="text-[10px] text-neutral-400 mt-0.5">Configure multiple demo or funded prop-firm accounts and instantly switch the active webhook router target.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMT5Acc(null);
                            setMt5Form({
                              name: '',
                              login: '',
                              password: '',
                              server: 'FTMO-Demo',
                              type: 'demo',
                              gatewayType: 'local',
                              gatewayUrl: 'http://localhost:5000',
                              gatewayToken: '',
                              isActive: false,
                            });
                            setShowAddMT5Modal(!showAddMT5Modal);
                          }}
                          className="px-3 py-1.5 bg-amber-500/10 text-amber-500 hover:bg-amber-500 hover:text-neutral-950 font-bold text-[10px] uppercase tracking-wider border border-amber-500/20 flex items-center gap-1.5 transition-all cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" /> REGISTER NEW ACCOUNT
                        </button>
                      </div>

                      {/* Add/Edit Account nested card */}
                      {showAddMT5Modal && (
                        <div className="bg-neutral-950 border border-neutral-800 p-5 mb-6 relative">
                          <button
                            type="button"
                            onClick={() => setShowAddMT5Modal(false)}
                            className="absolute top-4 right-4 text-neutral-400 hover:text-white cursor-pointer bg-transparent border-none"
                          >
                            <X className="w-4 h-4" />
                          </button>
                          <h5 className="text-[11px] font-black text-amber-500 uppercase tracking-widest mb-4">
                            {editingMT5Acc ? `Edit Account: ${editingMT5Acc.name}` : 'Register New FundedNext / MT5 Account'}
                          </h5>
                          
                          {mt5Error && (
                            <div className="bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400 font-bold mb-4">
                              {mt5Error}
                            </div>
                          )}

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1">Account Display Name</label>
                              <input
                                type="text"
                                value={mt5Form.name}
                                onChange={(e) => setMt5Form({ ...mt5Form, name: e.target.value })}
                                placeholder="e.g., FundedNext Demo Account"
                                className="w-full bg-neutral-900 border border-neutral-800 text-xs px-3 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                              />
                            </div>

                            <div>
                              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1">Account Type</label>
                              <select
                                value={mt5Form.type}
                                onChange={(e) => setMt5Form({ ...mt5Form, type: e.target.value as any })}
                                className="w-full bg-neutral-900 border border-neutral-800 text-xs px-3 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                              >
                                <option value="demo">DEMO / EVALUATION</option>
                                <option value="funded">FUNDED / LIVE</option>
                              </select>
                            </div>

                            <div>
                              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1">MT5 Login ID</label>
                              <input
                                type="text"
                                value={mt5Form.login}
                                onChange={(e) => setMt5Form({ ...mt5Form, login: e.target.value })}
                                placeholder="e.g., 5012345"
                                className="w-full bg-neutral-900 border border-neutral-800 text-xs px-3 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                              />
                            </div>

                            <div>
                              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1">MT5 Password</label>
                              <input
                                type="password"
                                value={mt5Form.password}
                                onChange={(e) => setMt5Form({ ...mt5Form, password: e.target.value })}
                                placeholder={editingMT5Acc ? "••••••••••••••••" : "Insert MT5 Master / Investor Password"}
                                className="w-full bg-neutral-900 border border-neutral-800 text-xs px-3 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                              />
                            </div>

                            <div>
                              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1">MT5 Server Name</label>
                              <input
                                type="text"
                                value={mt5Form.server}
                                onChange={(e) => setMt5Form({ ...mt5Form, server: e.target.value })}
                                placeholder="e.g., FundedNext-Server, FTMO-Demo"
                                className="w-full bg-neutral-900 border border-neutral-800 text-xs px-3 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                              />
                            </div>

                            <div>
                              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1">Connection Gateway Type</label>
                              <select
                                value={mt5Form.gatewayType}
                                onChange={(e) => setMt5Form({ ...mt5Form, gatewayType: e.target.value as any })}
                                className="w-full bg-neutral-900 border border-neutral-800 text-xs px-3 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                              >
                                <option value="cloud">☁️ CLOUD GATEWAY (NO SCRIPT REQUIRED)</option>
                                <option value="local">💻 LOCAL PYTHON REST BRIDGE</option>
                              </select>
                            </div>

                            {mt5Form.gatewayType === 'cloud' ? (
                              <>
                                <div>
                                  <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1">Cloud Gateway Host URL</label>
                                  <input
                                    type="text"
                                    value={mt5Form.gatewayUrl}
                                    onChange={(e) => setMt5Form({ ...mt5Form, gatewayUrl: e.target.value })}
                                    placeholder="e.g., https://api.mtapi.be"
                                    className="w-full bg-neutral-900 border border-neutral-800 text-xs px-3 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1">Cloud API Bearer Token (Optional)</label>
                                  <input
                                    type="password"
                                    value={mt5Form.gatewayToken}
                                    onChange={(e) => setMt5Form({ ...mt5Form, gatewayToken: e.target.value })}
                                    placeholder={editingMT5Acc && mt5Form.gatewayToken ? "••••••••••••••••" : "Insert cloud access token"}
                                    className="w-full bg-neutral-900 border border-neutral-800 text-xs px-3 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                                  />
                                </div>
                              </>
                            ) : (
                              <div className="md:col-span-2">
                                <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1">Local Rest Bridge Host</label>
                                <input
                                  type="text"
                                  value={mt5Form.gatewayUrl}
                                  onChange={(e) => setMt5Form({ ...mt5Form, gatewayUrl: e.target.value })}
                                  placeholder="e.g., http://localhost:5000"
                                  className="w-full bg-neutral-900 border border-neutral-800 text-xs px-3 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                                />
                              </div>
                            )}

                            <div className="md:col-span-2 flex justify-end gap-2 pt-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setShowAddMT5Modal(false);
                                  setEditingMT5Acc(null);
                                }}
                                className="px-4 py-2 bg-neutral-800 text-neutral-400 hover:text-white font-bold text-xs uppercase border border-neutral-700 cursor-pointer"
                              >
                                CANCEL
                              </button>
                              <button
                                type="button"
                                onClick={handleSaveMT5Account}
                                className="px-4 py-2 bg-amber-500 text-neutral-950 hover:bg-amber-400 font-bold text-xs uppercase cursor-pointer"
                              >
                                {editingMT5Acc ? 'SAVE CHANGES' : 'REGISTER ACCOUNT'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Accounts Cards Grid */}
                      {mt5Accounts.length === 0 ? (
                        <div className="text-center py-8 bg-neutral-950/40 border border-neutral-800/40 border-dashed">
                          <Activity className="w-8 h-8 text-neutral-600 mx-auto mb-2 animate-pulse" />
                          <p className="text-xs text-neutral-500 font-mono">NO ACTIVE MT5 / FUNDEDNEXT ACCOUNTS REGISTERED</p>
                          <p className="text-[10px] text-neutral-600 mt-1">Register an account using Cloud Gateway or Local Bridge to enable prop-firm trading.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                          {mt5Accounts.map((acc) => (
                            <div
                              key={acc.id}
                              onClick={() => handleSelectMT5Account(acc.id)}
                              className={`p-4 border transition-all cursor-pointer relative flex flex-col justify-between ${
                                acc.isActive
                                  ? 'bg-neutral-950 border-amber-500/80 shadow-[0_0_15px_-3px_rgba(245,158,11,0.15)]'
                                  : 'bg-neutral-950/50 border-neutral-800/70 hover:border-neutral-700 hover:bg-neutral-950'
                              }`}
                            >
                              {acc.isActive && (
                                <span className="absolute top-3 right-3 flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-amber-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                                </span>
                              )}
                              <div>
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className={`text-[9px] font-black px-1.5 py-0.5 tracking-wider ${
                                    acc.type === 'funded' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-neutral-800 text-neutral-400'
                                  }`}>
                                    {acc.type.toUpperCase()}
                                  </span>
                                  <span className="text-xs font-bold text-white uppercase tracking-tight">{acc.name}</span>
                                </div>
                                <div className="grid grid-cols-2 gap-y-1 text-[10px] font-mono text-neutral-400">
                                  <div>LOGIN ID:</div>
                                  <div className="text-white text-right">{acc.login}</div>
                                  <div>SERVER:</div>
                                  <div className="text-white text-right truncate max-w-[120px]">{acc.server}</div>
                                  <div>GATEWAY:</div>
                                  <div className="text-amber-500 text-right uppercase tracking-wider">{acc.gatewayType === 'cloud' ? '☁️ Cloud' : '💻 Local'}</div>
                                </div>
                              </div>
                              <div className="flex justify-end gap-2 mt-4 border-t border-neutral-900 pt-2.5">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingMT5Acc(acc);
                                    setMt5Form({
                                      name: acc.name,
                                      login: acc.login,
                                      password: '', 
                                      server: acc.server,
                                      type: acc.type,
                                      gatewayType: acc.gatewayType,
                                      gatewayUrl: acc.gatewayUrl,
                                      gatewayToken: acc.gatewayToken || '',
                                      isActive: acc.isActive,
                                    });
                                    setShowAddMT5Modal(true);
                                  }}
                                  className="p-1 text-neutral-500 hover:text-amber-500 transition-colors cursor-pointer bg-transparent border-none focus:outline-none"
                                  title="Edit account credentials"
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteMT5Account(acc.id);
                                  }}
                                  className="p-1 text-neutral-500 hover:text-red-500 transition-colors cursor-pointer bg-transparent border-none focus:outline-none"
                                  title="Delete account"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Active MT5 Configuration Form */}
                    <div className="bg-neutral-900 border border-neutral-800 p-6 text-left">
                      <h4 className="text-xs font-black text-white uppercase tracking-wider mb-2">Active MT5 Connection Properties</h4>
                      <p className="text-[10px] text-neutral-400 mb-4 leading-relaxed">
                        Adjust specific parameters for the currently active MT5 target. Whichever gateway connection mode you select is saved instantly.
                      </p>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">ACTIVE CONNECTION METHOD</label>
                          <select
                            value={settings.mt5GatewayType}
                            onChange={(e) => setSettings({ ...settings, mt5GatewayType: e.target.value as any })}
                            className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                          >
                            <option value="cloud">☁️ CLOUD GATEWAY (PRO - NO SCRIPT REQUIRED)</option>
                            <option value="local">💻 LOCAL PYTHON REST BRIDGE</option>
                          </select>
                        </div>

                        <div>
                          <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">
                            {settings.mt5GatewayType === 'cloud' ? 'CLOUD GATEWAY HOST URL' : 'LOCAL REST BRIDGE ENDPOINT'}
                          </label>
                          <input
                            type="text"
                            value={settings.mt5GatewayType === 'cloud' ? settings.mt5GatewayUrl : settings.mt5Host}
                            onChange={(e) => {
                              if (settings.mt5GatewayType === 'cloud') {
                                setSettings({ ...settings, mt5GatewayUrl: e.target.value });
                              } else {
                                setSettings({ ...settings, mt5Host: e.target.value });
                              }
                            }}
                            className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>

                        {settings.mt5GatewayType === 'cloud' && (
                          <div className="md:col-span-2">
                            <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">CLOUD ACCESS API KEY / BEARER TOKEN (OPTIONAL)</label>
                            <input
                              type="password"
                              value={settings.mt5GatewayToken}
                              onChange={(e) => setSettings({ ...settings, mt5GatewayToken: e.target.value })}
                              placeholder={settings.mt5GatewayToken ? "••••••••••••••••" : "Enter cloud gateway bearer token"}
                              className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* MT5 REST BRIDGE SETUP GUIDE */}
                    <div className="md:col-span-2 border-t border-neutral-800/80 pt-4 mt-2">
                      <button
                        type="button"
                        onClick={() => setShowMt5Guide(!showMt5Guide)}
                        className="text-xs text-amber-500 hover:text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer bg-transparent border-none p-0 focus:outline-none"
                      >
                        <HelpCircle className="w-4 h-4" />
                        {showMt5Guide ? 'Hide MT5 REST Bridge Setup Guide' : 'Show MT5 REST Bridge Setup Guide'}
                      </button>

                      {showMt5Guide && (
                        <div className="mt-4 bg-neutral-950 p-5 border border-neutral-800 text-xs text-neutral-300 flex flex-col gap-3 font-sans leading-relaxed">
                          <h4 className="text-amber-500 font-black uppercase tracking-wider text-[11px] mb-1">FundedNext MT5 REST Bridge Setup Instructions</h4>
                          
                          {/* AUTOMATED SETUP BANNER */}
                          <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-md mb-2 flex flex-col gap-2">
                            <span className="text-amber-400 font-bold uppercase tracking-wider text-xs flex items-center gap-1.5">
                              🚀 NEW: Fully Automated MT5 Bridge Setup (Recommended)
                            </span>
                            <p className="text-neutral-300 text-[11px] leading-relaxed">
                              You can now completely automate the deployment of your MT5 Bridge! We have created a master automation utility 
                              <code className="text-white font-mono bg-neutral-900 px-1 py-0.5 border border-neutral-800 mx-1">MoebyAutomator.py</code> 
                              located in your <code className="text-white font-mono bg-neutral-900 px-1 py-0.5 border border-neutral-800">/mt5_ea</code> folder.
                            </p>
                            <div className="mt-2 flex flex-col gap-1 text-[11px] font-mono text-neutral-400 pl-2">
                              <div>• <strong className="text-white">Auto-Deployment:</strong> Downloads settings, compiles <code className="text-amber-400">MoebyBridge.mq5</code>, and installs it automatically.</div>
                              <div>• <strong className="text-white">Headless Launch:</strong> Generates <code className="text-amber-400">startup.ini</code> and boots MT5 headlessly.</div>
                              <div>• <strong className="text-white">API Daemon:</strong> Keeps connections alive and hosts a secure local Flask REST Server automatically.</div>
                            </div>
                            <div className="mt-2 text-neutral-300 text-[11px]">
                              To run it on your Windows/VPS machine with one click:
                              <pre className="mt-2 bg-neutral-950 p-2.5 border border-neutral-800 text-amber-500 font-mono text-[10px] rounded overflow-x-auto text-left">
{`cd /path/to/your/cloned/repo/mt5_ea
run_bridge.bat`}
                              </pre>
                            </div>
                          </div>

                          <p>
                            MetaTrader 5 is a native desktop software and does not expose a public web REST API out of the box. 
                            To bridge your <strong>FundedNext MT5 account</strong> to this web dashboard, you can also run the small Python REST Bridge script manually as detailed below.
                          </p>

                          <div className="flex flex-col gap-2 bg-neutral-900/50 p-3.5 border border-neutral-800/50">
                            <span className="font-bold text-white text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                              <span className="w-4 h-4 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full flex items-center justify-center text-[9px] font-mono">1</span>
                              Prerequisites:
                            </span>
                            <ul className="list-disc list-inside space-y-1 text-neutral-400 font-mono text-[10px] pl-2">
                              <li>Install Python 3.8+ on your Windows MT5 terminal computer or VPS.</li>
                              <li>Run in your cmd terminal: <code className="text-white bg-neutral-950 px-1 py-0.5 rounded border border-neutral-800">pip install MetaTrader5 Flask flask-cors</code></li>
                            </ul>
                          </div>

                          <div className="flex flex-col gap-2 bg-neutral-900/50 p-3.5 border border-neutral-800/50">
                            <span className="font-bold text-white text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                              <span className="w-4 h-4 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full flex items-center justify-center text-[9px] font-mono">2</span>
                              Save and Run this Python Bridge script (<code className="lowercase text-amber-400">mt5_bridge.py</code>):
                            </span>
                            
                            <div className="relative">
                              <pre className="bg-neutral-950 p-3 border border-neutral-800 text-[10px] font-mono text-neutral-400 overflow-x-auto max-h-48 leading-normal text-left">
{`import MetaTrader5 as mt5
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app) # Allow web interface connection

@app.route('/account', methods=['GET'])
def get_account():
    login = int(request.headers.get('X-MT5-LOGIN', 0))
    server = request.headers.get('X-MT5-SERVER', '')
    password = request.headers.get('Authorization', '').replace('Bearer ', '')
    
    if not mt5.initialize(login=login, server=server, password=password):
        return jsonify({"error": f"Failed to initialize MT5: {mt5.last_error()}"}), 401
        
    info = mt5.account_info()
    if info is None:
        return jsonify({"error": "Failed to retrieve account details"}), 500
        
    return jsonify({
        "balance": info.balance,
        "equity": info.equity,
        "currency": info.currency or 'USD'
    })

@app.route('/positions', methods=['GET'])
def get_positions():
    login = int(request.headers.get('X-MT5-LOGIN', 0))
    server = request.headers.get('X-MT5-SERVER', '')
    password = request.headers.get('Authorization', '').replace('Bearer ', '')
    
    if not mt5.initialize(login=login, server=server, password=password):
        return jsonify({"error": f"Initialization failed: {mt5.last_error()}"}), 401
        
    positions = mt5.positions_get()
    formatted = []
    if positions:
        for p in positions:
            formatted.append({
                "ticket": p.ticket,
                "symbol": p.symbol,
                "volume": p.volume,
                "type": "buy" if p.type == mt5.POSITION_TYPE_BUY else "sell",
                "openPrice": p.price_open,
                "currentPrice": p.price_current,
                "profit": p.profit
            })
    return jsonify(formatted)

@app.route('/ticker', methods=['GET'])
def get_ticker():
    symbol = request.args.get('symbol', 'XAUUSD')
    tick = mt5.symbol_info_tick(symbol)
    if not tick:
        return jsonify({"lastPrice": 2375.50, "bid": 2375.50, "ask": 2375.50})
    return jsonify({
        "lastPrice": tick.last,
        "bid": tick.bid,
        "ask": tick.ask
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)`}
                              </pre>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 bg-neutral-900/50 p-3.5 border border-neutral-800/50">
                            <span className="font-bold text-white text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                              <span className="w-4 h-4 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full flex items-center justify-center text-[9px] font-mono">3</span>
                              Connection Details:
                            </span>
                            <ul className="list-disc list-inside space-y-1 text-neutral-400 pl-2">
                              <li><strong>MT5 REST Bridge Host:</strong> <code className="text-white bg-neutral-950 px-1 py-0.5 border border-neutral-800 font-mono text-[10px]">http://localhost:5000</code> (if running locally) or your VPS IP.</li>
                              <li><strong>MT5 Server Name:</strong> Use the exact server from FundedNext, e.g. <code className="text-white font-mono bg-neutral-950 px-1 py-0.5 border border-neutral-800">FundedNext-Server3</code></li>
                              <li><strong>MT5 Account Login / ID:</strong> Your login number.</li>
                              <li><strong>MT5 Password / Master Token:</strong> Your investor or master trading password.</li>
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* RISK & ORDER SAFETY DEFAULTS */}
              <div>
                <h3 className="text-base font-black text-amber-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Sliders className="w-4 h-4" /> Risk & Safety Parameters
                </h3>
                <p className="text-xs text-neutral-400 mb-4 leading-relaxed">
                  Default values are applied when webhook alert payloads do not explicitly pass quantity, leverage, or protective trigger stops.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-neutral-900 border border-neutral-800 p-6">
                  <div>
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">DEFAULT COIN/SYMBOL</label>
                    <input
                      type="text"
                      value={settings.defaultSymbol}
                      onChange={(e) => setSettings({ ...settings, defaultSymbol: e.target.value.toUpperCase() })}
                      className="w-full bg-neutral-950 border border-neutral-800 text-sm px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">DEFAULT LEVERAGE (X)</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={settings.defaultLeverage}
                      onChange={(e) => setSettings({ ...settings, defaultLeverage: parseInt(e.target.value) || 1 })}
                      className="w-full bg-neutral-950 border border-neutral-800 text-sm px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">DEFAULT ORDER QUANTITY (LOTS)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={settings.defaultOrderSize}
                      onChange={(e) => setSettings({ ...settings, defaultOrderSize: parseFloat(e.target.value) || 0.1 })}
                      className="w-full bg-neutral-950 border border-neutral-800 text-sm px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">PROTECTIVE STOP LOSS (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={settings.stopLossPercent}
                      onChange={(e) => setSettings({ ...settings, stopLossPercent: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-neutral-950 border border-neutral-800 text-sm px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">TAKE PROFIT (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={settings.takeProfitPercent}
                      onChange={(e) => setSettings({ ...settings, takeProfitPercent: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-neutral-950 border border-neutral-800 text-sm px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">WEBHOOK PASSPHRASE</label>
                    <input
                      type="text"
                      value={settings.webhookPassphrase}
                      onChange={(e) => setSettings({ ...settings, webhookPassphrase: e.target.value })}
                      className="w-full bg-neutral-950 border border-neutral-800 text-sm px-3 py-2.5 font-mono text-amber-500 focus:outline-none focus:border-amber-500 font-bold"
                    />
                  </div>
                </div>
              </div>

              {/* QUANT STRATEGY REGIME ROUTER & HYBRID PROTECTION */}
              <div>
                <h3 className="text-base font-black text-amber-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Cpu className="w-4 h-4" /> Regime Router & Protection Layers
                </h3>
                <p className="text-xs text-neutral-400 mb-4 leading-relaxed">
                  Toggle hybrid exchange-side safety stops, define active market regime modules, and control multi-session filters.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-neutral-900 border border-neutral-800 p-6 mb-6">
                  {/* Hybrid exchange-side stops */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="hybrid-stops-chk"
                        checked={settings.isHybridStopsActive}
                        onChange={(e) => setSettings({ ...settings, isHybridStopsActive: e.target.checked })}
                        className="w-4 h-4 text-amber-500 focus:ring-0 focus:ring-offset-0 accent-amber-500 bg-neutral-950 border-neutral-800"
                      />
                      <div>
                        <label htmlFor="hybrid-stops-chk" className="text-xs font-bold text-white uppercase block cursor-pointer">
                          Activate Hybrid Server-Side Stops
                        </label>
                        <span className="text-[10px] text-neutral-500">
                          Automatically submits hard catastrophic STOP LOSS & TAKE PROFIT orders directly to Bybit exchanges when opening positions.
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Active Regime Strategy Mode */}
                  <div>
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">
                      Active Strategy Module Selection
                    </label>
                    <select
                      value={settings.activeRegimeModule}
                      onChange={(e: any) => setSettings({ ...settings, activeRegimeModule: e.target.value })}
                      className="w-full bg-neutral-950 border border-neutral-800 text-sm px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                    >
                      <option value="auto">Auto-Regime Router (ADX Classified)</option>
                      <option value="trend">Trend Module Only (High ADX Momentum)</option>
                      <option value="range">Range Module Only (Low ADX Chop)</option>
                    </select>
                    <span className="text-[10px] text-neutral-500 mt-1 block">
                      Auto mode routes signals to the optimal module using ADX strength (Trend when ADX &gt; 22, Range when ADX &le; 22).
                    </span>
                  </div>

                  {/* Centralized Portfolio Veto Power */}
                  <div className="flex flex-col gap-2 border-t border-neutral-800 md:border-t-0 pt-4 md:pt-0">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="central-veto-chk"
                        checked={settings.isCentralRiskVetoActive}
                        onChange={(e) => setSettings({ ...settings, isCentralRiskVetoActive: e.target.checked })}
                        className="w-4 h-4 text-amber-500 focus:ring-0 focus:ring-offset-0 accent-amber-500 bg-neutral-950 border-neutral-800"
                      />
                      <div>
                        <label htmlFor="central-veto-chk" className="text-xs font-bold text-white uppercase block cursor-pointer">
                          Enable Central Risk Veto Manager
                        </label>
                        <span className="text-[10px] text-neutral-500">
                          Applies the 3% combined risk downscale rule and blocks entries under heavy loss streaks or unallowed hours.
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Max Portfolio Risk Percent */}
                  <div className="border-t border-neutral-800 md:border-t-0 pt-4 md:pt-0">
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">
                      Max Portfolio Risk per Entry (% of Capital)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="10.0"
                      value={settings.maxPortfolioRiskPercent}
                      onChange={(e) => setSettings({ ...settings, maxPortfolioRiskPercent: parseFloat(e.target.value) || 3 })}
                      className="w-full bg-neutral-950 border border-neutral-800 text-sm px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-[10px] text-neutral-500 mt-1 block">
                      Downscales position lots automatically if proposed order size risk exceeds this percentage.
                    </span>
                  </div>

                  {/* Session Filters (Active Hours) */}
                  <div className="md:col-span-2 border-t border-neutral-800 pt-4">
                    <div className="flex items-center gap-3 mb-3">
                      <input
                        type="checkbox"
                        id="session-filter-chk"
                        checked={settings.isSessionFilterActive}
                        onChange={(e) => setSettings({ ...settings, isSessionFilterActive: e.target.checked })}
                        className="w-4 h-4 text-amber-500 focus:ring-0 focus:ring-offset-0 accent-amber-500 bg-neutral-950 border-neutral-800"
                      />
                      <div>
                        <label htmlFor="session-filter-chk" className="text-xs font-bold text-white uppercase block cursor-pointer">
                          Enable Trading Session Restrictions
                        </label>
                        <span className="text-[10px] text-neutral-500">
                          Restrict execution of new positions to allowed global market sessions.
                        </span>
                      </div>
                    </div>

                    {settings.isSessionFilterActive && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-neutral-950 p-4 border border-neutral-800">
                        {['asian', 'london', 'new_york'].map((sess) => {
                          const label = sess === 'asian' ? 'Asian / Tokyo (00:00 - 08:00 UTC)' : sess === 'london' ? 'London / European (08:00 - 16:00 UTC)' : 'New York / US (16:00 - 24:00 UTC)';
                          const isChecked = settings.allowedSessions.includes(sess);
                          return (
                            <label key={sess} className="flex items-center gap-2 text-xs text-neutral-300 font-mono select-none cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  const nextSessions = e.target.checked
                                    ? [...settings.allowedSessions, sess]
                                    : settings.allowedSessions.filter(s => s !== sess);
                                  setSettings({ ...settings, allowedSessions: nextSessions });
                                }}
                                className="w-3.5 h-3.5 text-amber-500 focus:ring-0 accent-amber-500 bg-neutral-900 border-neutral-800"
                              />
                              {label}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* SECTION: PROPRIETARY ALPHA PROFIT-OPTIMIZATION SUITE */}
              <div className="border border-neutral-800/80 p-6 flex flex-col gap-4">
                <h3 className="text-sm font-black text-amber-500 uppercase tracking-[0.1em] flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" /> Proprietary Alpha Profit-Optimization Suite
                </h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Advanced risk management and performance-scaling engines. Enable dynamic stop adjustments, auto-compounding, drawdown mitigations, and spreads clearing filters to elevate long-term edge expectancy.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-neutral-900 border border-neutral-800 p-6">
                  {/* Dynamic SL (ATR) */}
                  <div className="border border-neutral-800/50 p-4 bg-neutral-950/40">
                    <div className="flex items-center gap-3 mb-3">
                      <input
                        type="checkbox"
                        id="dynamic-sl-chk"
                        checked={settings.isDynamicSlActive}
                        onChange={(e) => setSettings({ ...settings, isDynamicSlActive: e.target.checked })}
                        className="w-4 h-4 text-amber-500 focus:ring-0 focus:ring-offset-0 accent-amber-500 bg-neutral-950 border-neutral-800"
                      />
                      <div>
                        <label htmlFor="dynamic-sl-chk" className="text-xs font-bold text-white uppercase block cursor-pointer">
                          ATR-Based Dynamic Volatility Stops
                        </label>
                        <span className="text-[10px] text-neutral-500 block">
                          Calculate Stop Loss dynamically based on recent market volatility (ATR) instead of fixed percentages.
                        </span>
                      </div>
                    </div>
                    {settings.isDynamicSlActive && (
                      <div className="mt-3 pl-7">
                        <label className="text-[9px] font-black text-neutral-400 uppercase tracking-widest block mb-1">ATR MULTIPLIER</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0.5"
                          max="5.0"
                          value={settings.atrMultiplier}
                          onChange={(e) => setSettings({ ...settings, atrMultiplier: parseFloat(e.target.value) || 1.5 })}
                          className="w-full max-w-[200px] bg-neutral-950 border border-neutral-800 text-xs px-2.5 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                        />
                        <span className="text-[9px] text-neutral-500 mt-1 block">
                          Multiplier of the Average True Range (ATR) to set the dynamic stop distance.
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Trailing Stop */}
                  <div className="border border-neutral-800/50 p-4 bg-neutral-950/40">
                    <div className="flex items-center gap-3 mb-3">
                      <input
                        type="checkbox"
                        id="trailing-stop-chk"
                        checked={settings.isTrailingStopActive}
                        onChange={(e) => setSettings({ ...settings, isTrailingStopActive: e.target.checked })}
                        className="w-4 h-4 text-amber-500 focus:ring-0 focus:ring-offset-0 accent-amber-500 bg-neutral-950 border-neutral-800"
                      />
                      <div>
                        <label htmlFor="trailing-stop-chk" className="text-xs font-bold text-white uppercase block cursor-pointer">
                          Dynamic Trailing Stop / Breakeven Manager
                        </label>
                        <span className="text-[10px] text-neutral-500 block">
                          Automatically moves Stop Loss to breakeven or trails the price once a specified profit R-multiple is hit.
                        </span>
                      </div>
                    </div>
                    {settings.isTrailingStopActive && (
                      <div className="mt-3 pl-7">
                        <label className="text-[9px] font-black text-neutral-400 uppercase tracking-widest block mb-1">BREAKEVEN R-MULTIPLE TRIGGER</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0.5"
                          max="3.0"
                          value={settings.breakevenMultiplier}
                          onChange={(e) => setSettings({ ...settings, breakevenMultiplier: parseFloat(e.target.value) || 1.2 })}
                          className="w-full max-w-[200px] bg-neutral-950 border border-neutral-800 text-xs px-2.5 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                        />
                        <span className="text-[9px] text-neutral-500 mt-1 block">
                          R-Multiple of stop-loss distance in profit required to move stop-loss to entry price.
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Compounding & Streak Management */}
                  <div className="border border-neutral-800/50 p-4 bg-neutral-950/40 md:col-span-2">
                    <div className="flex items-center gap-3 mb-4">
                      <input
                        type="checkbox"
                        id="compounding-streak-chk"
                        checked={settings.isCompoundingActive}
                        onChange={(e) => setSettings({ ...settings, isCompoundingActive: e.target.checked })}
                        className="w-4 h-4 text-amber-500 focus:ring-0 focus:ring-offset-0 accent-amber-500 bg-neutral-950 border-neutral-800"
                      />
                      <div>
                        <label htmlFor="compounding-streak-chk" className="text-xs font-bold text-white uppercase block cursor-pointer">
                          Streak-Adjusted Dynamic Position Sizing (Compounding & Downscaling)
                        </label>
                        <span className="text-[10px] text-neutral-500 block">
                          Compounds winning streaks by scaling up lot size, and mitigates drawdowns by shrinking size on losing streaks.
                        </span>
                      </div>
                    </div>
                    {settings.isCompoundingActive && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-7 border-t border-neutral-800/50 pt-3">
                        <div>
                          <label className="text-[9px] font-black text-neutral-400 uppercase tracking-widest block mb-1">CONSECUTIVE WIN MULTIPLIER (COMPOUND)</label>
                          <input
                            type="number"
                            step="0.05"
                            min="1.0"
                            max="2.0"
                            value={settings.consecutiveWinMultiplier}
                            onChange={(e) => setSettings({ ...settings, consecutiveWinMultiplier: parseFloat(e.target.value) || 1.25 })}
                            className="w-full max-w-[200px] bg-neutral-950 border border-neutral-800 text-xs px-2.5 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                          />
                          <span className="text-[9px] text-neutral-500 mt-1 block">
                            Size multiplier compounding on each continuous win. Set to 1.25 for +25% compounding per streak trade.
                          </span>
                        </div>
                        <div>
                          <label className="text-[9px] font-black text-neutral-400 uppercase tracking-widest block mb-1">CONSECUTIVE LOSS DOWNSCALE (COOL DOWN)</label>
                          <input
                            type="number"
                            step="0.05"
                            min="0.5"
                            max="1.0"
                            value={settings.consecutiveLossDownscale}
                            onChange={(e) => setSettings({ ...settings, consecutiveLossDownscale: parseFloat(e.target.value) || 0.85 })}
                            className="w-full max-w-[200px] bg-neutral-950 border border-neutral-800 text-xs px-2.5 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                          />
                          <span className="text-[9px] text-neutral-500 mt-1 block">
                            Size downscaling factor applied on each continuous loss. Set to 0.85 to shrink sizing by 15% during drawdowns.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* NY Rollover & Spread Protection */}
                  <div className="border border-neutral-800/50 p-4 bg-neutral-950/40 md:col-span-2">
                    <div className="flex items-center gap-3 mb-4">
                      <input
                        type="checkbox"
                        id="rollover-spread-chk"
                        checked={settings.isRolloverFilterActive}
                        onChange={(e) => setSettings({ ...settings, isRolloverFilterActive: e.target.checked })}
                        className="w-4 h-4 text-amber-500 focus:ring-0 focus:ring-offset-0 accent-amber-500 bg-neutral-950 border-neutral-800"
                      />
                      <div>
                        <label htmlFor="rollover-spread-chk" className="text-xs font-bold text-white uppercase block cursor-pointer">
                          Slippage Defending: NY Rollover & Spread Guard
                        </label>
                        <span className="text-[10px] text-neutral-500 block">
                          Prevents toxic executions during spreads spikes at broker settlement clearing (21:00 - 23:00 UTC) and vets real-time spreads.
                        </span>
                      </div>
                    </div>
                    {settings.isRolloverFilterActive && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-7 border-t border-neutral-800/50 pt-3">
                        <div>
                          <label className="text-[9px] font-black text-neutral-400 uppercase tracking-widest block mb-1">MAX PERMITTED BID-ASK SPREAD ($ USD)</label>
                          <input
                            type="number"
                            step="0.05"
                            min="0.10"
                            max="5.0"
                            value={settings.maxSpreadUsd}
                            onChange={(e) => setSettings({ ...settings, maxSpreadUsd: parseFloat(e.target.value) || 0.75 })}
                            className="w-full max-w-[200px] bg-neutral-950 border border-neutral-800 text-xs px-2.5 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                          />
                          <span className="text-[9px] text-neutral-500 mt-1 block">
                            Maximum orderbook spread allowed for gold. Orders are vetoed during spread spikes to block slippage losses.
                          </span>
                        </div>
                        <div className="flex items-center text-[10px] text-neutral-400 leading-relaxed font-mono bg-neutral-950 p-3 border border-neutral-800/60 self-center">
                          <AlertTriangle className="w-4 h-4 text-amber-500 mr-2 flex-shrink-0" />
                          <span>
                            Settlement clearing window (21:00-23:00 UTC) is fully restricted. New executions will be automatically gated to prevent extreme spreads.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* SECTION: PROP-GUARD RISK CAPS & EMERGENCY SWITCH */}
              <div className="border border-neutral-800/80 p-6 flex flex-col gap-4">
                <h3 className="text-sm font-black text-neutral-300 uppercase tracking-[0.1em] flex items-center gap-2">
                  <Shield className="w-4 h-4 text-red-500 animate-pulse" /> Prop-Guard Algorithmic Risk Module
                </h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Advanced capital protection layer acting as an automated risk control system. If any constraint is breached, order execution is instantly halted on the server-side to prevent drawdown loops.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-neutral-900 border border-neutral-800 p-6">
                  <div>
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">MAX POSITION SIZE (LOTS)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={settings.maxPositionSize}
                      onChange={(e) => setSettings({ ...settings, maxPositionSize: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-neutral-950 border border-neutral-800 text-sm px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-[10px] text-neutral-500 mt-1 block">Prevents scaling or adding beyond safe sizes.</span>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">MAX DAILY LOSS CAP ($)</label>
                    <input
                      type="number"
                      value={settings.maxDailyLoss}
                      onChange={(e) => setSettings({ ...settings, maxDailyLoss: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-neutral-950 border border-neutral-800 text-sm px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-[10px] text-neutral-500 mt-1 block">Maximum total negative closed PnL allowed per day.</span>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">MAX CONSECUTIVE LOSSES</label>
                    <input
                      type="number"
                      value={settings.maxConsecutiveLosses}
                      onChange={(e) => setSettings({ ...settings, maxConsecutiveLosses: parseInt(e.target.value) || 0 })}
                      className="w-full bg-neutral-950 border border-neutral-800 text-sm px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-[10px] text-neutral-500 mt-1 block">Number of continuous losses before execution halt.</span>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">CLIENT ORDER ID PREFIX</label>
                    <input
                      type="text"
                      value={settings.clientOrderIdPrefix}
                      onChange={(e) => setSettings({ ...settings, clientOrderIdPrefix: e.target.value })}
                      className="w-full bg-neutral-950 border border-neutral-800 text-sm px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-[10px] text-neutral-500 mt-1 block">Idempotent client ID prefix (`orderLinkId`) to avoid duplicates.</span>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-2">SECURITY IP WHITELIST</label>
                    <input
                      type="text"
                      readOnly
                      value={settings.ipWhitelist}
                      className="w-full bg-neutral-950/60 border border-neutral-800/80 text-sm px-3 py-2.5 font-mono text-neutral-500 cursor-not-allowed focus:outline-none"
                    />
                    <span className="text-[10px] text-neutral-500 mt-1 block">Recommended: Restrict Bybit API keys to this server's static IP.</span>
                  </div>

                  <div className="flex flex-col justify-center">
                    <span className="text-[10px] font-black text-red-500 uppercase tracking-widest block mb-2">EMERGENCY KILL SWITCH</span>
                    <button
                      type="button"
                      onClick={() => setSettings({ ...settings, isKillSwitchActive: !settings.isKillSwitchActive })}
                      className={`w-full py-2.5 text-xs font-black uppercase tracking-wider transition-colors border ${
                        settings.isKillSwitchActive
                          ? 'bg-red-500 border-red-400 text-white'
                          : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-800 hover:text-white'
                      }`}
                    >
                      {settings.isKillSwitchActive ? '⚠️ KILL SWITCH ACTIVE' : 'ACTIVATE KILL SWITCH'}
                    </button>
                    <span className="text-[10px] text-neutral-500 mt-1 block text-center">
                      {settings.isKillSwitchActive ? 'Blocks all position entries!' : 'Instantly halts entry webhook orders.'}
                    </span>
                  </div>
                </div>

                {/* INTRADAY EQUITY CIRCUIT BREAKER */}
                <div className="mt-6 pt-6 border-t border-neutral-800">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest block mb-1">Intraday Equity Circuit Breaker</span>
                      <span className="text-[10px] text-neutral-500 block max-w-md leading-relaxed">
                        Auto-flattens all positions and trips the kill switch when equity drops past the limit
                        from the day's start. Covers open-position losses the entry-only daily-loss veto misses.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSettings({ ...settings, isCircuitBreakerActive: !settings.isCircuitBreakerActive })}
                      className={'px-4 py-2 text-[10px] font-black uppercase tracking-wider border cursor-pointer transition-all ' +
                        (settings.isCircuitBreakerActive ? 'bg-amber-500 border-amber-400 text-neutral-950' : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:bg-neutral-800')}
                    >
                      {settings.isCircuitBreakerActive ? 'ARMED' : 'DISABLED'}
                    </button>
                  </div>
                  <div className="flex items-center gap-3 mt-3">
                    <span className="text-[10px] font-black uppercase tracking-wider text-neutral-400">Max drawdown</span>
                    <input
                      type="number"
                      step="0.5"
                      min="1"
                      value={settings.maxDrawdownPercent}
                      onChange={(e: any) => setSettings({ ...settings, maxDrawdownPercent: Number(e.target.value) })}
                      className="w-20 bg-neutral-900 border border-neutral-700 text-neutral-200 text-[11px] font-mono px-2 py-1.5 outline-none"
                    />
                    <span className="text-[10px] font-mono text-neutral-500">% from day-start equity → flatten &amp; halt</span>
                  </div>
                </div>
              </div>

              {/* MT5 SIGNAL AUTOMATION MODE */}
              <div className="border border-neutral-800 bg-neutral-950/60 p-5">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-black uppercase tracking-widest text-white">MT5 Signal Automation</span>
                </div>
                <p className="text-[11px] text-neutral-500 mb-4 leading-relaxed">
                  The server evaluates a gold signal at each 15-minute candle close and acts per this mode —
                  replacing the manual TradingView webhook. Applies when the active venue is MT5.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {([
                    { val: 'off', label: 'Off', desc: 'No server signals. TradingView webhook only.', accent: 'neutral' },
                    { val: 'approve', label: 'Approve to fire', desc: 'Signals appear on the dashboard; you click Fire.', accent: 'sky' },
                    { val: 'auto', label: 'Autonomous', desc: 'Fires straight to the bridge. Hands-off.', accent: 'red' },
                  ] as const).map(opt => {
                    const active = (settings.mt5AutoMode || 'off') === opt.val;
                    const ring = opt.accent === 'red' ? 'border-red-500 bg-red-500/10' : opt.accent === 'sky' ? 'border-sky-500 bg-sky-500/10' : 'border-neutral-300 bg-neutral-100/5';
                    return (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() => setSettings({ ...settings, mt5AutoMode: opt.val })}
                        className={'text-left p-3 border transition-all cursor-pointer ' +
                          (active ? ring : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700')}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className={'w-2 h-2 rounded-full ' + (active ? (opt.accent === 'red' ? 'bg-red-500' : opt.accent === 'sky' ? 'bg-sky-400' : 'bg-neutral-200') : 'bg-neutral-700')}></span>
                          <span className="text-[11px] font-black uppercase tracking-wider text-white">{opt.label}</span>
                        </div>
                        <span className="text-[10px] text-neutral-500 leading-snug block">{opt.desc}</span>
                      </button>
                    );
                  })}
                </div>
                {settings.mt5AutoMode !== 'off' && (
                  <div className="mt-4 pt-4 border-t border-neutral-800 flex items-center gap-3 flex-wrap">
                    <span className="text-[10px] font-black uppercase tracking-wider text-neutral-400">Evaluation timeframe</span>
                    <div className="inline-flex border border-neutral-700">
                      {[1, 3, 5, 15, 30].map(m => {
                        const active = (settings.signalCandleMinutes || 5) === m;
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setSettings({ ...settings, signalCandleMinutes: m })}
                            className={'px-3 py-1.5 text-[10px] font-black uppercase border-none cursor-pointer transition-all ' +
                              (active ? 'bg-neutral-100 text-neutral-950' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800')}
                          >
                            {m}m
                          </button>
                        );
                      })}
                    </div>
                    <span className="text-[9px] font-mono text-neutral-600">Signal evaluated once per {settings.signalCandleMinutes || 5}-minute candle close.</span>
                  </div>
                )}
                {settings.mt5AutoMode === 'auto' && (
                  <p className="text-[10px] text-red-400 mt-3 font-mono">
                    ⚠ Autonomous mode opens trades with no confirmation. On a funded account, a bad run can breach
                    the daily-loss rule. The kill switch and risk gates still apply.
                  </p>
                )}
              </div>

              {/* CONTROL ACTIONS FOR FORM */}
              <div className="flex items-center gap-4">
                <button
                  type="submit"
                  disabled={saveStatus === 'saving'}
                  className="bg-amber-500 text-neutral-950 hover:bg-amber-400 text-xs font-black uppercase tracking-widest px-8 py-3.5 rounded-none transition-all cursor-pointer flex items-center gap-2"
                >
                  {saveStatus === 'saving' ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> Saving Settings...
                    </>
                  ) : (
                    'SAVE TERMINAL SETUP'
                  )}
                </button>

                {saveStatus === 'saved' && (
                  <span className="text-xs font-mono text-green-400 flex items-center gap-1 animate-pulse">
                    <Check className="w-4 h-4" /> All changes successfully written to database.
                  </span>
                )}

                {saveStatus === 'error' && (
                  <span className="text-xs font-mono text-red-400 flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" /> Failed to save settings to disk. Check permissions.
                  </span>
                )}
              </div>
            </form>
          </section>
        )}

        {/* TAB 4: CLOSED TRADES HISTORY TABLE */}
        {activeTab === 'trades' && (
          <section className="col-span-12 bg-neutral-950 p-6 lg:p-8 flex flex-col gap-6 w-full">
            <div>
              <h2 className="text-xl font-black italic tracking-tighter text-amber-500 mb-2 uppercase">Closed Trade Execution History</h2>
              <p className="text-sm text-neutral-400 leading-relaxed max-w-3xl font-sans">
                A granular audit trail of all liquidated positions with precise tracking of entry/exit executions, trade duration, and final realized profit and loss (PnL).
              </p>
            </div>

            {/* P&L CALENDAR */}
            {(() => {
              const cal = buildPnLCalendar(calMonth, closedTrades);
              const monthLabel = calMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
              const cells: (number | null)[] = [
                ...Array(cal.firstWeekday).fill(null),
                ...Array.from({ length: cal.daysInMonth }, (_, i) => i + 1),
              ];
              const shift = (delta: number) => setCalMonth(new Date(cal.year, cal.mon + delta, 1));
              return (
                <div className="border border-neutral-800 bg-neutral-900/40 p-5">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-black uppercase tracking-widest text-neutral-300">P&amp;L Calendar</span>
                      <span className={'text-xs font-black font-mono ' + (cal.monthPnl > 0 ? 'text-green-400' : cal.monthPnl < 0 ? 'text-red-400' : 'text-neutral-500')}>
                        {cal.monthPnl >= 0 ? '+' : ''}${cal.monthPnl.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => shift(-1)} className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] font-black border-none cursor-pointer">‹</button>
                      <span className="text-[11px] font-mono text-neutral-400 min-w-[120px] text-center">{monthLabel}</span>
                      <button type="button" onClick={() => shift(1)} className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] font-black border-none cursor-pointer">›</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                      <div key={'h' + i} className="text-[9px] font-black text-neutral-600 uppercase text-center pb-1">{d}</div>
                    ))}
                    {cells.map((day, i) => {
                      if (day === null) return <div key={'e' + i}></div>;
                      const entry = cal.byDay[day];
                      const pnl = entry?.pnl ?? 0;
                      const bg = !entry ? 'bg-neutral-900/40 border-neutral-800' :
                        pnl > 0 ? 'bg-green-500/15 border-green-500/30' :
                        pnl < 0 ? 'bg-red-500/15 border-red-500/30' : 'bg-neutral-800 border-neutral-700';
                      return (
                        <div key={'d' + i} className={'border p-1.5 min-h-[52px] flex flex-col justify-between ' + bg} title={entry ? `${entry.count} trade(s)` : 'No trades'}>
                          <span className="text-[9px] font-mono text-neutral-500">{day}</span>
                          {entry && (
                            <span className={'text-[10px] font-black font-mono leading-none ' + (pnl > 0 ? 'text-green-400' : pnl < 0 ? 'text-red-400' : 'text-neutral-400')}>
                              {pnl >= 0 ? '+' : ''}{pnl.toFixed(0)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-4 mt-3 text-[9px] font-mono text-neutral-600">
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-green-500/40 inline-block"></span> profit day</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-red-500/40 inline-block"></span> loss day</span>
                    <span>values are realized USD P&amp;L per day</span>
                  </div>
                </div>
              );
            })()}

            {/* AI TRADE REVIEW */}
            <div className="border border-neutral-800 bg-neutral-900/40 p-5">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-black uppercase tracking-widest text-white">AI Trade Review</span>
                </div>
                <button
                  type="button"
                  onClick={handleGenerateReview}
                  disabled={reviewLoading || closedTrades.length === 0}
                  className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-neutral-950 font-black text-[10px] uppercase tracking-widest px-4 py-2 border-none cursor-pointer flex items-center gap-2"
                >
                  {reviewLoading ? (<><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Analysing…</>) : 'Generate review'}
                </button>
              </div>
              {closedTrades.length === 0 ? (
                <p className="text-[11px] font-mono text-neutral-500">Review becomes available once trades have closed.</p>
              ) : !review ? (
                <p className="text-[11px] font-mono text-neutral-500">Analyses your real closed trades — what's working, what's losing, and concrete changes to try.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {review.stats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] font-mono">
                      <div className="bg-neutral-900 border border-neutral-800 p-2"><span className="text-[9px] text-neutral-500 uppercase block">Win rate</span><span className="text-neutral-200 font-bold">{review.stats.winRate.toFixed(0)}%</span></div>
                      <div className="bg-neutral-900 border border-neutral-800 p-2"><span className="text-[9px] text-neutral-500 uppercase block">Profit factor</span><span className="text-neutral-200 font-bold">{review.stats.profitFactor.toFixed(2)}</span></div>
                      <div className="bg-neutral-900 border border-neutral-800 p-2"><span className="text-[9px] text-neutral-500 uppercase block">Net P&amp;L</span><span className={(review.stats.netPnl >= 0 ? 'text-green-400' : 'text-red-400') + ' font-bold'}>${review.stats.netPnl.toFixed(2)}</span></div>
                      <div className="bg-neutral-900 border border-neutral-800 p-2"><span className="text-[9px] text-neutral-500 uppercase block">Long / Short win</span><span className="text-neutral-200 font-bold">{review.stats.buy.winRate.toFixed(0)}% / {review.stats.sell.winRate.toFixed(0)}%</span></div>
                    </div>
                  )}
                  <div className="bg-neutral-950 border border-neutral-800 p-3 text-[12px] text-neutral-300 leading-relaxed whitespace-pre-wrap font-sans">
                    {review.report}
                  </div>
                </div>
              )}
            </div>

            {closedTrades.length === 0 ? (
              <div className="border border-dashed border-neutral-800 p-16 text-center text-neutral-600 bg-neutral-900/10">
                <ArrowRightLeft className="w-12 h-12 text-neutral-700 mx-auto mb-3" />
                <p className="text-base font-bold uppercase tracking-wider text-neutral-500">No closed trades recorded yet</p>
                <p className="text-xs text-neutral-600 mt-1">Open positions and trigger a market close or stop loss/take profit webhook to log history.</p>
              </div>
            ) : (
              <div className="border border-neutral-800 bg-neutral-900 overflow-hidden rounded-none">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead>
                      <tr className="bg-neutral-950 text-neutral-400 uppercase tracking-wider border-b border-neutral-800 text-[10px] font-bold">
                        <th className="p-4">Symbol / Type</th>
                        <th className="p-4">Entry / Exit Price</th>
                        <th className="p-4">Quantity / Leverage</th>
                        <th className="p-4">Duration</th>
                        <th className="p-4">Execution Time</th>
                        <th className="p-4 text-right">Realized PnL</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/60">
                      {closedTrades.map((trade) => {
                        const isProfit = trade.pnl >= 0;
                        const durationSecs = Math.floor(trade.durationMs / 1000);
                        const durationMins = Math.floor(durationSecs / 60);
                        const durationHours = Math.floor(durationMins / 60);
                        
                        let durationStr = `${durationSecs}s`;
                        if (durationHours > 0) {
                          durationStr = `${durationHours}h ${durationMins % 60}m`;
                        } else if (durationMins > 0) {
                          durationStr = `${durationMins}m ${durationSecs % 60}s`;
                        }

                        return (
                          <tr key={trade.id} className="hover:bg-neutral-900/40 transition-colors">
                            <td className="p-4">
                              <div className="flex items-center gap-2">
                                <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded ${
                                  trade.side === 'buy' 
                                    ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                                }`}>
                                  {trade.side === 'buy' ? 'LONG' : 'SHORT'}
                                </span>
                                <span className="text-neutral-200 font-bold">{trade.symbol}</span>
                              </div>
                            </td>
                            <td className="p-4 text-neutral-300">
                              <div>Entry: <span className="text-white">${trade.entryPrice.toFixed(2)}</span></div>
                              <div className="text-neutral-500 text-[10px] mt-0.5">Exit: <span className="text-neutral-400">${trade.exitPrice.toFixed(2)}</span></div>
                            </td>
                            <td className="p-4 text-neutral-300">
                              <div>Qty: <span className="text-white font-bold">{trade.quantity}</span></div>
                              <div className="text-neutral-500 text-[10px] mt-0.5">Leverage: <span className="text-neutral-400">{trade.leverage}x</span></div>
                            </td>
                            <td className="p-4 text-neutral-300 font-bold">
                              {durationStr}
                            </td>
                            <td className="p-4 text-neutral-400 text-[10px]">
                              <div>In: {new Date(trade.entryTime).toLocaleTimeString()}</div>
                              <div className="text-neutral-500 mt-0.5">Out: {new Date(trade.exitTime).toLocaleTimeString()}</div>
                            </td>
                            <td className={`p-4 text-right text-sm font-black ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                              {isProfit ? '+' : ''}${trade.pnl.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}

        {/* TAB 5: BACKTEST SIMULATOR SANDBOX */}
        {activeTab === 'sandbox' && (
          <section className="col-span-12 bg-neutral-950 p-6 lg:p-8 flex flex-col gap-6 w-full">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-neutral-900 pb-6">
              <div>
                <h2 className="text-xl font-black italic tracking-tighter text-amber-500 mb-2 uppercase flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-amber-500" /> Walk-Forward Strategy Backtest Engine
                </h2>
                <p className="text-sm text-neutral-400 leading-relaxed max-w-3xl font-sans">
                  Ported from TrendForge's logic. Runs real historical simulations on Gold (<span className="text-white font-mono">XAUUSDT</span> 15m), strictly modeling taker fees (<span className="text-amber-500 font-bold">0.055%</span>), bid-ask slippage, and dynamic ATR-based protective stops.
                </p>
              </div>
              <div className="bg-neutral-900 border border-neutral-800 p-3 text-xs font-mono text-neutral-400 flex flex-col gap-1">
                <span className="text-emerald-500 font-bold">PHASE 1: BACKTEST FIRST (LOCAL)</span>
                <span>Ensure strategy expectancy is positive after commissions before paper/demo.</span>
              </div>
            </div>

            {/* PARAMETER OPTIMIZER */}
            <div className="border border-neutral-800 bg-neutral-900/40 p-5 mb-2">
              <div className="flex items-center gap-2 mb-1">
                <Sliders className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-black uppercase tracking-widest text-white">Parameter Optimizer</span>
              </div>
              <p className="text-[11px] text-neutral-500 mb-4 leading-relaxed max-w-3xl">
                Sweeps ranges of the selected parameters through the real-data backtester and ranks every combination.
                This finds settings that actually performed on history — the basis for adjusting the strategy to the market instead of guessing.
              </p>

              <div className="flex flex-wrap gap-2 mb-3">
                {Object.entries(OPTIMIZER_RANGES).map(([key, cfg]) => {
                  const on = optSweeps.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setOptSweeps(on ? optSweeps.filter(k => k !== key) : [...optSweeps, key])}
                      className={'px-3 py-1.5 text-[10px] font-black uppercase tracking-wider border transition-all cursor-pointer ' +
                        (on ? 'bg-amber-500 text-neutral-950 border-amber-500' : 'bg-neutral-900 text-neutral-400 border-neutral-700 hover:border-neutral-500')}
                      title={cfg.values.join(', ')}
                    >
                      {cfg.label} ({cfg.values.length})
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-3 flex-wrap mb-4">
                <span className="text-[10px] font-black uppercase tracking-wider text-neutral-400">Rank by</span>
                <select
                  value={optRankBy}
                  onChange={(e: any) => setOptRankBy(e.target.value)}
                  className="bg-neutral-900 border border-neutral-700 text-neutral-200 text-[11px] font-mono px-2 py-1.5 outline-none"
                >
                  <option value="expectancyR">Expectancy (R)</option>
                  <option value="expectancy">Expectancy ($)</option>
                  <option value="profitFactor">Profit factor</option>
                  <option value="winRate">Win rate</option>
                  <option value="netPnl">Net P&amp;L</option>
                </select>
                <span className="text-[10px] font-mono text-neutral-600">{optComboCount} combination{optComboCount === 1 ? '' : 's'}{optComboCount > 60 ? ' (capped at 60)' : ''}</span>
                <button
                  type="button"
                  onClick={handleOptimize}
                  disabled={optLoading}
                  className="ml-auto bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-neutral-950 font-black text-[10px] uppercase tracking-widest px-5 py-2 border-none cursor-pointer flex items-center gap-2"
                >
                  {optLoading ? (<><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Running…</>) : 'Run optimizer'}
                </button>
              </div>

              {optResults && (
                optResults.length === 0 ? (
                  <div className="text-[11px] font-mono text-neutral-500 border border-neutral-800 p-3">
                    No configuration produced enough trades to rank{optMeta ? ` (ran ${optMeta.ran})` : ''}. Widen the ranges or the date window.
                  </div>
                ) : (
                  <div className="border border-neutral-800 overflow-x-auto">
                    <table className="w-full text-left text-[11px] font-mono">
                      <thead>
                        <tr className="bg-neutral-900 text-neutral-500 text-[9px] uppercase">
                          <th className="p-2">#</th>
                          {optSweeps.map(k => <th key={k} className="p-2">{OPTIMIZER_RANGES[k].label}</th>)}
                          <th className="p-2 text-right">Trades</th>
                          <th className="p-2 text-right">Win%</th>
                          <th className="p-2 text-right">PF</th>
                          <th className="p-2 text-right">Exp (R)</th>
                          <th className="p-2 text-right">Net $</th>
                          <th className="p-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {optResults.slice(0, 10).map((r, i) => (
                          <tr key={i} className={'border-t border-neutral-800 ' + (i === 0 ? 'bg-amber-500/5' : '')}>
                            <td className="p-2 text-neutral-500">{i + 1}{i === 0 ? ' ★' : ''}</td>
                            {optSweeps.map(k => <td key={k} className="p-2 text-neutral-200">{r.sweptValues[k]}</td>)}
                            <td className="p-2 text-right text-neutral-300">{r.metrics.totalTrades}</td>
                            <td className="p-2 text-right text-neutral-300">{r.metrics.winRate.toFixed(0)}%</td>
                            <td className="p-2 text-right text-neutral-300">{r.metrics.profitFactor.toFixed(2)}</td>
                            <td className={'p-2 text-right font-bold ' + (r.metrics.expectancyR >= 0 ? 'text-green-400' : 'text-red-400')}>{r.metrics.expectancyR.toFixed(3)}</td>
                            <td className={'p-2 text-right font-bold ' + (r.metrics.netPnl >= 0 ? 'text-green-400' : 'text-red-400')}>{r.metrics.netPnl.toFixed(0)}</td>
                            <td className="p-2">
                              <button type="button" onClick={() => applyOptimizedParams(r.sweptValues)} className="bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[9px] font-black uppercase px-2 py-1 border-none cursor-pointer">Apply</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* LEFT COLUMN: PARAMETER CONFIGURATION */}
              <div className="col-span-12 lg:col-span-4 bg-neutral-900 border border-neutral-800 p-6 flex flex-col gap-6">
                <div>
                  <h3 className="text-xs font-black text-neutral-300 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    Strategy Settings
                  </h3>
                  <p className="text-[11px] text-neutral-500 leading-relaxed">
                    Tune the core TrendForge indicators.
                  </p>
                </div>

                <div className="flex flex-col gap-4">
                  <div>
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1.5">WALK-FORWARD SLICE</label>
                    <select
                      value={backtestParams.walkForward}
                      onChange={(e: any) => setBacktestParams({ ...backtestParams, walkForward: e.target.value })}
                      className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                    >
                      <option value="none">No Split (Full 6 Months History)</option>
                      <option value="fit_jan_mar">In-Sample: Parameter Fit (Jan - Mar)</option>
                      <option value="val_apr_jun">Out-of-Sample: Validation (Apr - Jun)</option>
                    </select>
                    <span className="text-[10px] text-neutral-500 mt-1 block leading-relaxed">
                      Always train on In-Sample data, then validate parameters on Out-of-Sample data to prevent overfitting.
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1.5">FAST EMA PERIOD</label>
                      <input
                        type="number"
                        min="2"
                        max="100"
                        value={backtestParams.fastEma}
                        onChange={(e) => setBacktestParams({ ...backtestParams, fastEma: parseInt(e.target.value) || 12 })}
                        className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1.5">SLOW EMA PERIOD</label>
                      <input
                        type="number"
                        min="5"
                        max="200"
                        value={backtestParams.slowEma}
                        onChange={(e) => setBacktestParams({ ...backtestParams, slowEma: parseInt(e.target.value) || 26 })}
                        className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1.5">RSI OVERBOUGHT</label>
                      <input
                        type="number"
                        min="50"
                        max="95"
                        value={backtestParams.rsiOverbought}
                        onChange={(e) => setBacktestParams({ ...backtestParams, rsiOverbought: parseInt(e.target.value) || 70 })}
                        className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1.5">RSI OVERSOLD</label>
                      <input
                        type="number"
                        min="5"
                        max="50"
                        value={backtestParams.rsiOversold}
                        onChange={(e) => setBacktestParams({ ...backtestParams, rsiOversold: parseInt(e.target.value) || 30 })}
                        className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1.5">ATR SL MULTIPLIER</label>
                      <input
                        type="number"
                        step="0.1"
                        value={backtestParams.atrMultiplierSL}
                        onChange={(e) => setBacktestParams({ ...backtestParams, atrMultiplierSL: parseFloat(e.target.value) || 1.5 })}
                        className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1.5">ATR TP MULTIPLIER</label>
                      <input
                        type="number"
                        step="0.1"
                        value={backtestParams.atrMultiplierTP}
                        onChange={(e) => setBacktestParams({ ...backtestParams, atrMultiplierTP: parseFloat(e.target.value) || 3.0 })}
                        className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 border-t border-neutral-800 pt-4">
                    <div>
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1.5">TAKER FEE (%)</label>
                      <input
                        type="number"
                        step="0.001"
                        value={backtestParams.feePercent}
                        onChange={(e) => setBacktestParams({ ...backtestParams, feePercent: parseFloat(e.target.value) || 0.055 })}
                        className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block mb-1.5">SLIPPAGE (TICKS)</label>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={backtestParams.slippageTicks}
                        onChange={(e) => setBacktestParams({ ...backtestParams, slippageTicks: parseInt(e.target.value) || 1 })}
                        className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 font-mono text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  {/* ADVANCED QUANT RISK GUARDS */}
                  <div className="border-t border-neutral-800 pt-4 flex flex-col gap-4">
                    <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest block">Elite Quant Risk Guards</span>
                    
                    {/* REGIME GATE */}
                    <div className="flex flex-col gap-2 bg-neutral-950 p-3 border border-neutral-800">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={backtestParams.isRegimeFilterActive}
                          onChange={(e) => setBacktestParams({ ...backtestParams, isRegimeFilterActive: e.target.checked })}
                          className="w-4 h-4 accent-amber-500 bg-neutral-900 border-neutral-800"
                        />
                        <span className="text-xs font-bold text-white uppercase">Regime Filter (ADX(14) &gt; Gate)</span>
                      </label>
                      {backtestParams.isRegimeFilterActive && (
                        <div className="flex items-center gap-2 pl-6">
                          <span className="text-[10px] text-neutral-400 uppercase">ADX Threshold:</span>
                          <input
                            type="number"
                            min="10"
                            max="40"
                            value={backtestParams.adxThreshold}
                            onChange={(e) => setBacktestParams({ ...backtestParams, adxThreshold: parseInt(e.target.value) || 22 })}
                            className="w-16 bg-neutral-900 border border-neutral-800 text-[11px] px-2 py-1 font-mono text-white"
                          />
                        </div>
                      )}
                      <p className="text-[9px] text-neutral-500 pl-6 leading-relaxed">
                        Sits out in flat chop (ADX &lt; threshold) to prevent bleed.
                      </p>
                    </div>

                    {/* VOL SIZE */}
                    <div className="flex flex-col gap-2 bg-neutral-950 p-3 border border-neutral-800">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={backtestParams.isVolatilitySizingActive}
                          onChange={(e) => setBacktestParams({ ...backtestParams, isVolatilitySizingActive: e.target.checked })}
                          className="w-4 h-4 accent-amber-500 bg-neutral-900 border-neutral-800"
                        />
                        <span className="text-xs font-bold text-white uppercase">Volatility-Scaled Sizing</span>
                      </label>
                      {backtestParams.isVolatilitySizingActive && (
                        <div className="flex items-center gap-2 pl-6">
                          <span className="text-[10px] text-neutral-400 uppercase">Risk per trade (%):</span>
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            max="5"
                            value={backtestParams.riskPercent}
                            onChange={(e) => setBacktestParams({ ...backtestParams, riskPercent: parseFloat(e.target.value) || 1.0 })}
                            className="w-16 bg-neutral-900 border border-neutral-800 text-[11px] px-2 py-1 font-mono text-white"
                          />
                        </div>
                      )}
                      <p className="text-[9px] text-neutral-500 pl-6 leading-relaxed">
                        Computes precise lots dynamically based on balance and current ATR SL distance.
                      </p>
                    </div>

                    {/* EQUITY THROTTLE */}
                    <div className="flex flex-col gap-2 bg-neutral-950 p-3 border border-neutral-800">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={backtestParams.isEquityThrottleActive}
                          onChange={(e) => setBacktestParams({ ...backtestParams, isEquityThrottleActive: e.target.checked })}
                          className="w-4 h-4 accent-amber-500 bg-neutral-900 border-neutral-800"
                        />
                        <span className="text-xs font-bold text-white uppercase">Tilt Control & Throttles</span>
                      </label>
                      <p className="text-[9px] text-neutral-500 pl-6 leading-relaxed">
                        Cuts lot size by 50% after 2 losses; halts trading for the day on a 2% daily loss; halts for 48h on a 6% DD.
                      </p>
                    </div>

                    {/* EVENT BLACKOUT */}
                    <div className="flex flex-col gap-2 bg-neutral-950 p-3 border border-neutral-800">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={backtestParams.isEventBlackoutActive}
                          onChange={(e) => setBacktestParams({ ...backtestParams, isEventBlackoutActive: e.target.checked })}
                          className="w-4 h-4 accent-amber-500 bg-neutral-900 border-neutral-800"
                        />
                        <span className="text-xs font-bold text-white uppercase">Economic Event Blackout</span>
                      </label>
                      <p className="text-[9px] text-neutral-500 pl-6 leading-relaxed">
                        Blocks new entries and flattens active trades 15 minutes before high-impact economic prints (CPI, FOMC, NFP).
                      </p>
                    </div>

                    {/* ORDER TYPE */}
                    <div className="flex flex-col gap-2 bg-neutral-950 p-3 border border-neutral-800">
                      <span className="text-[10px] text-neutral-400 font-bold uppercase block">COST ENGINEERING (ORDER TYPE)</span>
                      <select
                        value={backtestParams.orderType}
                        onChange={(e: any) => setBacktestParams({ ...backtestParams, orderType: e.target.value })}
                        className="w-full bg-neutral-900 border border-neutral-800 text-[11px] px-3 py-2 font-mono text-white focus:outline-none"
                      >
                        <option value="MARKET">Market Entry (Taker Fee 0.055%)</option>
                        <option value="LIMIT_POST_ONLY">Post-Only Limit Entry (Maker Fee 0.02%)</option>
                      </select>
                      <p className="text-[9px] text-neutral-500 leading-relaxed">
                        Maker orders save fees but carry a 15% missed execution rate on fast-moving crossovers.
                      </p>
                    </div>

                    {/* EXIT UPGRADES */}
                    <div className="flex flex-col gap-2 bg-neutral-950 p-3 border border-neutral-800">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={backtestParams.isPartialTPActive}
                          onChange={(e) => setBacktestParams({ ...backtestParams, isPartialTPActive: e.target.checked })}
                          className="w-4 h-4 accent-amber-500 bg-neutral-900 border-neutral-800"
                        />
                        <span className="text-xs font-bold text-white uppercase">Partial TP & Breakeven Move</span>
                      </label>
                      <p className="text-[9px] text-neutral-500 pl-6 leading-relaxed">
                        Exits 50% of the trade at 1.0R profit and locks in the remaining half at Breakeven.
                      </p>

                      <label className="flex items-center gap-2 cursor-pointer mt-2 border-t border-neutral-900 pt-2">
                        <input
                          type="checkbox"
                          checked={backtestParams.isTimeStopActive}
                          onChange={(e) => setBacktestParams({ ...backtestParams, isTimeStopActive: e.target.checked })}
                          className="w-4 h-4 accent-amber-500 bg-neutral-900 border-neutral-800"
                        />
                        <span className="text-xs font-bold text-white uppercase">Time Stop (Bars limit)</span>
                      </label>
                      {backtestParams.isTimeStopActive && (
                        <div className="flex items-center gap-2 pl-6">
                          <span className="text-[10px] text-neutral-400 uppercase">Max Hold Bars (15m):</span>
                          <input
                            type="number"
                            min="5"
                            max="80"
                            value={backtestParams.timeStopBars}
                            onChange={(e) => setBacktestParams({ ...backtestParams, timeStopBars: parseInt(e.target.value) || 20 })}
                            className="w-16 bg-neutral-900 border border-neutral-800 text-[11px] px-2 py-1 font-mono text-white"
                          />
                        </div>
                      )}
                      <p className="text-[9px] text-neutral-500 pl-6 leading-relaxed">
                        Closes stagnant trades after N bars to free up capital from slow markets.
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleRunBacktest}
                  disabled={backtestLoading}
                  className="bg-amber-500 text-neutral-950 hover:bg-amber-400 font-black uppercase text-xs tracking-widest py-3 px-6 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:bg-neutral-800 disabled:text-neutral-500"
                >
                  {backtestLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> RUNNING SIMULATOR...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" /> RUN BACKTEST SIMULATION
                    </>
                  )}
                </button>
              </div>

              {/* RIGHT COLUMN: GRAPHS & METRIC ANALYSIS */}
              <div className="col-span-12 lg:col-span-8 flex flex-col gap-6">
                {backtestError && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 text-xs font-mono">
                    ⚠️ Error executing backtest: {backtestError}
                  </div>
                )}

                {backtestLoading && !backtestResult && (
                  <div className="border border-neutral-800 p-16 text-center text-neutral-500 bg-neutral-900/40 flex flex-col items-center justify-center gap-3">
                    <RefreshCw className="w-10 h-10 text-amber-500 animate-spin" />
                    <p className="font-mono text-xs uppercase tracking-widest text-neutral-400">Compiling 15m historical candles & indicators...</p>
                  </div>
                )}

                {!backtestLoading && !backtestResult && (
                  <div className="border border-dashed border-neutral-800 p-16 text-center text-neutral-600 bg-neutral-900/10">
                    <Sliders className="w-12 h-12 text-neutral-700 mx-auto mb-3" />
                    <p className="text-base font-bold uppercase tracking-wider text-neutral-500">Configure parameters and trigger simulation</p>
                    <p className="text-xs text-neutral-600 mt-1">Backtests will strictly apply Bybit taker fees, bid-ask spread slippage, and Walk-Forward optimization checks.</p>
                  </div>
                )}

                {backtestResult && (
                  <>
                    {/* ROLLING EDGE DECAY ALERT BANNER */}
                    {backtestResult.rollingExpectancyAlert && (
                      <div className="bg-red-500/10 border border-red-500/40 text-red-400 p-4 font-mono text-xs flex flex-col gap-2 animate-pulse">
                        <span className="font-black text-red-500 flex items-center gap-1">
                          ⚠️ WARNING: SYSTEMIC ROLLING EDGE DECAY DETECTED
                        </span>
                        <p className="text-[11px] leading-relaxed">
                          The strategy's rolling 20-trade expectancy has decayed to <span className="text-white font-bold">{backtestResult.finalRollingExpectancy?.toFixed(2)}R</span> in the final segment of this simulation. This indicates a high likelihood of a trend-to-chop transition, or that parameter fits have over-optimized on preceding historical slices. Consider engaging the Regime Gate or pausing execution.
                        </p>
                      </div>
                    )}

                    {/* STATS HIGHLIGHT GRID - ROW 1 */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-neutral-900 border border-neutral-800 p-4 font-mono">
                        <div className="text-[9px] font-black text-neutral-500 uppercase tracking-widest mb-1">TOTAL RETURN</div>
                        <div className={`text-base font-black ${backtestResult.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {backtestResult.totalPnL >= 0 ? '+' : ''}${backtestResult.totalPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-[10px] text-neutral-400 mt-1">
                          Final: ${backtestResult.finalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>

                      <div className="bg-neutral-900 border border-neutral-800 p-4 font-mono">
                        <div className="text-[9px] font-black text-neutral-500 uppercase tracking-widest mb-1">EXPECTANCY / COMMISSION</div>
                        <div className={`text-base font-black ${backtestResult.expectancy >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ${backtestResult.expectancy.toFixed(2)}
                        </div>
                        <span className={`inline-block text-[8px] font-black px-1 py-0.5 mt-1 ${
                          backtestResult.expectancy > 0 
                            ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          {backtestResult.expectancy > 0 ? 'POSITIVE EXPECTANCY' : 'NEGATIVE EXPECTANCY'}
                        </span>
                      </div>

                      <div className="bg-neutral-900 border border-neutral-800 p-4 font-mono">
                        <div className="text-[9px] font-black text-neutral-500 uppercase tracking-widest mb-1">WIN RATE & PROFIT FACTOR</div>
                        <div className="text-base font-black text-white">
                          {backtestResult.winRate.toFixed(1)}% <span className="text-neutral-500 text-xs font-normal">({backtestResult.profitFactor.toFixed(2)} PF)</span>
                        </div>
                        <div className="text-[10px] text-neutral-400 mt-1">
                          W: {backtestResult.winningTrades} / L: {backtestResult.losingTrades}
                        </div>
                      </div>

                      <div className="bg-neutral-900 border border-neutral-800 p-4 font-mono">
                        <div className="text-[9px] font-black text-neutral-500 uppercase tracking-widest mb-1">MAR RATIO & SHARPE</div>
                        <div className="text-base font-black text-white">
                          {backtestResult.marRatio?.toFixed(2)} <span className="text-neutral-500 text-xs font-normal">MAR</span>
                        </div>
                        <div className="text-[10px] text-neutral-400 mt-1">
                          Net Return / Max Drawdown
                        </div>
                      </div>
                    </div>

                    {/* STATS HIGHLIGHT GRID - ROW 2 (QUANT RISK METRICS) */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-neutral-900 border border-neutral-800 p-4 font-mono">
                        <div className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1">MONTE CARLO 95% DD</div>
                        <div className="text-base font-black text-amber-500">
                          {backtestResult.monteCarlo95thMaxDrawdownPercent?.toFixed(2)}%
                        </div>
                        <div className="text-[10px] text-neutral-400 mt-1">
                          Worst 5% DD across 1,000 sequence shuffles
                        </div>
                      </div>

                      <div className="bg-neutral-900 border border-neutral-800 p-4 font-mono">
                        <div className="text-[9px] font-black text-neutral-500 uppercase tracking-widest mb-1">HISTORIC MAX DRAWDOWN</div>
                        <div className="text-base font-black text-neutral-300">
                          {backtestResult.maxDrawdownPercent.toFixed(2)}%
                        </div>
                        <div className="text-[10px] text-neutral-400 mt-1">
                          Kelly: {backtestResult.kellyCriterion.toFixed(1)}% recommended leverage
                        </div>
                      </div>

                      <div className="bg-neutral-900 border border-neutral-800 p-4 font-mono">
                        <div className="text-[9px] font-black text-neutral-500 uppercase tracking-widest mb-1">TOTAL COST OVERHEAD</div>
                        <div className="text-base font-black text-red-400 text-xs mt-1">
                          Fees: ${backtestResult.totalFeesPaid?.toFixed(2)}
                        </div>
                        <div className="text-[10px] text-neutral-400">
                          Slippage: ${backtestResult.totalSlippagePaid?.toFixed(2)}
                        </div>
                      </div>

                      <div className="bg-neutral-900 border border-neutral-800 p-4 font-mono">
                        <div className="text-[9px] font-black text-neutral-500 uppercase tracking-widest mb-1">GUARDRAIL REJECTIONS</div>
                        <div className="text-xs font-bold text-neutral-300 flex flex-col gap-0.5 mt-0.5">
                          <span>Chop Filter: <span className="text-amber-500">{backtestResult.rejectedByRegime || 0}</span></span>
                          <span>News Blackout: <span className="text-amber-500">{backtestResult.rejectedByEvent || 0}</span></span>
                        </div>
                      </div>
                    </div>

                    {/* INTERACTIVE BACKTEST AREA CHART */}
                    <div className="bg-neutral-900 border border-neutral-800 p-6 flex flex-col gap-4">
                      <div className="flex justify-between items-center">
                        <h4 className="text-xs font-black text-neutral-400 uppercase tracking-[0.1em]">Simulated Cumulative Performance Curve</h4>
                        <span className="text-[10px] font-mono text-neutral-500">Initial: $10,000.00</span>
                      </div>

                      <div className="h-64 w-full relative">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={backtestResult.dailyCurve}
                            margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                          >
                            <defs>
                              <linearGradient id="backtestColor" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#d97706" stopOpacity={0.2}/>
                                <stop offset="95%" stopColor="#d97706" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                            <XAxis 
                              dataKey="date" 
                              stroke="#737373" 
                              fontSize={10}
                              tickLine={false}
                              axisLine={false}
                            />
                            <YAxis 
                              stroke="#737373" 
                              fontSize={10}
                              tickLine={false}
                              axisLine={false}
                              domain={['dataMin - 100', 'dataMax + 100']}
                              tickFormatter={(v) => `$${v}`}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: '#171717',
                                borderColor: '#404040',
                                color: '#fff',
                                fontSize: '11px',
                                fontFamily: 'monospace'
                              }}
                              formatter={(value: any) => [`$${parseFloat(value).toFixed(2)}`, 'Equity']}
                            />
                            <Area 
                              type="monotone" 
                              dataKey="balance" 
                              stroke="#d97706" 
                              strokeWidth={2}
                              fillOpacity={1} 
                              fill="url(#backtestColor)" 
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* COMPLETED TRADES TABLE */}
                    <div className="bg-neutral-900 border border-neutral-800 flex flex-col gap-3">
                      <div className="p-4 border-b border-neutral-800 bg-neutral-950 flex justify-between items-center">
                        <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Simulated Strategy Trade Journal</span>
                        <span className="text-[10px] font-mono text-neutral-500">Total Executed: {backtestResult.trades.length}</span>
                      </div>

                      <div className="max-h-80 overflow-y-auto">
                        <table className="w-full text-left border-collapse text-xs font-mono">
                          <thead className="bg-neutral-950 text-neutral-500 text-[10px] font-bold sticky top-0 uppercase border-b border-neutral-800">
                            <tr>
                              <th className="p-3">Type</th>
                              <th className="p-3">Entry / Exit Price</th>
                              <th className="p-3">Duration (Mins)</th>
                              <th className="p-3">Commissions & Slippage</th>
                              <th className="p-3 text-right">PnL After Costs</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-800/40">
                            {backtestResult.trades.map((t: any) => (
                              <tr key={t.id} className="hover:bg-neutral-950/40 transition-colors">
                                <td className="p-3">
                                  <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${
                                    t.type === 'LONG' 
                                      ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                                      : 'bg-red-500/10 text-red-400 border border-red-500/20'
                                  }`}>
                                    {t.type}
                                  </span>
                                </td>
                                <td className="p-3 text-neutral-300">
                                  <div>Entry: <span className="text-white">${t.entryPrice.toFixed(2)}</span></div>
                                  <div className="text-[10px] text-neutral-500 mt-0.5">Exit: <span className="text-neutral-400">${t.exitPrice.toFixed(2)}</span></div>
                                </td>
                                <td className="p-3 text-neutral-300">
                                  {t.durationMins} mins
                                </td>
                                <td className="p-3 text-neutral-400 text-[10px]">
                                  <div>Taker Fees: <span className="text-neutral-500">${t.fees.toFixed(2)}</span></div>
                                  <div className="text-neutral-500 mt-0.5">Slippage Ticks: <span className="text-neutral-500">{backtestParams.slippageTicks} ticks</span></div>
                                </td>
                                <td className={`p-3 text-right text-xs font-bold ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'quant' && (
          <div className="col-span-12 bg-neutral-950 p-6 flex flex-col gap-6 overflow-y-auto">
            {/* Header section with manual refresh */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-neutral-800 pb-5 gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping"></span>
                  <span className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.25em]">ROUTED QUANT EXECUTOR TERMINAL</span>
                </div>
                <h1 className="text-3xl font-black tracking-tight text-white mt-1">
                  XAUUSD REGIME ANALYSIS & PERFORMANCE DESK
                </h1>
                <p className="text-xs text-neutral-400 mt-1 leading-relaxed max-w-3xl">
                  Real-time correlation modeling on Bybit v5. Tracks global macroeconomic drivers (DXY, 10Y Yield) alongside on-exchange order flows, liquidity triggers, and AI-meta labeled safety filters.
                </p>
              </div>

              <div className="flex items-center gap-3 self-stretch md:self-auto justify-between border-t border-neutral-900 md:border-t-0 pt-4 md:pt-0">
                <div className="flex items-center gap-2 bg-neutral-900 px-3 py-1.5 border border-neutral-800 text-[10px] font-mono">
                  <span className="text-neutral-500">FEEDER STATUS:</span>
                  <span className="text-green-400 font-bold uppercase">LIVE FEEDING</span>
                </div>
                <button
                  onClick={fetchQuantData}
                  disabled={quantLoading}
                  className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-800 text-xs font-black uppercase tracking-widest transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${quantLoading ? 'animate-spin text-amber-500' : ''}`} />
                  REFRESH TERMINAL
                </button>
              </div>
            </div>

            {quantError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 font-mono text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-500" />
                <span>Error syncing quant telemetry: {quantError}</span>
              </div>
            )}

            {/* REAL-TIME TICKERS BLOCK */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Card 1: DXY */}
              <div className="bg-neutral-900 border border-neutral-800 p-4 font-mono relative overflow-hidden">
                <div className="absolute right-2 top-2 text-neutral-800 font-bold text-3xl select-none opacity-20">DXY</div>
                <span className="text-[9px] text-neutral-500 font-black uppercase tracking-wider block">DXY SPOT</span>
                <span className="text-2xl font-black text-white block mt-1">
                  {quantMetrics?.dxy?.toFixed(2) || '104.20'}
                </span>
                <div className="flex items-center gap-1 text-[9px] text-red-400 mt-2">
                  <span className="font-semibold">-0.12%</span>
                  <span className="text-neutral-600">vs 24h ago</span>
                </div>
              </div>

              {/* Card 2: 10Y Yield */}
              <div className="bg-neutral-900 border border-neutral-800 p-4 font-mono relative overflow-hidden">
                <div className="absolute right-2 top-2 text-neutral-800 font-bold text-3xl select-none opacity-20">US10Y</div>
                <span className="text-[9px] text-neutral-500 font-black uppercase tracking-wider block">US 10Y YIELD</span>
                <span className="text-2xl font-black text-amber-500 block mt-1">
                  {quantMetrics?.yield10y ? `${quantMetrics.yield10y.toFixed(3)}%` : '4.150%'}
                </span>
                <div className="flex items-center gap-1 text-[9px] text-green-400 mt-2">
                  <span className="font-semibold">+0.03%</span>
                  <span className="text-neutral-600">Negative correlation</span>
                </div>
              </div>

              {/* Card 3: Funding Rate */}
              <div className="bg-neutral-900 border border-neutral-800 p-4 font-mono relative overflow-hidden">
                <div className="absolute right-2 top-2 text-neutral-800 font-bold text-3xl select-none opacity-20">FUND</div>
                <span className="text-[9px] text-neutral-500 font-black uppercase tracking-wider block">BYBIT 8H FUNDING RATE</span>
                <span className="text-2xl font-black text-emerald-400 block mt-1">
                  {quantMetrics?.fundingRate ? `${(quantMetrics.fundingRate * 100).toFixed(4)}%` : '0.0150%'}
                </span>
                <div className="text-[9px] text-neutral-500 mt-2">
                  Daily annualized: <span className="text-neutral-300 font-semibold">16.42%</span>
                </div>
              </div>

              {/* Card 4: Open Interest */}
              <div className="bg-neutral-900 border border-neutral-800 p-4 font-mono relative overflow-hidden">
                <div className="absolute right-2 top-2 text-neutral-800 font-bold text-3xl select-none opacity-20">OI</div>
                <span className="text-[9px] text-neutral-500 font-black uppercase tracking-wider block">BYBIT OPEN INTEREST</span>
                <span className="text-2xl font-black text-indigo-400 block mt-1">
                  {quantMetrics?.openInterest ? `$${(quantMetrics.openInterest / 1000000).toFixed(1)}M` : '$124.5M'}
                </span>
                <div className="text-[9px] text-neutral-500 mt-2">
                  Active net leverage: <span className="text-neutral-300 font-semibold">High leverage load</span>
                </div>
              </div>

              {/* Card 5: Liquidations */}
              <div className="bg-neutral-900 border border-neutral-800 p-4 font-mono relative overflow-hidden">
                <div className="absolute right-2 top-2 text-neutral-800 font-bold text-3xl select-none opacity-20">LIQ</div>
                <span className="text-[9px] text-neutral-500 font-black uppercase tracking-wider block">BYBIT 24H LIQUIDATIONS</span>
                <span className="text-2xl font-black text-rose-500 block mt-1">
                  {quantMetrics?.liquidationsUsd ? `$${(quantMetrics.liquidationsUsd / 1000).toFixed(1)}K` : '$234.5K'}
                </span>
                <div className="text-[9px] text-rose-400 mt-2 font-bold animate-pulse">
                  High volatility risk threshold
                </div>
              </div>
            </div>

            {/* DUAL COLUMN INTERACTIVE SECTIONS */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* LEFT COLUMN (Lg: 8): CHARTS, SPECIALISTS ATTRIBUTION & SLIPPAGE */}
              <div className="lg:col-span-8 flex flex-col gap-6">
                
                {/* Chart section */}
                <div className="bg-neutral-900 border border-neutral-800 p-6 flex flex-col gap-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <div>
                      <h3 className="text-xs font-black text-neutral-400 uppercase tracking-[0.1em] flex items-center gap-1.5">
                        <LineChart className="w-4 h-4 text-amber-500" />
                        Macro Correlation modeling (15M granularity)
                      </h3>
                      <p className="text-[10px] text-neutral-500">
                        Tracks physical US Dollar liquidity alongside the 10-Year yield as an intraday gold proxy.
                      </p>
                    </div>
                    <span className="text-[9px] font-mono text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
                      GOLD IS A REAL YIELDS TRADE
                    </span>
                  </div>

                  <div className="h-64 w-full relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={quantMetrics?.macroCharts || [
                          { time: '11:00', dxy: 104.12, yield10y: 4.145, gold: 2372 },
                          { time: '11:15', dxy: 104.15, yield10y: 4.148, gold: 2373 },
                          { time: '11:30', dxy: 104.18, yield10y: 4.152, gold: 2374 },
                          { time: '11:45', dxy: 104.22, yield10y: 4.150, gold: 2373 },
                          { time: '12:00', dxy: 104.20, yield10y: 4.150, gold: 2375 }
                        ]}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="colorDxy" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#d97706" stopOpacity={0.15}/>
                            <stop offset="95%" stopColor="#d97706" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorYield" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15}/>
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                        <XAxis dataKey="time" stroke="#525252" fontSize={9} tickLine={false} />
                        <YAxis yAxisId="left" stroke="#d97706" fontSize={9} tickLine={false} domain={['dataMin - 0.05', 'dataMax + 0.05']} />
                        <YAxis yAxisId="right" orientation="right" stroke="#6366f1" fontSize={9} tickLine={false} domain={['dataMin - 0.01', 'dataMax + 0.01']} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#171717',
                            borderColor: '#404040',
                            color: '#fff',
                            fontSize: '10px',
                            fontFamily: 'monospace'
                          }}
                        />
                        <Area yAxisId="left" type="monotone" dataKey="dxy" name="DXY Spot" stroke="#d97706" strokeWidth={1.5} fillOpacity={1} fill="url(#colorDxy)" />
                        <Area yAxisId="right" type="monotone" dataKey="yield10y" name="US10Y Yield" stroke="#6366f1" strokeWidth={1.5} fillOpacity={1} fill="url(#colorYield)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Specialists, attribution and veto status grids */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Specialists & Kelly allocation */}
                  <div className="bg-neutral-900 border border-neutral-800 p-5 flex flex-col gap-4">
                    <h3 className="text-xs font-black text-neutral-400 uppercase tracking-widest flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-amber-500" />
                      Specialist Portfolio Allocator
                    </h3>
                    <p className="text-[11px] text-neutral-500 leading-normal">
                      Intraday router metrics showing the current win rate and fractional-Kelly sizing outputs computed for the next trade block:
                    </p>

                    <div className="space-y-3 font-mono">
                      {/* Trend follower details */}
                      <div className="bg-neutral-950 p-3 border border-neutral-800">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs text-white font-bold">Trend Follower specialist</span>
                          <span className="text-[10px] text-emerald-400 font-bold">WR: {quantPerformance?.attribution?.trendWinRate || '75'}%</span>
                        </div>
                        <div className="text-[10px] text-neutral-400 flex justify-between items-center">
                          <span>Kelly Order Leverage multiplier:</span>
                          <span className="text-amber-500 font-bold">{quantPerformance?.modules?.trend?.sizingMultiplier?.toFixed(2) || '0.50'}x Lots</span>
                        </div>
                      </div>

                      {/* Mean Reversion details */}
                      <div className="bg-neutral-950 p-3 border border-neutral-800">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs text-white font-bold">Mean Reverter specialist</span>
                          <span className="text-[10px] text-emerald-400 font-bold">WR: {quantPerformance?.attribution?.rangeWinRate || '68'}%</span>
                        </div>
                        <div className="text-[10px] text-neutral-400 flex justify-between items-center">
                          <span>Kelly Order Leverage multiplier:</span>
                          <span className="text-amber-500 font-bold">{quantPerformance?.modules?.range?.sizingMultiplier?.toFixed(2) || '0.25'}x Lots</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Portfolio veto parameters */}
                  <div className="bg-neutral-900 border border-neutral-800 p-5 flex flex-col gap-4">
                    <h3 className="text-xs font-black text-neutral-400 uppercase tracking-widest flex items-center gap-1.5">
                      <Shield className="w-4 h-4 text-amber-500" />
                      Central Risk Veto Diagnostics
                    </h3>
                    <p className="text-[11px] text-neutral-500 leading-normal">
                      Central risk gateway metrics monitoring maximum risk bounds. Blocks new executions if constraints fail.
                    </p>

                    <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                      <div className="bg-neutral-950 p-3 border border-neutral-800 flex flex-col justify-between">
                        <span className="text-[9px] text-neutral-500 block">RISK STATUS</span>
                        <span className={`text-sm font-black mt-1 ${quantPerformance?.riskGate?.status === 'PASS' ? 'text-emerald-400 animate-pulse' : 'text-red-400'}`}>
                          {quantPerformance?.riskGate?.status || 'PASS'}
                        </span>
                      </div>

                      <div className="bg-neutral-950 p-3 border border-neutral-800 flex flex-col justify-between">
                        <span className="text-[9px] text-neutral-500 block">DAILY DRAWDOWN</span>
                        <span className="text-sm font-black text-white mt-1">
                          {quantPerformance?.riskGate?.drawdown?.toFixed(2) || '0.00'}%
                        </span>
                      </div>

                      <div className="bg-neutral-950 p-3 border border-neutral-800 flex flex-col justify-between">
                        <span className="text-[9px] text-neutral-500 block">STREAK VETO</span>
                        <span className="text-sm font-bold text-neutral-300 mt-1">
                          {quantPerformance?.riskGate?.streakVeto ? 'BLOCKED' : 'ALLOW'}
                        </span>
                      </div>

                      <div className="bg-neutral-950 p-3 border border-neutral-800 flex flex-col justify-between">
                        <span className="text-[9px] text-neutral-500 block">SESSION VETO</span>
                        <span className="text-sm font-bold text-neutral-300 mt-1">
                          {quantPerformance?.riskGate?.gmtVeto ? 'BLOCKED' : 'ALLOW'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Execution Shortfall Slippage Log */}
                <div className="bg-neutral-900 border border-neutral-800 p-5">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h3 className="text-xs font-black text-neutral-400 uppercase tracking-widest flex items-center gap-1.5">
                        <Timer className="w-4 h-4 text-amber-500" />
                        Execution Slippage & Shortfall Auditing
                      </h3>
                      <p className="text-[10px] text-neutral-500 mt-1">
                        Maker vs Taker escalation trail logging actual fill performance against proposed TV trigger prices.
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-neutral-400">
                      Maker Efficiency: <span className="text-emerald-400 font-bold">{quantPerformance?.drift?.makerFillEfficiency ? `${quantPerformance.drift.makerFillEfficiency}%` : '85%'}</span>
                    </span>
                  </div>

                  <div className="max-h-48 overflow-y-auto border border-neutral-800">
                    {(!quantPerformance?.shortfallLogs || quantPerformance.shortfallLogs.length === 0) ? (
                      <div className="p-8 text-center text-xs text-neutral-600 font-mono bg-neutral-950">
                        No shortfall logs populated yet. Trigger a webhook or execute positions to capture slippage metrics.
                      </div>
                    ) : (
                      <table className="w-full text-left border-collapse font-mono text-[11px]">
                        <thead className="bg-neutral-950 text-neutral-500 text-[9px] font-bold uppercase border-b border-neutral-800 sticky top-0">
                          <tr>
                            <th className="p-2.5">SYMBOL/SIDE</th>
                            <th className="p-2.5">SIGNAL PRICE</th>
                            <th className="p-2.5">FILLED PRICE</th>
                            <th className="p-2.5">SLIPPAGE</th>
                            <th className="p-2.5">FILL METHOD</th>
                            <th className="p-2.5 text-right">LATENCY</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-800/40 bg-neutral-950/50">
                          {quantPerformance.shortfallLogs.map((log: any) => {
                            const isLoss = log.slippageTicks > 0;
                            return (
                              <tr key={log.id} className="hover:bg-neutral-950 transition-colors">
                                <td className="p-2.5 font-bold text-white uppercase">{log.symbol}</td>
                                <td className="p-2.5 text-neutral-400">${log.targetPrice?.toFixed(2)}</td>
                                <td className="p-2.5 text-neutral-300">${log.filledPrice?.toFixed(2)}</td>
                                <td className={`p-2.5 font-bold ${isLoss ? 'text-red-400' : 'text-emerald-400'}`}>
                                  {isLoss ? '+' : ''}{log.slippageTicks} ticks
                                </td>
                                <td className="p-2.5">
                                  <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase ${log.isMaker ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-neutral-800 text-neutral-400'}`}>
                                    {log.isMaker ? 'MAKER' : 'TAKER'}
                                  </span>
                                </td>
                                <td className="p-2.5 text-right text-neutral-500">{log.delayMs}ms</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* QUANT RESEARCH DESK */}
                <div className="bg-neutral-900 border border-neutral-800 p-6 flex flex-col gap-6 relative overflow-hidden">
                  <div className="absolute -right-8 -top-8 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl"></div>
                  
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-neutral-800 pb-4">
                    <div>
                      <h2 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                        <Brain className="w-5 h-5 text-amber-500 animate-pulse" />
                        Quant Research Desk
                      </h2>
                      <p className="text-[10px] text-neutral-400 mt-0.5">
                        Nightly hypothesis reports, multi-regime stress testing, adaptive fills, and capital laddering.
                      </p>
                    </div>
                    <div className="text-[9px] font-mono bg-neutral-950 border border-neutral-800 px-2.5 py-1 text-neutral-400">
                      DESK: <span className="text-emerald-400 font-bold">COFFEE ONE-HOUR ACTIVE</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Module 1: Hypothesis Generator */}
                    <div className="bg-neutral-950 border border-neutral-800 p-4 flex flex-col gap-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-mono text-amber-500 font-bold uppercase tracking-wider">Candidate Hypotheses</span>
                        <span className="text-[9px] text-neutral-500 uppercase font-mono">AUTORUN AT 00:00 UTC</span>
                      </div>
                      <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
                        {researchDeskData?.hypotheses?.map((hyp) => (
                          <div key={hyp.id} className="p-3 bg-neutral-900/60 border border-neutral-800/80 hover:border-neutral-700 transition-colors">
                            <div className="flex justify-between items-start gap-1">
                              <h4 className="text-[11px] font-bold text-white leading-snug">{hyp.title}</h4>
                              <span className={`text-[8px] font-mono px-1 py-0.5 font-bold uppercase ${
                                hyp.recommendation === 'SHADOW_MODE_PROMOTION' ? 'text-amber-400 bg-amber-500/10' :
                                hyp.recommendation === 'MONITOR' ? 'text-indigo-400 bg-indigo-500/10' : 'text-neutral-500 bg-neutral-800'
                              }`}>
                                {hyp.recommendation === 'SHADOW_MODE_PROMOTION' ? 'PROMOTE' : hyp.recommendation}
                              </span>
                            </div>
                            <p className="text-[9px] font-mono text-neutral-400 mt-1.5 leading-normal">{hyp.regimePattern}</p>
                            <p className="text-[10px] text-neutral-500 mt-1 font-sans">{hyp.detailedDescription}</p>
                            <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-neutral-800/40 text-[9px] font-mono">
                              <div>
                                <span className="text-neutral-500 block">EXPECTANCY</span>
                                <span className="text-neutral-200 font-bold">+{hyp.expectancyR.toFixed(2)}R</span>
                              </div>
                              <div>
                                <span className="text-neutral-500 block">SAMPLE SIZE</span>
                                <span className="text-neutral-200 font-bold">{hyp.sampleCount}</span>
                              </div>
                              <div>
                                <span className="text-neutral-500 block">STABILITY</span>
                                <span className="text-emerald-400 font-bold">{(hyp.stabilityScore * 100).toFixed(0)}%</span>
                              </div>
                            </div>
                            {hyp.recommendation === 'SHADOW_MODE_PROMOTION' && (
                              <button
                                onClick={() => handleDeskAction('promote_hypothesis', hyp.id)}
                                disabled={deskActionLoading}
                                className="mt-2.5 w-full py-1.5 bg-amber-500 text-neutral-950 text-[9px] font-black uppercase tracking-widest hover:bg-amber-400 disabled:opacity-50 transition-all cursor-pointer border-none"
                              >
                                {deskActionLoading ? 'PROMOTING...' : 'PROMOTE TO SHADOW MODE'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Module 2: Stress-Testing CI Suite */}
                    <div className="bg-neutral-950 border border-neutral-800 p-4 flex flex-col gap-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-mono text-rose-400 font-bold uppercase tracking-wider">Stress-Testing CI Gate</span>
                        <span className="text-[9px] text-neutral-500 uppercase font-mono">STABILITY BENCHMARK: 95%</span>
                      </div>
                      <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
                        {researchDeskData?.stressTests?.map((test, index) => (
                          <div key={index} className="p-3 bg-neutral-900/60 border border-neutral-800/80 hover:border-neutral-700 transition-colors">
                            <div className="flex justify-between items-center">
                              <span className="text-[11px] font-bold text-neutral-300 leading-snug">{test.scenarioName}</span>
                              <span className={`text-[8px] font-mono px-1.5 py-0.5 font-bold uppercase ${
                                test.passed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400 animate-pulse'
                              }`}>
                                {test.passed ? 'PASS' : 'BLOCKED'}
                              </span>
                            </div>
                            <p className="text-[9px] text-neutral-500 mt-1">{test.notes}</p>
                            <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-neutral-800/40 text-[9px] font-mono">
                              <div>
                                <span className="text-neutral-500 block">ATR VOL</span>
                                <span className="text-neutral-300">{test.volatilityAtr.toFixed(1)} Ticks</span>
                              </div>
                              <div>
                                <span className="text-neutral-500 block">SIM DRAWDOWN</span>
                                <span className={`font-bold ${test.passed ? 'text-neutral-200' : 'text-red-400'}`}>-{test.simulatedDrawdown.toFixed(2)}%</span>
                              </div>
                              <div>
                                <span className="text-neutral-500 block">MAX TOLERANCE</span>
                                <span className="text-neutral-400">-{test.toleranceLimit.toFixed(2)}%</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="bg-neutral-900 p-2.5 border border-neutral-800 text-[9px] text-neutral-400 leading-snug font-mono mt-auto">
                        <span className="text-rose-400 font-bold">CI GUARD ACTION:</span> Synthetic 2020-Style Vol explosion exceeds drawdown threshold (95th Pctl DD &gt; 5.0%). Configuration changes blocked on live server.
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Module 3: Adaptive Execution Lookup Table */}
                    <div className="bg-neutral-950 border border-neutral-800 p-4 flex flex-col gap-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-mono text-indigo-400 font-bold uppercase tracking-wider">Adaptive Execution Optimizer</span>
                        <span className="text-[9px] text-neutral-500 uppercase font-mono">AUTO TUNED FROM SHORTFALL LOGS</span>
                      </div>
                      <p className="text-[10px] text-neutral-500 leading-normal">
                        Self-tuning market routing table compiled dynamically using historical slippage metrics and current session liquidity:
                      </p>
                      <div className="overflow-x-auto border border-neutral-800">
                        <table className="w-full text-left border-collapse font-mono text-[10px]">
                          <thead className="bg-neutral-900 text-neutral-500 uppercase text-[8px] border-b border-neutral-800">
                            <tr>
                              <th className="p-2">SESSION</th>
                              <th className="p-2">VOL STATE</th>
                              <th className="p-2">OPTIMAL EXECUTION</th>
                              <th className="p-2">SLIPPAGE</th>
                              <th className="p-2 text-right">RESTING</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-900 bg-neutral-950">
                            {researchDeskData?.adaptiveExecution?.map((row, idx) => (
                              <tr key={idx} className="hover:bg-neutral-900/40">
                                <td className="p-2 font-bold text-white uppercase">{row.session}</td>
                                <td className="p-2 uppercase text-neutral-400">{row.volState}</td>
                                <td className="p-2">
                                  <span className={`px-1 py-0.2 rounded-[1px] text-[8px] font-bold ${
                                    row.optimalExecution === 'POST_ONLY_LIMIT' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  }`}>
                                    {row.optimalExecution}
                                  </span>
                                </td>
                                <td className="p-2 text-neutral-300">+{row.slippageTicksPenalty.toFixed(1)} ticks</td>
                                <td className="p-2 text-right text-neutral-500">{row.restingTimeSec}s</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Module 4: Capital Scaling Ladder & Profit Sweeper */}
                    <div className="bg-neutral-950 border border-neutral-800 p-4 flex flex-col gap-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-wider">Capital Scaling Ladder</span>
                        <span className="text-[9px] text-neutral-500 uppercase font-mono">AUTOMATED PROP DE-RISKING</span>
                      </div>
                      <div className="bg-neutral-900 p-3 border border-neutral-800 flex justify-between items-center text-[11px] font-mono">
                        <div>
                          <span className="text-white font-bold block">Current Ladder Tier:</span>
                          <span className="text-[9px] text-neutral-500">Base Challenge Stage</span>
                        </div>
                        <span className="text-amber-500 font-bold text-base bg-amber-500/5 px-2 py-1 border border-amber-500/10">
                          RUNG 1 (10K Funded)
                        </span>
                      </div>
                      <div className="space-y-2 text-[10px] font-mono">
                        <div className="flex justify-between py-1 border-b border-neutral-900">
                          <span className="text-neutral-500">ACCUMULATED NET PROFIT:</span>
                          <span className={`font-bold ${researchDeskData?.capitalLadder?.currentProfitUsd > 0 ? 'text-emerald-400' : 'text-neutral-400'}`}>
                            ${researchDeskData?.capitalLadder?.currentProfitUsd?.toLocaleString() || '0.00'} USD
                          </span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-neutral-900">
                          <span className="text-neutral-500">NEXT RUNG SCALE TARGET (15%):</span>
                          <span className="text-neutral-300 font-bold">
                            ${researchDeskData?.capitalLadder?.targetProfitToScale?.toLocaleString() || '1,500.00'} USD
                          </span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-neutral-900">
                          <span className="text-neutral-500">SWEEPABLE BALANCE:</span>
                          <span className="text-neutral-300 font-bold">
                            ${researchDeskData?.capitalLadder?.sweepableBalanceUsd?.toLocaleString() || '0.00'} USD
                          </span>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-neutral-500">RUNG APPROVAL STATUS:</span>
                          <span className={`font-bold uppercase ${researchDeskData?.capitalLadder?.approvedForNextRung ? 'text-emerald-400 animate-pulse' : 'text-amber-500'}`}>
                            {researchDeskData?.capitalLadder?.approvedForNextRung ? 'QUALIFIED (APPROVED)' : 'NOT YET QUALIFIED'}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <button
                          onClick={() => handleDeskAction('approve_ladder_rung')}
                          disabled={deskActionLoading || !researchDeskData?.capitalLadder?.approvedForNextRung}
                          className="py-2 px-1 bg-emerald-600 disabled:bg-neutral-950 text-white disabled:text-neutral-600 border border-emerald-500/20 disabled:border-neutral-800 text-[10px] font-black uppercase tracking-wider hover:bg-emerald-500 disabled:opacity-50 transition-all cursor-pointer flex items-center justify-center gap-1 border-none"
                        >
                          <TrendingUp className="w-3 h-3" /> APPROVE RUNG SCALE
                        </button>
                        <button
                          onClick={() => handleDeskAction('sweep_profits')}
                          disabled={deskActionLoading || !(researchDeskData?.capitalLadder?.currentProfitUsd > 0)}
                          className="py-2 px-1 bg-amber-500 disabled:bg-neutral-950 text-neutral-950 disabled:text-neutral-600 text-[10px] font-black uppercase tracking-wider hover:bg-amber-400 disabled:opacity-50 transition-all cursor-pointer flex items-center justify-center gap-1 border-none"
                        >
                          <DollarSign className="w-3 h-3" /> SWEEP PROFITS
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

              </div>

              {/* RIGHT COLUMN (Lg: 4): AI META-LABELER PLAYPEN & SYSTEM ALERTS */}
              <div className="lg:col-span-4 flex flex-col gap-6">
                {/* AI Meta-Labeler Playground */}
                <div className="bg-neutral-900 border border-amber-500/20 p-5 rounded-none flex flex-col gap-4 relative overflow-hidden">
                  <div className="absolute -right-8 -top-8 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl"></div>
                  
                  <div className="flex items-center gap-2">
                    <Brain className="w-5 h-5 text-amber-500 animate-pulse" />
                    <div>
                      <h3 className="text-xs font-black text-amber-500 uppercase tracking-widest">
                        AI Meta-Labeler diagnostics
                      </h3>
                      <span className="text-[9px] text-neutral-500 uppercase font-mono block">GEMINI-POWERED COGNITIVE FILTER</span>
                    </div>
                  </div>

                  <p className="text-[11px] text-neutral-400 leading-normal">
                    Manually pass on-exchange and macro metrics into our Gemini AI classifier to assess quality scoring on incoming signal waves before execution.
                  </p>

                  <form onSubmit={handleCheckMetaLabel} className="space-y-3 font-mono text-[11px]">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-neutral-500 uppercase block mb-1">Module</label>
                        <select
                          value={metaLabelForm.module}
                          onChange={(e) => setMetaLabelForm({ ...metaLabelForm, module: e.target.value })}
                          className="w-full bg-neutral-950 border border-neutral-800 text-xs px-2 py-1.5 text-white focus:outline-none focus:border-amber-500"
                        >
                          <option value="trend">Trend Follower</option>
                          <option value="range">Mean Reverter</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[9px] text-neutral-500 uppercase block mb-1">Direction</label>
                        <select
                          value={metaLabelForm.side}
                          onChange={(e) => setMetaLabelForm({ ...metaLabelForm, side: e.target.value })}
                          className="w-full bg-neutral-950 border border-neutral-800 text-xs px-2 py-1.5 text-white focus:outline-none focus:border-amber-500"
                        >
                          <option value="buy">BUY (Long)</option>
                          <option value="sell">SELL (Short)</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-neutral-500 uppercase block mb-1">ADX Index</label>
                        <input
                          type="number"
                          value={metaLabelForm.adx}
                          onChange={(e) => setMetaLabelForm({ ...metaLabelForm, adx: parseInt(e.target.value) || 20 })}
                          className="w-full bg-neutral-950 border border-neutral-800 text-xs px-2 py-1.5 text-white focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      <div>
                        <label className="text-[9px] text-neutral-500 uppercase block mb-1">Funding Pct%</label>
                        <input
                          type="number"
                          value={metaLabelForm.fundingPercentile}
                          onChange={(e) => setMetaLabelForm({ ...metaLabelForm, fundingPercentile: parseInt(e.target.value) || 50 })}
                          className="w-full bg-neutral-950 border border-neutral-800 text-xs px-2 py-1.5 text-white focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-neutral-500 uppercase block mb-1">DXY Spot</label>
                        <input
                          type="number"
                          step="0.01"
                          value={metaLabelForm.dxy}
                          onChange={(e) => setMetaLabelForm({ ...metaLabelForm, dxy: parseFloat(e.target.value) || 104.2 })}
                          className="w-full bg-neutral-950 border border-neutral-800 text-xs px-2 py-1.5 text-white focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      <div>
                        <label className="text-[9px] text-neutral-500 uppercase block mb-1">10Y Yield</label>
                        <input
                          type="number"
                          step="0.01"
                          value={metaLabelForm.yield10y}
                          onChange={(e) => setMetaLabelForm({ ...metaLabelForm, yield10y: parseFloat(e.target.value) || 4.15 })}
                          className="w-full bg-neutral-950 border border-neutral-800 text-xs px-2 py-1.5 text-white focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    </div>

                    <div>
                      <button
                        type="submit"
                        disabled={metaLabelLoading}
                        className="w-full py-2 bg-amber-500 text-neutral-950 font-black uppercase text-[10px] tracking-widest hover:bg-amber-400 transition-all cursor-pointer flex items-center justify-center gap-1.5 mt-2"
                      >
                        {metaLabelLoading ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> ASSESSING SIGNAL FLOWS...
                          </>
                        ) : (
                          <>
                            <Brain className="w-3.5 h-3.5" /> EVALUATE QUALITY INDEX
                          </>
                        )}
                      </button>
                    </div>
                  </form>

                  {/* Prediction assessment display */}
                  <div className="bg-neutral-950 border border-neutral-800 p-4 font-mono text-[11px] min-h-[140px] flex flex-col justify-between">
                    {!metaLabelPrediction ? (
                      <div className="text-neutral-600 text-center text-xs py-8 font-mono">
                        Waiting for prediction trigger...
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between items-center border-b border-neutral-900 pb-2 mb-2">
                          <span className="text-[9px] text-neutral-500 uppercase font-black">AI VERDICT RATING</span>
                          <span className={`px-2 py-0.5 text-[10px] font-black uppercase border rounded ${
                            metaLabelPrediction.rating === 'TAKE'
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
                              : 'bg-red-500/15 text-red-400 border-red-500/20 animate-pulse'
                          }`}>
                            {metaLabelPrediction.rating || 'SKIP'}
                          </span>
                        </div>
                        <p className="text-neutral-300 leading-relaxed text-[11px]">
                          {metaLabelPrediction.explanation}
                        </p>
                        <div className="text-[9px] text-neutral-500 flex justify-between mt-2 pt-2 border-t border-neutral-900">
                          <span>PROBABILITY SCORE:</span>
                          <span className="font-bold text-white">{metaLabelPrediction.probabilityScore || '0.0'}%</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Dead-man's heartbeats & alarms */}
                <div className="bg-neutral-900 border border-neutral-800 p-5 flex flex-col gap-4 font-mono text-[11px]">
                  <h3 className="text-xs font-black text-neutral-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Cpu className="w-4 h-4 text-amber-500" />
                    Feeder Ops Monitoring
                  </h3>

                  <div className="space-y-3">
                    <div className="bg-neutral-950 p-3 border border-neutral-800 flex justify-between items-center">
                      <div>
                        <span className="text-white font-bold block">Dead-Man's Switch</span>
                        <span className="text-[10px] text-neutral-500">Auto-disarms EA on silent feeder</span>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                        DISARM SAFE
                      </span>
                    </div>

                    <div className="bg-neutral-950 p-3 border border-neutral-800 flex justify-between items-center">
                      <div>
                        <span className="text-white font-bold block">Telegram Bot Alerts</span>
                        <span className="text-[10px] text-neutral-500">Live operational error alerts</span>
                      </div>
                      <span className="text-[10px] font-bold text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded">
                        STANDBY
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* CORE SYSTEM STATUS FOOTER */}
      <footer className="bg-neutral-900 px-6 py-4 border-t border-neutral-800 flex flex-col md:flex-row justify-between items-center gap-4 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-neutral-500 font-bold">
          <span className="text-amber-500">XAUUSD SYSTEM RATE: ${goldPrice}</span>
          <span>•</span>
          <span>AUTOPILOT BOT: ENABLED</span>
          <span>•</span>
          <span>LOGS BUFFER: {logs.length}/100</span>
        </div>
        <div className="text-neutral-500 flex gap-3 text-[10px] uppercase">
          <span>PLATFORM: V2.4.0-STABLE</span>
          <span>|</span>
          <span>USER: {`moezaka@gmail.com`}</span>
        </div>
      </footer>

      {/* CUSTOM DIALOG MODAL (REPLACES prompt, confirm, alert) */}
      {dialog.isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-neutral-950 border border-neutral-800 w-full max-w-md p-6 relative flex flex-col gap-4 shadow-2xl">
            <button 
              onClick={() => {
                if (dialog.onCancel) dialog.onCancel();
                else setDialog(prev => ({ ...prev, isOpen: false }));
              }}
              className="absolute top-4 right-4 text-neutral-500 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2.5 border-b border-neutral-800 pb-3">
              {dialog.type === 'alert' ? (
                <Info className="w-5 h-5 text-amber-500" />
              ) : dialog.type === 'confirm' ? (
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              ) : (
                <HelpCircle className="w-5 h-5 text-amber-500" />
              )}
              <h3 className="text-sm font-black text-white uppercase tracking-widest">{dialog.title}</h3>
            </div>

            <p className="text-xs text-neutral-300 leading-relaxed font-sans">{dialog.message}</p>

            {dialog.type === 'prompt' && (
              <div className="mt-2">
                <input
                  type="text"
                  value={dialogInputValue}
                  onChange={(e) => setDialogInputValue(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-800 text-sm px-3 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (dialog.onConfirm) dialog.onConfirm(dialogInputValue);
                    }
                  }}
                />
              </div>
            )}

            <div className="flex justify-end gap-3 mt-4 pt-3 border-t border-neutral-800">
              {dialog.type !== 'alert' && (
                <button
                  onClick={() => {
                    if (dialog.onCancel) dialog.onCancel();
                    else setDialog(prev => ({ ...prev, isOpen: false }));
                  }}
                  className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white text-xs font-bold uppercase tracking-wider border border-neutral-800 transition-colors cursor-pointer"
                >
                  {dialog.cancelText || 'Cancel'}
                </button>
              )}
              <button
                onClick={() => {
                  if (dialog.onConfirm) {
                    if (dialog.type === 'prompt') {
                      dialog.onConfirm(dialogInputValue);
                    } else {
                      dialog.onConfirm();
                    }
                  }
                }}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer"
              >
                {dialog.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
