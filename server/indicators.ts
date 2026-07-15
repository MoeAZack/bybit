/**
 * Indicators mathematical library for technical analysis
 */

export function calculateSMA(prices: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      sma.push(prices[i]); // fallback
    } else {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma.push(sum / period);
    }
  }
  return sma;
}

export function calculateEMA(prices: number[], period: number): number[] {
  const ema: number[] = [];
  if (prices.length === 0) return ema;
  const k = 2 / (period + 1);
  let currentEma = prices[0];
  ema.push(currentEma);
  for (let i = 1; i < prices.length; i++) {
    currentEma = prices[i] * k + currentEma * (1 - k);
    ema.push(currentEma);
  }
  return ema;
}

export function calculateRSI(prices: number[], period: number): number[] {
  const rsi: number[] = [];
  if (prices.length < 2) {
    return new Array(prices.length).fill(50);
  }
  let gains = 0;
  let losses = 0;

  const initialPeriod = Math.min(period, prices.length - 1);
  for (let i = 1; i <= initialPeriod; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / (initialPeriod || 1);
  let avgLoss = losses / (initialPeriod || 1);
  
  for (let i = 0; i <= initialPeriod; i++) {
    rsi.push(50);
  }

  for (let i = initialPeriod + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss > 0 ? avgGain / avgLoss : 0;
    const rsiVal = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
    rsi.push(rsiVal);
  }
  
  while (rsi.length < prices.length) {
    rsi.push(50);
  }
  return rsi;
}

export function calculateATR(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const atr: number[] = [];
  if (highs.length === 0) return atr;
  
  const tr: number[] = [highs[0] - lows[0]];
  for (let i = 1; i < highs.length; i++) {
    const tr1 = highs[i] - lows[i];
    const tr2 = Math.abs(highs[i] - closes[i - 1]);
    const tr3 = Math.abs(lows[i] - closes[i - 1]);
    tr.push(Math.max(tr1, tr2, tr3));
  }

  let currentAtr = tr[0];
  atr.push(currentAtr);
  
  for (let i = 1; i < tr.length; i++) {
    currentAtr = (currentAtr * (period - 1) + tr[i]) / period;
    atr.push(currentAtr);
  }
  return atr;
}

export function calculateADXArray(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const adxArray: number[] = new Array(highs.length).fill(22);
  if (highs.length < period * 2) {
    return adxArray;
  }

  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const curHigh = highs[i];
    const curLow = lows[i];
    const prevClose = closes[i - 1];
    const prevHigh = highs[i - 1];
    const prevLow = lows[i - 1];

    const tr1 = curHigh - curLow;
    const tr2 = Math.abs(curHigh - prevClose);
    const tr3 = Math.abs(curLow - prevClose);
    tr.push(Math.max(tr1, tr2, tr3));

    const upMove = curHigh - prevHigh;
    const downMove = prevLow - curLow;

    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
    } else {
      plusDM.push(0);
    }

    if (downMove > upMove && downMove > 0) {
      minusDM.push(downMove);
    } else {
      minusDM.push(0);
    }
  }

  // Wilder smoothing
  const smoothedTR: number[] = [];
  const smoothedPlusDM: number[] = [];
  const smoothedMinusDM: number[] = [];

  let sumTR = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let sumPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let sumMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

  smoothedTR.push(sumTR);
  smoothedPlusDM.push(sumPlusDM);
  smoothedMinusDM.push(sumMinusDM);

  for (let i = period; i < tr.length; i++) {
    const nextTR = smoothedTR[smoothedTR.length - 1] - (smoothedTR[smoothedTR.length - 1] / period) + tr[i];
    const nextPlus = smoothedPlusDM[smoothedPlusDM.length - 1] - (smoothedPlusDM[smoothedPlusDM.length - 1] / period) + plusDM[i];
    const nextMinus = smoothedMinusDM[smoothedMinusDM.length - 1] - (smoothedMinusDM[smoothedMinusDM.length - 1] / period) + minusDM[i];
    smoothedTR.push(nextTR);
    smoothedPlusDM.push(nextPlus);
    smoothedMinusDM.push(nextMinus);
  }

  const plusDI: number[] = [];
  const minusDI: number[] = [];
  const dx: number[] = [];

  for (let i = 0; i < smoothedTR.length; i++) {
    const trVal = smoothedTR[i] || 1;
    const pDI = 100 * (smoothedPlusDM[i] / trVal);
    const mDI = 100 * (smoothedMinusDM[i] / trVal);
    plusDI.push(pDI);
    minusDI.push(mDI);

    const diDiff = Math.abs(pDI - mDI);
    const diSum = pDI + mDI || 1;
    dx.push(100 * (diDiff / diSum));
  }

  let sumDX = dx.slice(0, period).reduce((a, b) => a + b, 0);
  let adx = sumDX / period;
  
  for (let i = 0; i < period + period - 1; i++) {
    adxArray[i] = 22; // default padding
  }
  adxArray[period + period - 1] = adx;

  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
    adxArray[i + period] = adx;
  }

  return adxArray;
}

export interface BollingerBandsResult {
  middle: number;
  upper: number;
  lower: number;
  pctB: number;
}

export function calculateBollingerBands(closes: number[], period: number, stdDevMultiplier: number): BollingerBandsResult[] {
  const results: BollingerBandsResult[] = [];
  const sma = calculateSMA(closes, period);

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      results.push({ middle: closes[i], upper: closes[i], lower: closes[i], pctB: 0.5 });
    } else {
      const mid = sma[i];
      const slice = closes.slice(i - period + 1, i + 1);
      const mean = mid;
      const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
      const stdDev = Math.sqrt(variance);

      const upper = mid + stdDevMultiplier * stdDev;
      const lower = mid - stdDevMultiplier * stdDev;
      const range = upper - lower || 0.01;
      const pctB = (closes[i] - lower) / range;

      results.push({ middle: mid, upper, lower, pctB });
    }
  }

  return results;
}

export interface KlineInput {
  time: Date;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function calculateSessionVWAP(klines: KlineInput[]): number[] {
  const vwap: number[] = [];
  if (klines.length === 0) return vwap;

  let currentDay = klines[0].time.getUTCDate();
  let sumTypicalPriceVol = 0;
  let sumVol = 0;

  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    const kDay = k.time.getUTCDate();

    // Check for daily session boundary reset (UTC 00:00)
    if (kDay !== currentDay) {
      sumTypicalPriceVol = 0;
      sumVol = 0;
      currentDay = kDay;
    }

    const tp = (k.high + k.low + k.close) / 3;
    const vol = k.volume || 1; // avoid 0 volume issues

    sumTypicalPriceVol += tp * vol;
    sumVol += vol;

    vwap.push(sumTypicalPriceVol / (sumVol || 1));
  }

  return vwap;
}
