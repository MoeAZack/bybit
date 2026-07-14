import crypto from 'crypto';

export interface BybitConfig {
  apiKey: string;
  apiSecret: string;
  isTestnet: boolean;
}

export class BybitClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private recvWindow: number = 10000;

  constructor(config: BybitConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.isTestnet
      ? 'https://api-testnet.bybit.com'
      : 'https://api.bybit.com';
  }

  private generateSignature(timestamp: number, paramStr: string): string {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(timestamp + this.apiKey + this.recvWindow + paramStr)
      .digest('hex');
  }

  private async request(method: 'GET' | 'POST', path: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.apiKey || !this.apiSecret) {
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

    const signature = this.generateSignature(timestamp, signatureStr);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-BAPI-API-KEY': this.apiKey,
      'X-BAPI-TIMESTAMP': String(timestamp),
      'X-BAPI-SIGN': signature,
      'X-BAPI-RECV-WINDOW': String(this.recvWindow),
    };

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
      console.error(`Bybit client request to ${path} failed:`, e);
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
      console.error('Failed to get Bybit positions:', e);
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
  }): Promise<any> {
    const orderParams: Record<string, any> = {
      category: 'linear',
      symbol: params.symbol,
      side: params.side,
      orderType: params.orderType || 'Market',
      qty: params.qty,
      timeInForce: 'GTC',
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

    try {
      return await this.request('POST', '/v5/order/create', orderParams);
    } catch (e: any) {
      console.error('Failed to place Bybit order:', e);
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
      console.error(`Failed to get Bybit ticker for ${symbol}:`, e);
      throw e;
    }
  }
}
