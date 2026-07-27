/**
 * sweep-session.ts — walk-forward test of the session opening-range breakout.
 *
 * Same discipline as the EMA-cross sweep: fit on an in-sample window, score on a later
 * window the config never saw, and rank on OUT-OF-SAMPLE expectancy. A config is only
 * interesting if it is positive out of sample AND took enough trades to mean something.
 *
 * Run: npx tsx server/sweep-session.ts
 */
import { runSessionMomentum, SessionParams, SessionResult } from './strategies/sessionMomentum.js';

const START = Date.parse('2026-01-01T00:00:00Z');
const END = Date.parse('2026-06-30T23:59:59Z');
const SPLIT = 0.7;
const BOUNDARY = START + Math.floor((END - START) * SPLIT);

const baseline: Omit<SessionParams, 'startMs' | 'endMs' | 'sessionOpenUtcHour' | 'rangeBars' | 'rMultiple' | 'stopMode'> = {
  symbol: 'XAUUSDT',
  sessionHours: 6,
  atrMult: 1.5,
  riskPercent: 1.0,
  feePercent: 0.055,        // taker; maker variant tested separately
  slippageTicks: 1,
  maxRangeAtr: 3.0,
  minRangeAtr: 0.25,
  intervalMins: 15,
  initialBalance: 10000,
};

const SESSIONS: { hour: number; name: string }[] = [
  { hour: 7, name: 'London 07:00' },
  { hour: 8, name: 'London 08:00' },
  { hour: 13, name: 'NY 13:00' },
  { hour: 14, name: 'NY 14:00' },
];
const RANGE_BARS = [2, 4];        // 30 min / 60 min opening range on 15m candles
const R_MULTIPLES = [1.0, 1.5, 2.0];
const STOP_MODES: ('range' | 'atr')[] = ['range', 'atr'];

type Row = {
  label: string;
  hour: number; rangeBars: number; rMultiple: number; stopMode: 'range' | 'atr';
  is: SessionResult; oos: SessionResult;
};

const rows: Row[] = [];

for (const s of SESSIONS) {
  for (const rb of RANGE_BARS) {
    for (const rm of R_MULTIPLES) {
      for (const sm of STOP_MODES) {
        const cfg = { ...baseline, sessionOpenUtcHour: s.hour, rangeBars: rb, rMultiple: rm, stopMode: sm };
        try {
          const is = await runSessionMomentum({ ...cfg, startMs: START, endMs: BOUNDARY });
          const oos = await runSessionMomentum({ ...cfg, startMs: BOUNDARY, endMs: END });
          rows.push({ label: `${s.name} OR=${rb * 15}m R=${rm} stop=${sm}`, hour: s.hour, rangeBars: rb, rMultiple: rm, stopMode: sm, is, oos });
        } catch (e: any) {
          console.warn(`  skipped ${s.name} OR=${rb} R=${rm} ${sm}: ${e.message}`);
        }
      }
    }
  }
}

const n = (v: number, d = 3) => v.toFixed(d).padStart(8);
console.log(`\nIS  ${new Date(START).toISOString().slice(0, 10)} -> ${new Date(BOUNDARY).toISOString().slice(0, 10)}`);
console.log(`OOS ${new Date(BOUNDARY).toISOString().slice(0, 10)} -> ${new Date(END).toISOString().slice(0, 10)}`);
console.log(`candles: ${rows[0]?.is.candlesUsed ?? 0} (IS)\n`);

// Only configs with a usable sample in BOTH windows are rankable.
const usable = rows.filter(r => r.is.totalTrades >= 10 && r.oos.totalTrades >= 8);
usable.sort((a, b) => b.oos.expectancyR - a.oos.expectancyR);

console.log('config'.padEnd(36) + 'IS-expR'.padStart(9) + 'OOS-expR'.padStart(10) + 'OOS-WR'.padStart(9) + 'OOS-PF'.padStart(9) + '  trades IS/OOS');
console.log('-'.repeat(92));
for (const r of usable.slice(0, 14)) {
  console.log(
    r.label.padEnd(36) +
    n(r.is.expectancyR) +
    n(r.oos.expectancyR) +
    n(r.oos.winRate, 1) +
    n(Number.isFinite(r.oos.profitFactor) ? r.oos.profitFactor : 99, 2) +
    `   ${r.is.totalTrades}/${r.oos.totalTrades}`
  );
}

const positive = usable.filter(r => r.oos.expectancyR > 0 && r.is.expectancyR > 0);
console.log(`\n${'='.repeat(92)}\nVERDICT\n${'='.repeat(92)}`);
console.log(`configs tested         : ${rows.length}`);
console.log(`usable sample          : ${usable.length}`);
console.log(`positive in BOTH windows: ${positive.length}`);

if (positive.length === 0) {
  const best = usable[0];
  console.log(`\nNothing is positive in both windows. Best out-of-sample: ${best ? best.oos.expectancyR.toFixed(3) + 'R (' + best.label + ')' : 'n/a'}`);
  console.log('Session breakout does not show an edge on this data either.');
} else {
  console.log('\nPositive in BOTH in-sample and out-of-sample:');
  for (const r of positive) {
    console.log(`  ${r.label}`);
    console.log(`    IS  ${r.is.expectancyR.toFixed(3)}R over ${r.is.totalTrades} trades | net $${r.is.netPnl} | maxDD ${r.is.maxDrawdownPercent}%`);
    console.log(`    OOS ${r.oos.expectancyR.toFixed(3)}R over ${r.oos.totalTrades} trades | net $${r.oos.netPnl} | maxDD ${r.oos.maxDrawdownPercent}% | WR ${r.oos.winRate.toFixed(1)}%`);
    console.log(`    gross $${r.oos.grossPnl} before $${r.oos.totalFees} fees`);
  }
  console.log('\nA positive result on ONE out-of-sample window is a candidate, not a system.');
  console.log('It needs a third unseen window and live shadow-mode confirmation before capital.');
}
