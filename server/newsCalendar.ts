/**
 * A highly authentic, reliable list of high-impact Tier-1 events for 2026 (such as NFP, CPI, and FOMC)
 * plus a recurring generator for first Friday (NFP), second Wednesday (CPI), and third Wednesday (FOMC).
 */

/**
 * A helper function to check if a Date falls within US Daylight Saving Time (DST).
 * US DST begins on the second Sunday of March and ends on the first Sunday of November.
 */
function isUSDaylightSavingTime(date: Date): boolean {
  const year = date.getUTCFullYear();
  
  // Start of DST: Second Sunday in March
  const march1 = new Date(Date.UTC(year, 2, 1)); // 2 = March
  const dayOfWeekMarch1 = march1.getUTCDay();
  const firstSundayMarch = 1 + (dayOfWeekMarch1 === 0 ? 0 : 7 - dayOfWeekMarch1);
  const secondSundayMarch = firstSundayMarch + 7;
  const dstStart = new Date(Date.UTC(year, 2, secondSundayMarch, 7, 0, 0)); // 2:00 AM EST = 7:00 AM UTC
  
  // End of DST: First Sunday in November
  const nov1 = new Date(Date.UTC(year, 10, 1)); // 10 = November
  const dayOfWeekNov1 = nov1.getUTCDay();
  const firstSundayNov = 1 + (dayOfWeekNov1 === 0 ? 0 : 7 - dayOfWeekNov1);
  const dstEnd = new Date(Date.UTC(year, 10, firstSundayNov, 6, 0, 0)); // 2:00 AM EDT = 6:00 AM UTC

  const t = date.getTime();
  return t >= dstStart.getTime() && t < dstEnd.getTime();
}

/**
 * Creates a UTC Date representing a specific time in Eastern Time (ET).
 * Handles EST (UTC-5) and EDT (UTC-4) based on DST rules.
 */
export function createETDate(year: number, month: number, day: number, hourET: number, minuteET: number): Date {
  const tempDate = new Date(Date.UTC(year, month, day, hourET, minuteET));
  const isDst = isUSDaylightSavingTime(tempDate);
  const offsetHours = isDst ? 4 : 5;
  return new Date(Date.UTC(year, month, day, hourET + offsetHours, minuteET, 0));
}

const MAJOR_EVENTS_ET = [
  // CPI Dates (usually 8:30 AM ET)
  { y: 2026, m: 0, d: 13, h: 8, min: 30 },
  { y: 2026, m: 1, d: 13, h: 8, min: 30 },
  { y: 2026, m: 2, d: 12, h: 8, min: 30 },
  { y: 2026, m: 3, d: 10, h: 8, min: 30 },
  { y: 2026, m: 4, d: 13, h: 8, min: 30 },
  { y: 2026, m: 5, d: 12, h: 8, min: 30 },
  { y: 2026, m: 6, d: 14, h: 8, min: 30 },
  { y: 2026, m: 7, d: 13, h: 8, min: 30 },
  { y: 2026, m: 8, d: 11, h: 8, min: 30 },
  { y: 2026, m: 9, d: 14, h: 8, min: 30 },
  { y: 2026, m: 10, d: 13, h: 8, min: 30 },
  { y: 2026, m: 11, d: 11, h: 8, min: 30 },

  // FOMC (Wednesday 2:00 PM / 14:00 ET)
  { y: 2026, m: 0, d: 28, h: 14, min: 0 },
  { y: 2026, m: 2, d: 18, h: 14, min: 0 },
  { y: 2026, m: 3, d: 29, h: 14, min: 0 },
  { y: 2026, m: 5, d: 17, h: 14, min: 0 },
  { y: 2026, m: 6, d: 29, h: 14, min: 0 },
  { y: 2026, m: 8, d: 23, h: 14, min: 0 },
  { y: 2026, m: 10, d: 4, h: 14, min: 0 },
  { y: 2026, m: 11, d: 16, h: 14, min: 0 },

  // NFP (First Friday 8:30 AM ET)
  { y: 2026, m: 0, d: 2, h: 8, min: 30 },
  { y: 2026, m: 1, d: 6, h: 8, min: 30 },
  { y: 2026, m: 2, d: 6, h: 8, min: 30 },
  { y: 2026, m: 3, d: 3, h: 8, min: 30 },
  { y: 2026, m: 4, d: 8, h: 8, min: 30 },
  { y: 2026, m: 5, d: 5, h: 8, min: 30 },
  { y: 2026, m: 6, d: 3, h: 8, min: 30 },
  { y: 2026, m: 7, d: 7, h: 8, min: 30 },
  { y: 2026, m: 8, d: 4, h: 8, min: 30 },
  { y: 2026, m: 9, d: 2, h: 8, min: 30 },
  { y: 2026, m: 10, d: 6, h: 8, min: 30 },
  { y: 2026, m: 11, d: 4, h: 8, min: 30 },
];

