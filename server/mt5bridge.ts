/**
 * mt5bridge.ts — server side of the MoebyBridge EA command-poller.
 *
 * Replaces the local REST bridge / MT5Client "endpoint guessing" pattern.
 * The EA polls OUTBOUND: GET /bridge/commands, POST /bridge/results,
 * POST /bridge/heartbeat. Nothing connects INTO the MT5 machine.
 *
 * Wire protocol (text/plain, pipe-delimited):
 *   -> EA :  CMD|id|action|symbol|volume|sl|tp|price|comment
 *   <- EA :  RES|id|status|ticket|fillPrice|message
 *   <- EA :  HB|equity|balance|freeMargin|openPositions|armed
 *            POS|symbol|side|volume|entry|sl|tp|pnl|ticket
 *
 * Install (server.ts):
 *   import { registerMt5BridgeRoutes, enqueueMt5Command, getBridgeStatus } from './server/mt5bridge.js';
 *   registerMt5BridgeRoutes(app);   // BEFORE app.use('/api', apiAuthMiddleware) is irrelevant —
 *                                   // routes live under /bridge/* with their own token auth.
 *
 * Env:
 *   MT5_BRIDGE_TOKEN — shared secret; must equal the EA's InpBridgeToken input.
 */

import type { Express, Request, Response, NextFunction } from 'express';
import express from 'express';
import crypto from 'crypto';
import { Database } from './db.js';

export type BridgeAction = 'BUY' | 'SELL' | 'CLOSE' | 'MODIFY' | 'FLATTEN' | 'PING';
export type BridgeCommandStatus = 'pending' | 'claimed' | 'done' | 'failed' | 'rejected_disarmed' | 'skipped' | 'expired';

export interface BridgeCommand {
  id: string;
  action: BridgeAction;
  symbol: string;
  volume: number;
  sl?: number;
  tp?: number;
  price?: number;
  comment?: string;
  status: BridgeCommandStatus;
  createdAt: number;   // epoch ms
  claimedAt?: number;
  resolvedAt?: number;
  ticket?: string;
  fillPrice?: number;
  message?: string;
  sourceLogId?: string; // link back to the webhook log entry
}

export interface BridgePosition {
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  entry: number;
  sl: number;
  tp: number;
  pnl: number;
  ticket: string;
}

export interface BridgeStatus {
  connected: boolean;          // heartbeat within the last 90 s
  lastHeartbeat: number | null;
  armed: boolean;
  equity: number | null;
  balance: number | null;
  freeMargin: number | null;
  positions: BridgePosition[];
  queueDepth: number;
  price: number | null;        // live gold bid from the terminal, 0/null if unavailable
  priceSymbol: string | null;  // the MT5 symbol that price came from (e.g. XAUUSD)
}

// ---------------------------------------------------------------------------
// State. Commands are kept in memory AND mirrored into the Database blob so a
// server restart does not orphan claimed commands. (When you migrate db.json
// to Firestore, this mirror comes along for free.)
// ---------------------------------------------------------------------------

const CLAIM_TIMEOUT_MS = 30_000;   // re-serve commands claimed but never acked
const COMMAND_TTL_MS = 5 * 60_000; // stale pending commands expire (never trade old signals)
const RESULT_KEEP = 200;

let queue: BridgeCommand[] = [];
let heartbeat: { at: number; equity: number; balance: number; freeMargin: number; armed: boolean; positions: BridgePosition[]; price: number; priceSymbol: string } | null = null;

function persist() {
  const db = Database.get() as any;
  db.bridgeQueue = queue.slice(-RESULT_KEEP);
  Database.save(db);
}

function restore() {
  const db = Database.get() as any;
  if (Array.isArray(db.bridgeQueue)) queue = db.bridgeQueue;
}
restore();

// ---------------------------------------------------------------------------
// Public API for the rest of the server
// ---------------------------------------------------------------------------

/**
 * Enqueue a command for the terminal. Returns the command (status 'pending').
 * The webhook handler's MT5 branch should call THIS instead of MT5Client.
 */
export function enqueueMt5Command(params: {
  action: BridgeAction;
  symbol: string;
  volume?: number;
  sl?: number;
  tp?: number;
  price?: number;
  comment?: string;
  idempotencyKey?: string;   // e.g. TradingView alert id — duplicate keys are dropped
  sourceLogId?: string;
}): BridgeCommand {
  expireStale();

  // Idempotency: identical key already queued/executed within TTL → return it, don't double-fire
  if (params.idempotencyKey) {
    const dup = queue.find(c => c.id === params.idempotencyKey);
    if (dup) return dup;
  }

  const cmd: BridgeCommand = {
    id: params.idempotencyKey || crypto.randomUUID(),
    action: params.action,
    symbol: params.symbol,
    volume: params.volume ?? 0,
    sl: params.sl,
    tp: params.tp,
    price: params.price,
    comment: (params.comment || 'moeby').replace(/[|\n]/g, ' ').slice(0, 40),
    status: 'pending',
    createdAt: Date.now(),
    sourceLogId: params.sourceLogId,
  };
  queue.push(cmd);
  persist();
  return cmd;
}

