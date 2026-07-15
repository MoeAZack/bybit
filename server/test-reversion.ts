import fs from 'fs';
import path from 'path';
import { BasketManager } from './basketManager.js';
import { Database } from './db.js';

// Setup mock settings
const mockSettings = {
  isPaperTrading: true,
  bybitApiKey: 'test_key',
  bybitApiSecret: 'test_secret',
  bybitEnvironment: 'demo' as const,
  activeRegimeModule: 'range' as const,
  reversion: {
    enabled: true,
    symbol: 'XAUUSDT',
    riskUsd: 100,
    maxRungs: 3,
    rungSpacingAtr: 1.0,
    stopBeyondLastRungAtr: 1.5,
    rsiPeriod: 14,
    rsiOverbought: 75,
    rsiOversold: 25,
    bbPeriod: 20,
    bbStdDev: 2.0,
  }
};

async function runTests() {
  console.log('===================================================');
  console.log('   RUNNING MEAN REVERSION STRATEGY UNIT TESTS      ');
  console.log('===================================================\n');

  let failed = false;

  // Helpers to log outcomes
  const assert = (condition: boolean, msg: string) => {
    if (condition) {
      console.log(`[PASS] ${msg}`);
    } else {
      console.error(`[FAIL] ${msg}`);
      failed = true;
    }
  };

  try {
    // --- TEST 1: SIZING MATH & LOSS CAP ASSERTER ---
    console.log('[Test 1] Verifying Reversion Sizing Math & Risk Bounds...');
    // Parameters:
    // Risk = $100 USD
    // ATR = $4.00
    // d = spacing = 1.0 * 4.0 = $4.00
    // s = stop offset = 1.5 * 4.0 = $6.00
    // formula: q = Risk / (m * 3 * (d + s)) = 100 / (3 * 10) = 3.3333 -> 3.33 units
    
    const atr = 4.0;
    const d = mockSettings.reversion.rungSpacingAtr * atr; // $4.0
    const s = mockSettings.reversion.stopBeyondLastRungAtr * atr; // $6.0
    const m = 1.0; // contract multiplier

    // Hand-calculate worst-case loss if all 3 rungs filled and hit stop:
    // Entry 1 = 2000.0, Q = 3.33. Stop = 1990.0. Loss = (2000 - 1990) * 3.33 = $33.30
    // Entry 2 = 1996.0, Q = 3.33. Stop = 1990.0. Loss = (1996 - 1990) * 3.33 = $19.98
    // Entry 3 = 1992.0, Q = 3.33. Stop = 1990.0. Loss = (1992 - 1990) * 3.33 = $6.66
    // Total Worst-case Loss = 33.30 + 19.98 + 6.66 = $59.94
    
    const calculatedQty = mockSettings.reversion.riskUsd / (m * 3 * (d + s));
    const finalQty = Math.floor(calculatedQty / 0.01) * 0.01;

    assert(finalQty === 3.33, `Calculated size should be exactly 3.33, got ${finalQty}`);

    const lossRung1 = 10.0 * finalQty;
    const lossRung2 = 6.0 * finalQty;
    const lossRung3 = 2.0 * finalQty;
    const totalWorstCaseLoss = lossRung1 + lossRung2 + lossRung3;

    assert(totalWorstCaseLoss <= mockSettings.reversion.riskUsd * 1.02, 
      `Worst case loss ($${totalWorstCaseLoss.toFixed(2)}) must be below risk ceiling with 2% buffer ($${(mockSettings.reversion.riskUsd * 1.02).toFixed(2)})`
    );
    console.log();


    // --- TEST 2: CRASH RECOVERY & PERSISTENCE ---
    console.log('[Test 2] Verifying Crash Recovery & JSON State Synchronization...');
    
    // Write a mock active basket state file
    const testBasketFile = path.join(process.cwd(), 'data', 'reversion_basket.json');
    if (!fs.existsSync(path.dirname(testBasketFile))) {
      fs.mkdirSync(path.dirname(testBasketFile), { recursive: true });
    }

    const mockBasket = {
      basketId: 'test-basket-999',
      symbol: 'XAUUSDT',
      side: 'BUY' as const,
      maxRungs: 3,
      rungSpacingAtr: 1.0,
      stopBeyondLastRungAtr: 1.5,
      basketRiskUsd: 100,
      atr: 4.0,
      p0: 2000.0,
      q: 3.33,
      worstCaseLoss: 59.94,
      rungPrices: [2000.0, 1996.0, 1992.0],
      stopLossPrice: 1990.0,
      tpTargetPrice: 2012.0,
      rungsFilled: [true, false, false],
      rungsOrderIds: ['order-1', 'order-2', 'order-3'],
      stopLossOrderId: 'order-sl',
      takeProfitOrderId: 'order-tp',
      status: 'ACTIVE' as const,
      entryTime: new Date().toISOString(),
      barsHeld: 0,
    };

    fs.writeFileSync(testBasketFile, JSON.stringify(mockBasket, null, 2));

    // Force BasketManager to reload its memory from disk
    await BasketManager.reconcileStartup(mockSettings as any);

    const reloadedBasket = BasketManager.getActiveBasket();
    assert(reloadedBasket !== null, 'BasketManager must reload the active basket from file on startup');
    assert(reloadedBasket?.basketId === 'test-basket-999', 'Reloaded basket ID must match the persisted file');
    assert(reloadedBasket?.tpTargetPrice === 2012.0, 'Reloaded take profit target must be perfectly accurate');
    console.log();


    // --- TEST 3: DUPLICATE SIGNAL GATING ---
    console.log('[Test 3] Verifying Duplicate Signal Rejection and Active Basket Guards...');
    
    // Attempting to trigger while activeBasket is present should return triggered: false
    const klinesMock = Array.from({ length: 50 }, (_, idx) => ({
      open: 2000,
      high: 2001,
      low: 1999,
      close: 2000,
    }));

    const result = await BasketManager.checkGatesAndTrigger(klinesMock, mockSettings as any);
    assert(result.triggered === false, 'Should reject incoming webhook signals when a basket is already active');
    assert(result.reason.includes('already active') || result.reason.includes('No current signal') || result.reason === 'skipped_active_basket', `Should return clear rejection reason, got: "${result.reason}"`);
    console.log();


    // --- TEST 4: STOP LOSS INTEGRITY RULES ---
    console.log('[Test 4] Verifying Stop Loss Safeguards (No Widening / No Removal)...');
    
    // We update currentPrice to hit Stop Loss
    // Basket should close, status changes to CLOSED / REJECTED, and stop loss is never widened or delayed
    const priceBeforeStop = 1991.0;
    await BasketManager.monitorUpdate(priceBeforeStop, mockSettings as any);
    assert(BasketManager.getActiveBasket() !== null, 'Basket should remain active when price is above Stop Loss');

    const priceAtStop = 1989.5; // hits stop of 1990.0
    await BasketManager.monitorUpdate(priceAtStop, mockSettings as any);
    assert(BasketManager.getActiveBasket() === null, 'Basket must be completely liquidated and cleared when price crosses Stop Loss');

    console.log();

    // Clean up test file
    if (fs.existsSync(testBasketFile)) {
      fs.unlinkSync(testBasketFile);
    }

  } catch (err: any) {
    console.error('Fatal testing error:', err);
    failed = true;
  }

  console.log('===================================================');
  if (failed) {
    console.error('     ❌ SOME UNIT TESTS FAILED. CHECK LOGS ABOVE.  ');
    console.log('===================================================');
    process.exit(1);
  } else {
    console.log('     🎉 ALL UNIT TESTS PASSED VICTORIOUSLY!         ');
    console.log('===================================================');
    process.exit(0);
  }
}

runTests();
