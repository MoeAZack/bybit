/**
 * verify-demo.ts — confirms the demo profile is applied and that the bot refuses to
 * trade until real demo credentials are entered.
 * Run: npx tsx server/verify-demo.ts
 */
import { Database } from './db.js';
import { StrategyRouter } from './strategyRouter.js';
import { resolveAutoMode, venueSymbol, executeBybitSignal } from './signalEngine.js';

const s = Database.get().settings;

console.log('--- DEMO PROFILE ---');
console.log('  venue            :', s.activeBroker, '/', s.bybitEnvironment, '-> symbol', venueSymbol(s));
console.log('  isPaperTrading   :', s.isPaperTrading, '(false = real API calls to api-demo.bybit.com)');
console.log('  autoMode         :', resolveAutoMode(s));
console.log('  circuit breaker  :', s.isCircuitBreakerActive, 'at', s.maxDrawdownPercent + '%');
console.log('  ATR stops        :', s.isDynamicSlActive, 'x' + s.atrMultiplier);
console.log('  order size       :', s.defaultOrderSize);
console.log('  API keys present :', Boolean(s.bybitApiKey && s.bybitApiSecret));

console.log('\n--- SAFETY: must refuse to trade with no credentials ---');
const tripped = StrategyRouter.isDeadManTripped(s);
console.log(`  ${tripped ? 'PASS' : 'FAIL'}  dead-man switch tripped: ${tripped} (expected true)`);

const r = await executeBybitSignal({
  side: 'buy', symbol: venueSymbol(s), price: 4085, quantity: s.defaultOrderSize,
  settings: s, reason: 'safety probe', source: 'auto',
});
console.log(`  ${r.fired ? 'FAIL' : 'PASS'}  order attempt: ${r.fired ? 'FIRED — BAD' : 'BLOCKED -> ' + r.message}`);

const ok = tripped && !r.fired;
console.log(`\n=== ${ok ? 'SAFE — add demo API keys in Settings to enable trading' : 'PROBLEM: bot would trade without credentials'} ===`);
process.exit(ok ? 0 : 1);