export function getBridgeStatus(): BridgeStatus {
  expireStale();
  const fresh = heartbeat !== null && Date.now() - heartbeat.at < 90_000;
  return {
    connected: fresh,
    lastHeartbeat: heartbeat?.at ?? null,
    armed: fresh ? heartbeat!.armed : false,
    equity: heartbeat?.equity ?? null,
    balance: heartbeat?.balance ?? null,
    freeMargin: heartbeat?.freeMargin ?? null,
    positions: heartbeat?.positions ?? [],
    queueDepth: queue.filter(c => c.status === 'pending' || c.status === 'claimed').length,
    price: fresh && heartbeat!.price > 0 ? heartbeat!.price : null,
    priceSymbol: fresh && heartbeat!.priceSymbol ? heartbeat!.priceSymbol : null,
  };
}

export function getCommand(id: string): BridgeCommand | undefined {
  return queue.find(c => c.id === id);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function expireStale() {
  const now = Date.now();
  let dirty = false;
  for (const c of queue) {
    if (c.status === 'claimed' && c.claimedAt && now - c.claimedAt > CLAIM_TIMEOUT_MS) {
      c.status = 'pending'; // EA died mid-claim; re-serve (EA-side done-id memory dedupes)
      c.claimedAt = undefined;
      dirty = true;
    }
    if (c.status === 'pending' && now - c.createdAt > COMMAND_TTL_MS) {
      c.status = 'expired';
      c.message = 'Expired before the terminal picked it up — never trade stale signals.';
      c.resolvedAt = now;
      dirty = true;
      Database.addLog({
        rawBody: { bridgeCommand: c.id },
        status: 'execution_failed',
        action: c.action === 'BUY' ? 'buy' : c.action === 'SELL' ? 'sell' : 'close',
        symbol: c.symbol,
        price: c.price || 0,
        quantity: c.volume,
        message: `[Bridge] Command ${c.id.slice(0, 8)} expired after ${COMMAND_TTL_MS / 1000}s — MT5 terminal offline?`,
        mode: 'live',
      });
    }
  }
  if (dirty) persist();
}

function fmtCommand(c: BridgeCommand): string {
  return [
    'CMD', c.id, c.action, c.symbol,
    (c.volume ?? 0).toFixed(2),
    (c.sl ?? 0).toFixed(2),
    (c.tp ?? 0).toFixed(2),
    (c.price ?? 0).toFixed(2),
    c.comment ?? '',
  ].join('|');
}

function bridgeAuth(req: Request, res: Response, next: NextFunction) {
  // Trim both sides: a secret pasted into the Secret Manager console, or generated on a
  // CRLF shell, picks up trailing whitespace that is invisible in every UI that shows it.
  const expected = (process.env.MT5_BRIDGE_TOKEN || '').trim();
  if (!expected) {
    return res.status(503).send('MT5_BRIDGE_TOKEN not configured on server');
  }
  const got = String(req.headers['x-bridge-token'] || req.query.token || '').trim();
  // constant-time compare
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).send('Unauthorized');
  }
  next();
}

// ---------------------------------------------------------------------------
// Routes (mounted at /bridge/* — separate from /api/* and its middleware)
// ---------------------------------------------------------------------------

