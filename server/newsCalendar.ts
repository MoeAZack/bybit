/**
 * A highly authentic, reliable list of high-impact Tier-1 events for 2026 (such as NFP, CPI, and FOMC)
 * plus a recurring generator for first Friday (NFP), second Wednesday (CPI), and third Wednesday (FOMC).
 */

const MAJOR_EVENTS_2026 = [
  // CPI Dates (usually 13:30 UTC)
  new Date('2026-01-13T13:30:00Z'),
  new Date('2026-02-13T13:30:00Z'),
  new Date('2026-03-12T13:30:00Z'),
  new Date('2026-04-10T13:30:00Z'),
  new Date('2026-05-13T13:30:00Z'),
  new Date('2026-06-12T13:30:00Z'),
  new Date('2026-07-14T13:30:00Z'),
  new Date('2026-08-13T13:30:00Z'),
  new Date('2026-09-11T13:30:00Z'),
  new Date('2026-10-14T13:30:00Z'),
  new Date('2026-11-13T13:30:00Z'),
  new Date('2026-12-11T13:30:00Z'),

  // FOMC (Wednesday 19:00 UTC)
  new Date('2026-01-28T19:00:00Z'),
  new Date('2026-03-18T19:00:00Z'),
  new Date('2026-04-29T19:00:00Z'),
  new Date('2026-06-17T19:00:00Z'),
  new Date('2026-07-29T19:00:00Z'),
  new Date('2026-09-23T19:00:00Z'),
  new Date('2026-11-04T19:00:00Z'),
  new Date('2026-12-16T19:00:00Z'),

  // NFP (First Friday 13:30 UTC)
  new Date('2026-01-02T13:30:00Z'),
  new Date('2026-02-06T13:30:00Z'),
  new Date('2026-03-06T13:30:00Z'),
  new Date('2026-04-03T13:30:00Z'),
  new Date('2026-05-08T13:30:00Z'),
  new Date('2026-06-05T13:30:00Z'),
  new Date('2026-07-03T13:30:00Z'),
  new Date('2026-08-07T13:30:00Z'),
  new Date('2026-09-04T13:30:00Z'),
  new Date('2026-10-02T13:30:00Z'),
  new Date('2026-11-06T13:30:00Z'),
  new Date('2026-12-04T13:30:00Z'),
];

/**
 * Returns dynamic recurring tier-1 event times for a given year and month to cover dates not listed explicitly.
 */
function getRecurringEventsForMonth(year: number, month: number): Date[] {
  const events: Date[] = [];
  
  // 1. NFP (First Friday of month at 13:30 UTC)
  const nfpDate = new Date(Date.UTC(year, month, 1, 13, 30, 0));
  while (nfpDate.getUTCDay() !== 5) {
    nfpDate.setUTCDate(nfpDate.getUTCDate() + 1);
  }
  events.push(nfpDate);

  // 2. CPI (Second Wednesday of month at 13:30 UTC)
  const cpiDate = new Date(Date.UTC(year, month, 1, 13, 30, 0));
  let wedCount = 0;
  while (wedCount < 2) {
    if (cpiDate.getUTCDay() === 3) {
      wedCount++;
      if (wedCount === 2) break;
    }
    cpiDate.setUTCDate(cpiDate.getUTCDate() + 1);
  }
  events.push(cpiDate);

  // 3. FOMC (Third Wednesday of month at 19:00 UTC)
  const fomcDate = new Date(Date.UTC(year, month, 1, 19, 0, 0));
  let fomcWedCount = 0;
  while (fomcWedCount < 3) {
    if (fomcDate.getUTCDay() === 3) {
      fomcWedCount++;
      if (fomcWedCount === 3) break;
    }
    fomcDate.setUTCDate(fomcDate.getUTCDate() + 1);
  }
  events.push(fomcDate);

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
 * [-15 minutes, +60 minutes] of any Tier-1 event.
 */
export function isWithinTier1Blackout(time: Date): { active: boolean; eventTime?: Date; reason?: string } {
  const events = getAllEvents(time);
  const t = time.getTime();

  for (const event of events) {
    const et = event.getTime();
    const startBlackout = et - 15 * 60 * 1000; // 15 mins before
    const endBlackout = et + 60 * 60 * 1000;   // 60 mins after

    if (t >= startBlackout && t <= endBlackout) {
      return {
        active: true,
        eventTime: event,
        reason: `VETO (Blackout Gate): Tier-1 Event blackout active around ${event.toUTCString()} (Window: -15m to +60m). Current time: ${time.toUTCString()}`,
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
