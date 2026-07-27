import { calculateADXArray, calculateBollingerBands, calculateATR, calculateRSI } from './indicators.js';

export interface QuantMetrics {
  timestamp: string;
  // null == genuinely unavailable. Consumers MUST treat null as "unknown" and skip the
  // corresponding gate rather than substituting a default; these values gate trade validation.
  fundingRate: number | null;
  openInterest: number | null;
  liquidationsUsd: number | null;
  dxyPrice: number | null;
  yield10y: number | null;
  regime: 'trend' | 'range' | 'compressed' | 'funding_extreme' | 'neutral';
  adx: number;
  fundingPercentile: number | null;
  bandwidthPercentile: number;
}

export interface MacroChartData {
  time: string;
  dxy: number;
  yield10y: number;
}

/** How long a last-known-good macro reading stays usable before it is considered stale. */
const MACRO_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class QuantDataManager {
  // Last-known-good REAL values only. null = never successfully fetched. These are
  // deliberately not seeded with plausible-looking constants: a fabricated DXY/yield is
  // indistinguishable from a real one downstream, and this data gates trade validation.
  private static cachedDxy: number | null = null;
  private static cached10y: number | null = null;
  private static cachedFunding: number | null = null;
  private static cachedOi: number | null = null;
  private static dxyAt = 0;
  private static tnxAt = 0;

  private static fresh(at: number): boolean {
    return at > 0 && Date.now() - at < MACRO_TTL_MS;
  }

  /**
   * Fetch DXY index from public chart endpoint.
   * Returns a real value, a recent cached real value, or null — never an invented number.
   */
  public static async fetchDXYPrice(): Promise<number | null> {
    try {
      const response = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=15m&range=1d', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (response.ok) {
        const json = await response.json();
        const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (Number.isFinite(Number(price))) {
          this.cachedDxy = Number(price);
          this.dxyAt = Date.now();
          return this.cachedDxy;
        }
      }
    } catch (e) {
      // fall through to cache
    }
    return this.fresh(this.dxyAt) ? this.cachedDxy : null;
  }

  /**
   * Fetch 10-Year Treasury Yield from public chart endpoint.
   * Same contract as fetchDXYPrice: real, recent-real, or null.
   */
  public static async fetch10YTYield(): Promise<number | null> {
    try {
      const response = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/^TNX?interval=15m&range=1d', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (response.ok) {
        const json = await response.json();
        const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (Number.isFinite(Number(price))) {
          this.cached10y = Number(price);
          this.tnxAt = Date.now();
          return this.cached10y;
        }
      }
    } catch (e) {
      // fall through to cache
    }
    return this.fresh(this.tnxAt) ? this.cached10y : null;
  }

  /**
   * Fetch live macro chart data for the last 24 hours
   */
  public static async fetchMacroCharts(): Promise<MacroChartData[]> {
    const dataPoints: MacroChartData[] = [];
    const now = Date.now();
    try {
      const dxyRes = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=15m&range=1d', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const tnxRes = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/^TNX?interval=15m&range=1d', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (dxyRes.ok && tnxRes.ok) {
        const dxyJson = await dxyRes.json();
        const tnxJson = await tnxRes.json();

        const dxyQuotes = dxyJson?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
        const tnxQuotes = tnxJson?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
        const timestamps = dxyJson?.chart?.result?.[0]?.timestamp || [];

        for (let i = 0; i < timestamps.length; i++) {
          const dxy = Number(dxyQuotes[i]);
          const yield10y = Number(tnxQuotes[i]);
          // Only emit points where BOTH series carry a real reading. Gaps are dropped
          // rather than back-filled, so the chart shows what actually happened.
          if (!Number.isFinite(dxy) || !Number.isFinite(yield10y)) continue;
          dataPoints.push({ time: new Date(timestamps[i] * 1000).toISOString(), dxy, yield10y });
        }
      }
    } catch (e) {
      console.warn('[QuantData] Macro chart fetch failed — returning empty series (no synthetic fill).');
    }

    // NO synthetic fallback. An empty series means "macro unavailable" and every consumer
    // must treat it that way. Fabricating a Math.sin() walk here previously fed invented
    // DXY/yield values into MetaLabeler trade validation.
    return dataPoints;
  }

  /**
   * Fetch funding rate history and open interest from Bybit
   */
  public static async fetchBybitQuantData(symbol: string): Promise<{
    fundingRate: number | null;
    openInterest: number | null;
    liquidationsUsd: number | null;
    fundingPercentile: number | null;
  }> {
    let fundingPercentile: number | null = null;
    try {
      // Funding rate + history. Pull a real window so the percentile is measured, not guessed.
      const fundResponse = await fetch(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${symbol}&limit=200`);
      if (fundResponse.ok) {
        const json = await fundResponse.json();
        const list = json?.result?.list;
        if (json.retCode === 0 && Array.isArray(list) && list.length > 0) {
          const rates = list
            .map((r: any) => parseFloat(r.fundingRate))
            .filter((n: number) => Number.isFinite(n));
          if (rates.length > 0) {
            this.cachedFunding = rates[0]; // list is newest-first
            if (rates.length >= 20) {
              const below = rates.filter((r: number) => r <= rates[0]).length;
              fundingPercentile = (below / rates.length) * 100;
            }
          }
        }
      }

      // Fetch Open Interest
      const oiResponse = await fetch(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=15m&limit=5`);
      if (oiResponse.ok) {
        const json = await oiResponse.json();
        const oi = parseFloat(json?.result?.list?.[0]?.openInterest);
        if (json.retCode === 0 && Number.isFinite(oi)) this.cachedOi = oi;
      }
    } catch (e) {
      console.warn('[QuantData] Bybit quant fetch failed — reporting nulls, not estimates.');
    }

    return {
      fundingRate: this.cachedFunding,
      openInterest: this.cachedOi,
      // Bybit has no public liquidation endpoint here. Previously this was
      // Math.random() * 250000 presented as a "high fidelity estimation".
      // Report null (unknown) rather than an invented figure.
      liquidationsUsd: null,
      fundingPercentile,
    };
  }

  /**
   * Enriches raw klines with DXY, 10Y Yield, Bybit funding rate and open interest, and applies the regime tagger
   */
  public static async enrichAndTagKlines(symbol: string, klines: any[]): Promise<any[]> {
    if (klines.length === 0) return [];

    const closes = klines.map(k => k.close || k.c);
    const highs = klines.map(k => k.high || k.h);
    const lows = klines.map(k => k.low || k.l);

    const adxArray = calculateADXArray(highs, lows, closes, 14);
    const bbArray = calculateBollingerBands(closes, 20, 2.0);
    const atrArray = calculateATR(highs, lows, closes, 14);

    const enriched: any[] = [];
    const now = Date.now();

    // Fetch macro data and bybit info
    const dxy = await this.fetchDXYPrice();
    const yield10y = await this.fetch10YTYield();
    const bybitData = await this.fetchBybitQuantData(symbol);

    // Calculate bandwidth percentiles historically to find squeezes
    const bandwidths: number[] = bbArray.map(b => (b.upper - b.lower) / (b.middle || 1));

    for (let i = 0; i < klines.length; i++) {
      const k = klines[i];
      const close = closes[i];
      const adx = adxArray[i] ?? 22;
      const bb = bbArray[i];
      const atr = atrArray[i] ?? (close * 0.002);

      const bandwidth = bandwidths[i] || 0.01;
      
      // Calculate local rolling bandwidth rank for compression detection
      const lookback = bandwidths.slice(Math.max(0, i - 100), i + 1);
      const sorted = [...lookback].sort((a, b) => a - b);
      const rank = sorted.indexOf(bandwidth);
      const bandwidthPercentile = lookback.length > 0 ? (rank / lookback.length) * 100 : 50;

      // Real measured funding percentile (from Bybit funding history), or null when the
      // feed is unavailable. Previously this was Math.sin(i/15) — a fabricated oscillation
      // that could trip the funding_extreme regime and greenlight trades on invented data.
      const fundingPercentile = bybitData.fundingPercentile;

      // Determine active regime module. The funding_extreme branch requires a REAL
      // percentile; with no funding data we fall through to price-based regimes.
      let regime: QuantMetrics['regime'] = 'neutral';
      if (fundingPercentile !== null && (fundingPercentile > 90 || fundingPercentile < 10)) {
        regime = 'funding_extreme';
      } else if (bandwidthPercentile < 10) {
        regime = 'compressed';
      } else if (adx >= 25) {
        regime = 'trend';
      } else if (adx < 20) {
        regime = 'range';
      }

      // Tag time sessions: London (08:00 - 16:00 UTC), NY (13:00 - 21:00 UTC), Asian (00:00 - 08:00 UTC)
      const kTime = new Date(k.time || k.t || now);
      const hour = kTime.getUTCHours();
      let session = 'asian';
      if (hour >= 8 && hour < 13) {
        session = 'london';
      } else if (hour >= 13 && hour < 17) {
        session = 'overlap';
      } else if (hour >= 17 && hour < 22) {
        session = 'new_york';
      }

      enriched.push({
        ...k,
        adx,
        atr,
        bb,
        bandwidthPercentile,
        fundingPercentile,
        fundingRate: bybitData.fundingRate,
        openInterest: bybitData.openInterest,
        liquidationsUsd: bybitData.liquidationsUsd,
        dxy,
        yield10y,
        regime,
        session,
        timestamp: kTime.toISOString()
      });
    }

    return enriched;
  }
}