export function registerMt5BridgeRoutes(app: Express) {
  const text = express.text({ type: '*/*', limit: '64kb' });

  /** Dynamically generate and serve startup.ini for headless MT5 terminal automation */
  app.get('/bridge/download/ini', bridgeAuth, (req, res) => {
    const symbol = String(req.query.symbol || 'XAUUSD');
    const period = String(req.query.period || 'M15');
    const login = String(req.query.login || 'YOUR_MT5_LOGIN');
    const password = String(req.query.password || 'YOUR_MT5_PASSWORD');
    const serverName = String(req.query.server || 'YOUR_BROKER_SERVER');

    const iniContent = [
      '[Common]',
      `Login=${login}`,
      `Password=${password}`,
      `Server=${serverName}`,
      'AutoConfiguration=true',
      'ProxyEnable=false',
      'KeepPassword=true',
      '',
      '[Charts]',
      'Profile=default',
      'MaxBars=100000',
      '',
      '[Experts]',
      'AllowLiveTrading=true',
      'AllowDllImport=true',
      'Enabled=true',
      '',
      '[Startup]',
      `Symbol=${symbol}`,
      `Period=${period}`,
      'Template=',
      'Expert=MoebyBridge',
      'ExpertParameters=MoebyBridge.set',
      ''
    ].join('\r\n');

    res.setHeader('Content-Disposition', 'attachment; filename="startup.ini"');
    res.type('text/plain').send(iniContent);
  });

  /** Dynamically generate and serve MoebyBridge.set inputs */
  app.get('/bridge/download/set', bridgeAuth, (req, res) => {
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const host = req.get('host');
    const serverUrl = `${protocol}://${host}`;
    const token = process.env.MT5_BRIDGE_TOKEN || 'CHANGE_ME';
    const pollMs = String(req.query.pollMs || '1000');
    const hbSec = String(req.query.hbSec || '20');
    const magic = String(req.query.magic || '880088');
    const maxVol = String(req.query.maxVol || '0.10');
    const allowedSymbols = String(req.query.allowedSymbols || 'XAUUSD,XAUUSDT');
    const slippage = String(req.query.slippage || '30');
    const armedOnStart = String(req.query.armed || 'true');

    const setContent = [
      `InpServerURL=${serverUrl}`,
      `InpBridgeToken=${token}`,
      `InpPollMs=${pollMs}`,
      `InpHeartbeatSec=${hbSec}`,
      `InpMagic=${magic}`,
      `InpMaxVolume=${maxVol}`,
      `InpSymbolAllow=${allowedSymbols}`,
      `InpSlippagePts=${slippage}`,
      `InpArmedOnStart=${armedOnStart}`,
      ''
    ].join('\r\n');

    res.setHeader('Content-Disposition', 'attachment; filename="MoebyBridge.set"');
    res.type('text/plain').send(setContent);
  });

  /** EA polls for work. Serves pending commands and marks them claimed. */
  app.get('/bridge/commands', bridgeAuth, (_req, res) => {
    expireStale();
    const pending = queue.filter(c => c.status === 'pending').slice(0, 10);
    if (pending.length === 0) return res.type('text/plain').send('EMPTY');
    const now = Date.now();
    for (const c of pending) { c.status = 'claimed'; c.claimedAt = now; }
    persist();
    res.type('text/plain').send(pending.map(fmtCommand).join('\n'));
  });

  /** EA reports execution results. */
  app.post('/bridge/results', bridgeAuth, text, (req, res) => {
    const body = String(req.body || '');
    let acked = 0;
    for (const line of body.split('\n')) {
      const f = line.trim().split('|');
      if (f.length < 3 || f[0] !== 'RES') continue;
      const [, id, status, ticket, fillPrice, ...msg] = f;
      const cmd = queue.find(c => c.id === id);
      if (!cmd) continue;
      cmd.status = (['done', 'failed', 'rejected_disarmed', 'skipped'].includes(status) ? status : 'failed') as BridgeCommandStatus;
      cmd.ticket = ticket && ticket !== '0' ? ticket : undefined;
      cmd.fillPrice = parseFloat(fillPrice) || undefined;
      cmd.message = msg.join('|');
      cmd.resolvedAt = Date.now();
      acked++;

      Database.addLog({
        rawBody: { bridgeCommand: cmd.id, result: line.trim() },
        status: cmd.status === 'done' ? 'success' : 'execution_failed',
        action: cmd.action === 'BUY' ? 'buy' : cmd.action === 'SELL' ? 'sell' : 'close',
        symbol: cmd.symbol,
        price: cmd.fillPrice || cmd.price || 0,
        quantity: cmd.volume,
        message: `[Bridge] ${cmd.action} ${cmd.symbol} → ${cmd.status}${cmd.ticket ? ` (ticket ${cmd.ticket})` : ''}: ${cmd.message}`,
        mode: 'live',
      });
    }
    persist();
    res.type('text/plain').send(`ACK ${acked}`);
  });

  /** EA heartbeat: account snapshot + open positions. */
  app.post('/bridge/heartbeat', bridgeAuth, text, (req, res) => {
    const body = String(req.body || '');
    const positions: BridgePosition[] = [];
    let hbLine: string[] | null = null;

    for (const line of body.split('\n')) {
      const f = line.trim().split('|');
      if (f[0] === 'HB') hbLine = f;
      if (f[0] === 'POS' && f.length >= 9) {
        positions.push({
          symbol: f[1],
          side: f[2] === 'sell' ? 'sell' : 'buy',
          volume: parseFloat(f[3]) || 0,
          entry: parseFloat(f[4]) || 0,
          sl: parseFloat(f[5]) || 0,
          tp: parseFloat(f[6]) || 0,
          pnl: parseFloat(f[7]) || 0,
          ticket: f[8],
        });
      }
    }

    if (hbLine) {
      heartbeat = {
        at: Date.now(),
        equity: parseFloat(hbLine[1]) || 0,
        balance: parseFloat(hbLine[2]) || 0,
        freeMargin: parseFloat(hbLine[3]) || 0,
        armed: hbLine[5] === 'armed',
        positions,
        // Fields 6/7 added later; older EAs omit them, so default safely.
        price: parseFloat(hbLine[6]) || 0,
        priceSymbol: (hbLine[7] || '').trim(),
      };
    }
    res.type('text/plain').send('ACK');
  });

  /** UI/status endpoint — mount under /api so the existing apiAuthMiddleware guards it. */
  app.get('/api/bridge/status', (_req, res) => {
    res.json(getBridgeStatus());
  });
}
