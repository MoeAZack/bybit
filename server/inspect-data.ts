/**
 * inspect-data.ts — audit a bar source before trusting a backtest run on it.
 *
 * Bad history produces confident, wrong results: duplicates double-count signals, gaps
 * hide drawdowns, and a timezone mistake shifts every session-based entry to the wrong
 * hour while still looking plausible. Run this first.
 *
 *   npx tsx server/inspect-data.ts                                  # Bybit (default)
 *   BACKTEST_CSV=./data/XAUUSD_M15.csv BACKTEST_CSV_TZ_OFFSET_MINS=180 \
 *     npx tsx server/inspect-data.ts --interval 15
 */
import { getDataProvider, assessBars } from './data/index.js';

const argOf = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const symbol = argOf('symbol', process.env.BACKTEST_CSV ? 'XAUUSD' : 'XAUUSDT')!;
const interval = Number(argOf('interval', '15'));
const years = Number(argOf('years', '10'));
const end = Date.now();
const start = end - years * 365 * 86_400_000;

const provider = getDataProvider();
console.log(`\nsource   : ${provider.name}`);
console.log(`symbol   : ${symbol}   interval: ${interval}m`);
console.log(`requested: ${new Date(start).toISOString().slice(0, 10)} -> ${new Date(end).toISOString().slice(0, 10)}\n`);

let bars;
try {
  bars = await provider.getBars(symbol, interval, start, end);
} catch (e: any) {
  console.log(`FAILED: ${e.message}`);
  process.exit(1);
}

const q = assessBars(bars, interval);
console.log(`bars           : ${q.count}`);
console.log(`first          : ${q.firstTime ? new Date(q.firstTime).toISOString().slice(0, 16) : '-'}`);
console.log(`last           : ${q.lastTime ? new Date(q.lastTime).toISOString().slice(0, 16) : '-'}`);
console.log(`span           : ${q.spanDays} days (${(q.spanDays / 365).toFixed(2)} years)`);
console.log(`coverage       : ${q.coveragePercent}% of expected weekday bars`);
console.log(`duplicates     : ${q.duplicates}`);
console.log(`out of order   : ${q.outOfOrder}`);
console.log(`OHLC violations: ${q.ohlcViolations}`);

if (q.gaps.length) {
  console.log(`\nlargest intraday gaps (weekends excluded):`);
  for (const g of q.gaps) console.log(`  ${g.fromIso.slice(0, 16)} -> ${g.toIso.slice(0, 16)}  (${g.missingBars} bars)`);
}

// Sanity-check the timezone by looking at where daily volume actually peaks. Gold's
// busiest hours are the London and NY sessions; if the peak sits in the Asian small
// hours the offset is probably wrong.
if (bars.length > 500 && bars.some(b => b.volume > 0)) {
  const byHour = new Array(24).fill(0);
  for (const b of bars) byHour[new Date(b.time).getUTCHours()] += b.volume;
  const peak = byHour.indexOf(Math.max(...byHour));
  console.log(`\nbusiest UTC hour by volume: ${String(peak).padStart(2, '0')}:00`);
  if (peak >= 12 && peak <= 17) console.log('  consistent with the London/NY overlap — timezone looks right');
  else console.log('  WARNING: gold volume normally peaks 12:00-17:00 UTC. Check BACKTEST_CSV_TZ_OFFSET_MINS.');
}

console.log(q.warnings.length ? `\nWARNINGS:\n  ${q.warnings.join('\n  ')}` : '\nno warnings');
console.log(q.spanDays >= 730 ? '\nUsable for multi-year walk-forward validation.'
                              : '\nToo short for multi-regime validation — export more history.');