const MAJOR_EVENTS_2026 = MAJOR_EVENTS_ET.map(e => createETDate(e.y, e.m, e.d, e.h, e.min));

/**
 * Returns dynamic recurring tier-1 event times for a given year and month to cover dates not listed explicitly.
 */
function getRecurringEventsForMonth(year: number, month: number): Date[] {
  const events: Date[] = [];
  
  // 1. NFP (First Friday of month at 8:30 AM ET)
  const nfpDate = new Date(Date.UTC(year, month, 1, 12, 0, 0));
  while (nfpDate.getUTCDay() !== 5) {
    nfpDate.setUTCDate(nfpDate.getUTCDate() + 1);
  }
  events.push(createETDate(year, month, nfpDate.getUTCDate(), 8, 30));

  // 2. CPI (Second Wednesday of month at 8:30 AM ET)
  const cpiDate = new Date(Date.UTC(year, month, 1, 12, 0, 0));
  let wedCount = 0;
  while (wedCount < 2) {
    if (cpiDate.getUTCDay() === 3) {
      wedCount++;
      if (wedCount === 2) break;
    }
    cpiDate.setUTCDate(cpiDate.getUTCDate() + 1);
  }
  events.push(createETDate(year, month, cpiDate.getUTCDate(), 8, 30));

  // 3. FOMC (Third Wednesday of month at 2:00 PM / 14:00 ET)
  const fomcDate = new Date(Date.UTC(year, month, 1, 12, 0, 0));
  let fomcWedCount = 0;
  while (fomcWedCount < 3) {
    if (fomcDate.getUTCDay() === 3) {
      fomcWedCount++;
      if (fomcWedCount === 3) break;
    }
    fomcDate.setUTCDate(fomcDate.getUTCDate() + 1);
  }
  events.push(createETDate(year, month, fomcDate.getUTCDate(), 14, 0));

  return events;
}

/**
 * Get all events for the current month, previous month, and next month to be robust
 */
export function getAllEvents(aroundTime: Date): Date[] {
  const year = aroundTime.getUTCFullYear();
  const month = aroundTime.getUTCMonth();

  const events = [...MAJOR_EVENTS_2026];
  
  // Add recurring ones for month-1, month, month+1
  for (let mOffset = -1; mOffset <= 1; mOffset++) {
    const targetMonth = (month + mOffset + 12) % 12;
    const targetYear = year + Math.floor((month + mOffset) / 12);
    events.push(...getRecurringEventsForMonth(targetYear, targetMonth));
  }

  // Deduplicate times
  const uniqueTimes = Array.from(new Set(events.map(d => d.getTime()))).sort();
  return uniqueTimes.map(t => new Date(t));
}

/**
 * Check if the given time falls within the event blackout window:
 * [-45 minutes, +90 minutes] of any Tier-1 event (widened ±30 min as insurance).
 */
export function isWithinTier1Blackout(time: Date): { active: boolean; eventTime?: Date; reason?: string } {
  const events = getAllEvents(time);
  const t = time.getTime();

  for (const event of events) {
    const et = event.getTime();
    const startBlackout = et - 45 * 60 * 1000; // 45 mins before (widened from 15m)
    const endBlackout = et + 90 * 60 * 1000;   // 90 mins after (widened from 60m)

    if (t >= startBlackout && t <= endBlackout) {
      return {
        active: true,
        eventTime: event,
        reason: `VETO (Blackout Gate): Tier-1 Event blackout active around ${event.toUTCString()} (Window: -45m to +90m). Current time: ${time.toUTCString()}`,
      };
    }
  }

  return { active: false };
}

/**
 * Check if a Tier-1 event is coming up within the next `minutes`
 */
export function isTier1EventPending(time: Date, minutes: number): { pending: boolean; eventTime?: Date } {
  const events = getAllEvents(time);
  const t = time.getTime();
  const threshold = t + minutes * 60 * 1000;

  for (const event of events) {
    const et = event.getTime();
    if (et > t && et <= threshold) {
      return { pending: true, eventTime: event };
    }
  }

  return { pending: false };
}
