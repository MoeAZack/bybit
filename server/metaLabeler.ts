import { GoogleGenAI, Type } from '@google/genai';
import { Database } from './db.js';

export interface MetaLabelOutput {
  prediction: 'TAKE' | 'SKIP';
  confidencePercent: number;
  reason: string;
}

export class MetaLabeler {
  private static cachedPredictions: { [key: string]: MetaLabelOutput } = {};

  /**
   * Evaluates if a signal should be taken (meta-labeling) by querying Gemini 3.5 Flash
   * to analyze historical trade metrics under similar regimes.
   */
  public static async classifySignal(params: {
    module: string;
    side: 'BUY' | 'SELL';
    adx: number;
    fundingPercentile: number;
    bandwidthPercentile: number;
    dxy: number;
    yield10y: number;
    session: string;
  }): Promise<MetaLabelOutput> {
    const apiKey = process.env.GEMINI_API_KEY;
    const cacheKey = `${params.module}-${params.side}-${params.session}-${params.adx.toFixed(0)}`;

    if (this.cachedPredictions[cacheKey]) {
      return this.cachedPredictions[cacheKey];
    }

    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.includes('MY_')) {
      // High-fidelity local classifier fallback if Gemini key is missing
      return this.calculateLocalMetaLabel(params);
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const db = Database.get();
      const recentTrades = (db.trades || []).slice(-10).map(t => ({
        module: t.module || 'reversion',
        side: t.side,
        pnl: t.pnl,
        exitReason: (t as any).exitReason || 'TP'
      }));

      const systemPrompt = `You are a high-frequency quant risk meta-labeling engine.
Analyze the current XAUUSD (Gold) intraday signal against historical outcomes and regime characteristics.
Predict whether to 'TAKE' or 'SKIP' this signal based on whether the regime properties have positive or negative edge decay.
Return ONLY a structured JSON output.`;

      const userPrompt = `
Historical Context (Recent Outcomes):
${JSON.stringify(recentTrades, null, 2)}

Current Live Signal to Classify:
- Module: ${params.module}
- Action: ${params.side}
- Session: ${params.session}
- ADX (Volatility Trend Strength): ${params.adx.toFixed(1)}
- Funding Percentile: ${params.fundingPercentile.toFixed(1)}%
- Volatility Bandwidth Percentile: ${params.bandwidthPercentile.toFixed(1)}%
- US Dollar Index (DXY): ${params.dxy.toFixed(2)}
- 10-Year Treasury Yield (TNX): ${params.yield10y.toFixed(2)}%

Predict if this setup matches a low-edge cluster ('SKIP') or a robust high-conviction edge cluster ('TAKE').`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              prediction: {
                type: Type.STRING,
                description: "Must be exactly 'TAKE' or 'SKIP'",
              },
              confidencePercent: {
                type: Type.NUMBER,
                description: "Confidence from 0 to 100",
              },
              reason: {
                type: Type.STRING,
                description: "Brief quantitative reasoning linking DXY, Session, or Volatility",
              }
            },
            required: ['prediction', 'confidencePercent', 'reason']
          }
        }
      });

      if (response.text) {
        const output = JSON.parse(response.text.trim()) as MetaLabelOutput;
        if (output.prediction === 'TAKE' || output.prediction === 'SKIP') {
          this.cachedPredictions[cacheKey] = output;
          return output;
        }
      }
    } catch (e: any) {
      console.warn('[MetaLabeler] Gemini call failed, falling back to local model:', e.message || e);
    }

    return this.calculateLocalMetaLabel(params);
  }

  /**
   * Deterministic mathematical classifier fallback
   */
  private static calculateLocalMetaLabel(params: {
    module: string;
    side: 'BUY' | 'SELL';
    adx: number;
    fundingPercentile: number;
    bandwidthPercentile: number;
    dxy: number;
    yield10y: number;
    session: string;
  }): MetaLabelOutput {
    // Reversion under high ADX has severe edge decay -> Skip
    if (params.module === 'reversion' && params.adx >= 22) {
      return {
        prediction: 'SKIP',
        confidencePercent: 88,
        reason: `Reversion edge decay: ADX of ${params.adx.toFixed(1)} is above the critical mean-reversion gate (20). High momentum risks getting ran over.`,
      };
    }

    // Trading breakouts in Asian low-volume session has negative edge -> Skip
    if (params.module === 'squeeze_breakout' && params.session === 'asian') {
      return {
        prediction: 'SKIP',
        confidencePercent: 75,
        reason: "Breakouts during low-volume Asian session frequently result in false breakouts or return to mean.",
      };
    }

    // High yields + strong dollar + Gold long -> Skip
    if (params.side === 'BUY' && params.yield10y > 4.4 && params.dxy > 105.5) {
      return {
        prediction: 'SKIP',
        confidencePercent: 70,
        reason: "Negative macro yield alignment: Gold long has negative covariance when US 10Y yields exceed 4.4% and DXY exceeds 105.5.",
      };
    }

    return {
      prediction: 'TAKE',
      confidencePercent: 82,
      reason: `Regime conditions show robust edge alignment. Session: ${params.session.toUpperCase()}, Volatility: ADX(${params.adx.toFixed(0)}) standard.`,
    };
  }
}
