import crypto from 'crypto';

export interface BybitConfig {
  apiKey: string;
  apiSecret: string;
  environment?: 'demo' | 'testnet' | 'live';
  isTestnet?: boolean;
}

/**
 * Bybit's kline endpoint returns raw arrays [startTime, open, high, low, close, volume, ...]
 * in newest-first order. Indicator code (evaluateSignal, basket manager) expects objects
 * with .time/.open/.high/.low/.close/.volume in chronological order. This converts between
 * them. Passing raw arrays to that code silently yields NaN for every field.
 */
export function normalizeKlines(raw: any[]): Array<{ time: Date; open: number; high: number; low: number; close: number; volume: number }> {
  if (!Array.isArray(raw)) return [];
  return [...raw]
    .map((k: any) => ({
      time: new Date(Number(k[0])),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5] || 0),
    }))
    .filter(k => Number.isFinite(k.close) && Number.isFinite(k.high) && Number.isFinite(k.low))
    .sort((a, b) => a.time.getTime() - b.time.getTime());
}

export class BybitClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private recvWindow: number = 10000;

  constructor(config: BybitConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    const env = config.environment || (config.isTestnet ? 'testnet' : 'demo');
    if (env === 'live') {
      this.baseUrl = 'https://api.bybit.com';
    } else if (env === 'testnet') {
      this.baseUrl = 'https://api-testnet.bybit.com';
    } else {
      this.baseUrl = 'https://api-demo.bybit.com';
    }
  }

  private generateSignature(timestamp: number, paramStr: string): string {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(timestamp + this.apiKey + this.recvWindow + paramStr)
      .digest('hex');
  }

  private async request(method: 'GET' | 'POST', path: string, params: Record<string, any> = {}): Promise<any> {
    const isPublic = path.startsWith('/v5/market/');

    if (!isPublic && (!this.apiKey || !this.apiSecret)) {
      throw new Error('Bybit API Key or Secret is missing in terminal configuration.');
    }

    const timestamp = Date.now();
    let url = `${this.baseUrl}${path}`;
    let signatureStr = '';
    let body: string | undefined = undefined;

    if (method === 'GET') {
      const queryParams = new URLSearchParams();
      Object.entries(params).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
          queryParams.append(key, String(val));
        }
      });
      const queryStr = queryParams.toString();
      if (queryStr) {
        url = `${url}?${queryStr}`;
        signatureStr = queryStr;
      }
    } else {
      body = JSON.stringify(params);
      signatureStr = body;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (!isPublic) {
      const signature = this.generateSignature(timestamp, signatureStr);
      headers['X-BAPI-API-KEY'] = this.apiKey;
      headers['X-BAPI-TIMESTAMP'] = String(timestamp);
      headers['X-BAPI-SIGN'] = signature;
      headers['X-BAPI-RECV-WINDOW'] = String(this.recvWindow);
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP Error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      
      // Bybit API returns standard structure: { retCode: 0, retMsg: "OK", result: {...} }
      if (data.retCode !== 0) {
        throw new Error(`Bybit API Error (Code ${data.retCode}): ${data.retMsg}`);
      }

      return data.result;
    } catch (e: any) {
      const errMsg = e.message || String(e);
      console.warn(`Bybit client request to ${path} failed: ${errMsg}`);
      throw e;
    }
  }

  /**
   * Fetch market klines (candles)
   */
  public async getKlines(params: {
    symbol: string;
    interval: string;
    limit?: number;
    start?: number;
    end?: number;
  }): Promise<any[]> {
    try {
      const queryParams: Record<string, any> = {
        category: 'linear',
        symbol: params.symbol,
        interval: params.interval,
        limit: params.limit || 200,
      };
      if (params.start) queryParams.start = params.start;
      if (params.end) queryParams.end = params.end;

      const result = await this.request('GET', '/v5/market/kline', queryParams);
      return result?.list || [];
    } catch (e: any) {
      console.warn(`Failed to get Bybit klines for ${params.symbol}: ${e.message || String(e)}`);
      throw e;
    }
  }

  /**
   * Fetch klines across an arbitrary date range by paginating backwards (Bybit caps a
   * single call at 1000). Returns candles within [startMs, endMs], de-duplicated and
   * sorted chronologically ascending. Used by the backtester so it can test real months
   * of history and honour walk-forward windows, instead of only the last ~1000 candles.
   */
  public async getKlinesRange(params: {
    symbol: string;
    interval: string;
    startMs: number;
    endMs: number;
    maxCandles?: number;
  }): Promise<any[]> {
    const seen = new Map<number, any>();
    const cap = params.maxCandles || 20000;
    let end = params.endMs;

    for (let i = 0; i < 40; i++) {
      const batch = await this.getKlines({
        symbol: params.symbol,
        interval: params.interval,
        limit: 1000,
        start: params.startMs,
        end,
      });
      if (!batch || batch.length === 0) break;
      for (const k of batch) seen.set(Number(k[0]), k);

      const oldestTs = Math.min(...batch.map((k: any) => Number(k[0])));
      if (oldestTs <= params.startMs || batch.length < 1000 || seen.size >= cap) break;
      end = oldestTs - 1; // step the window further back
    }

    return Array.from(seen.values())
      .filter(k => Number(k[0]) >= params.startMs && Number(k[0]) <= params.endMs)
      .sort((a, b) => Number(a[0]) - Number(b[0]));
  }

  /**
   * Modify Position Stop Loss and Take Profit
   */
  public async setTradingStop(params: {
    symbol: string;
    stopLoss?: string;
    takeProfit?: string;
  }): Promise<any> {
    const stopParams: Record<string, any> = {
      category: 'linear',
      symbol: params.symbol,
      positionIdx: 0,
    };
    if (params.stopLoss) {
      stopParams.stopLoss = params.stopLoss;
      stopParams.slTriggerBy = 'LastPrice';
    }
    if (params.takeProfit) {
      stopParams.takeProfit = params.takeProfit;
      stopParams.tpTriggerBy = 'LastPrice';
    }
    try {
      return await this.request('POST', '/v5/position/set-trading-stop', stopParams);
    } catch (e: any) {
      console.warn(`Failed to update Bybit trading stop for ${params.symbol}: ${e.message || String(e)}`);
      throw e;
    }
  }

  /**
   * Get Unified or Contract wallet balance
   */
  public async getWalletBalance(): Promise<{ balance: number; currency: string; raw: any }> {
    try {
      // For V5 unified account type is UNIFIED, contracts can be CONTRACT
      const result = await this.request('GET', '/v5/account/wallet-balance', {
        accountType: 'UNIFIED',
      });
      
      const list = result?.list?.[0];
      const totalEquities = list?.totalEquity || '0';
      const usdtCoin = list?.coin?.find((c: any) => c.coin === 'USDT');
      const usdtBalance = usdtCoin ? parseFloat(usdtCoin.walletBalance || '0') : parseFloat(totalEquities);

      return {
        balance: usdtBalance || 0,
        currency: 'USDT',
        raw: result,
      };
    } catch (e) {
      console.log('UNIFIED account balance failed, trying CONTRACT account...');
      try {
        const result = await this.request('GET', '/v5/account/wallet-balance', {
          accountType: 'CONTRACT',
        });
        const list = result?.list?.[0];
        const usdtCoin = list?.coin?.find((c: any) => c.coin === 'USDT');
        const balance = usdtCoin ? parseFloat(usdtCoin.walletBalance || '0') : parseFloat(list?.totalEquity || '0');
        return {
          balance: balance || 0,
          currency: 'USDT',
          raw: result,
        };
      } catch (e2: any) {
        throw new Error(`Failed to retrieve Bybit balance: ${e2.message || e2}`);
      }
    }
  }

  /**
   * Get list of open positions
   */
  public async getPositions(symbol?: string): Promise<any[]> {
    try {
      const params: Record<string, any> = {
        category: 'linear',
      };
      if (symbol) {
        params.symbol = symbol;
      }

      const result = await this.request('GET', '/v5/position/list', params);
      return result?.list || [];
    } catch (e: any) {
      console.warn(`Failed to get Bybit positions: ${e.message || String(e)}`);
      throw e;
    }
  }

  /**
   * Place a new linear contract order
   */
  public async placeOrder(params: {
    symbol: string;
    side: 'Buy' | 'Sell';
    qty: string;
    orderType?: 'Market' | 'Limit';
    price?: string;
    stopLoss?: string;
    takeProfit?: string;
    orderLinkId?: string;
    reduceOnly?: boolean;
    triggerPrice?: string;
    triggerDirection?: number;
    triggerBy?: string;
    timeInForce?: 'GTC' | 'IOC' | 'FOK' | 'PostOnly';
  }): Promise<any> {
    const orderParams: Record<string, any> = {
      category: 'linear',
      symbol: params.symbol,
      side: params.side,
      orderType: params.orderType || 'Market',
      qty: params.qty,
      timeInForce: params.timeInForce || 'GTC',
      positionIdx: 0, // 0 for One-way mode, which is recommended
    };

    if (params.price && params.orderType === 'Limit') {
      orderParams.price = params.price;
    }

    if (params.stopLoss) {
      orderParams.stopLoss = params.stopLoss;
      orderParams.slTriggerBy = 'LastPrice';
    }

    if (params.takeProfit) {
      orderParams.takeProfit = params.takeProfit;
      orderParams.tpTriggerBy = 'LastPrice';
    }

    if (params.orderLinkId) {
      orderParams.orderLinkId = params.orderLinkId;
    }

    if (params.reduceOnly) {
      orderParams.reduceOnly = true;
    }

    if (params.triggerPrice) {
      orderParams.triggerPrice = params.triggerPrice;
    }

    if (params.triggerDirection) {
      orderParams.triggerDirection = params.triggerDirection;
    }

    if (params.triggerBy) {
      orderParams.triggerBy = params.triggerBy;
    }

    try {
      return await this.request('POST', '/v5/order/create', orderParams);
    } catch (e: any) {
      console.warn(`Failed to place Bybit order: ${e.message || String(e)}`);
      throw e;
    }
  }

  /**
   * Cancel an open order
   */
  public async cancelOrder(params: {
    symbol: string;
    orderId?: string;
    orderLinkId?: string;
  }): Promise<any> {
    const cancelParams: Record<string, any> = {
      category: 'linear',
      symbol: params.symbol,
    };
    if (params.orderId) cancelParams.orderId = params.orderId;
    if (params.orderLinkId) cancelParams.orderLinkId = params.orderLinkId;
    try {
      return await this.request('POST', '/v5/order/cancel', cancelParams);
    } catch (e: any) {
      console.warn(`Failed to cancel Bybit order: ${e.message || String(e)}`);
      throw e;
    }
  }

  /**
   * Get list of open (active) orders
   */
  public async getOpenOrders(params: {
    symbol: string;
    orderId?: string;
    orderLinkId?: string;
  }): Promise<any[]> {
    const getParams: Record<string, any> = {
      category: 'linear',
      symbol: params.symbol,
    };
    if (params.orderId) getParams.orderId = params.orderId;
    if (params.orderLinkId) getParams.orderLinkId = params.orderLinkId;
    try {
      const result = await this.request('GET', '/v5/order/realtime', getParams);
      return result?.list || [];
    } catch (e: any) {
      console.warn(`Failed to retrieve open Bybit orders: ${e.message || String(e)}`);
      throw e;
    }
  }

  /**
   * Retrieve ticker details (e.g. current market price)
   */
  public async getTicker(symbol: string): Promise<{ lastPrice: number; markPrice: number; raw: any }> {
    try {
      const result = await this.request('GET', '/v5/market/tickers', {
        category: 'linear',
        symbol,
      });
      const ticker = result?.list?.[0];
      return {
        lastPrice: ticker ? parseFloat(ticker.lastPrice || '0') : 0,
        markPrice: ticker ? parseFloat(ticker.markPrice || '0') : 0,
        raw: result,
      };
    } catch (e: any) {
      console.warn(`Failed to get Bybit ticker for ${symbol}: ${e.message || String(e)}`);
      throw e;
    }
  }
}
