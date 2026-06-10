/**
 * Quote-spec generation: the date ranges we test per listing to reconstruct a
 * 12-month pricing calendar (not a one-shot "current price" scrape).
 *
 * A. calendar_month — first of month → first of next month.
 * B. rolling_30_nights — mid-month 30-night stay (15th → 14th).
 * C. duration ladder (30/60/90/180) from one start date for discount-sensitive
 *    sources (Blueground), so long-stay discounts are observed, never blended.
 */

import type { QuoteSpec, RentalQuoteType } from "@re-sourcing/contracts";

const DAY_MS = 24 * 60 * 60 * 1000;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function firstOfMonthUtc(date: Date, monthOffset: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + monthOffset, 1));
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / DAY_MS);
}

/** "2026-07-15" → "2026-07". */
export function calendarMonthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/**
 * The calendar month an observation prices: for calendar-month stays the
 * check-in month; for rolling stays the month containing most nights.
 */
export function dominantMonth(checkIn: string, checkOut: string): string {
  const start = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  const counts = new Map<string, number>();
  for (let at = start.getTime(); at < end.getTime(); at += DAY_MS) {
    const month = toIsoDate(new Date(at)).slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  let best = calendarMonthOf(checkIn);
  let bestCount = -1;
  for (const [month, count] of counts) {
    if (count > bestCount) {
      best = month;
      bestCount = count;
    }
  }
  return best;
}

export interface QuoteSpecOptions {
  /** Months of forward calendar to sample. Default 12. */
  monthsForward?: number;
  guests?: number;
  pets?: boolean;
  /** Include the 60/90/180-night duration ladder (discount-sensitive sources). */
  includeDurationLadder?: boolean;
  /** Anchor "today"; injectable for tests. */
  now?: Date;
}

function spec(checkIn: Date, checkOut: Date, quoteType: RentalQuoteType, guests: number, pets: boolean): QuoteSpec {
  const checkInIso = toIsoDate(checkIn);
  const checkOutIso = toIsoDate(checkOut);
  return {
    checkIn: checkInIso,
    checkOut: checkOutIso,
    nights: nightsBetween(checkInIso, checkOutIso),
    guests,
    pets,
    currency: "USD",
    quoteType,
  };
}

/**
 * Rolling monthly quote calendar for the next `monthsForward` months:
 * calendar-month stays + mid-month rolling 30-night stays, plus the optional
 * duration ladder anchored on the first full forward month.
 */
export function generateQuoteSpecs(options: QuoteSpecOptions = {}): QuoteSpec[] {
  const monthsForward = Math.max(1, Math.min(options.monthsForward ?? 12, 24));
  const guests = options.guests ?? 2;
  const pets = options.pets ?? false;
  const now = options.now ?? new Date();

  const specs: QuoteSpec[] = [];

  // Start with the first full month ahead of us — a partially elapsed current
  // month would price a stay that can no longer be booked from day one.
  for (let offset = 1; offset <= monthsForward; offset++) {
    const monthStart = firstOfMonthUtc(now, offset);
    specs.push(spec(monthStart, firstOfMonthUtc(now, offset + 1), "calendar_month", guests, pets));

    const midMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 15));
    specs.push(spec(midMonth, new Date(midMonth.getTime() + 30 * DAY_MS), "rolling_30_nights", guests, pets));
  }

  if (options.includeDurationLadder) {
    const anchor = firstOfMonthUtc(now, 1);
    const ladder: Array<{ nights: number; quoteType: RentalQuoteType }> = [
      { nights: 60, quoteType: "rolling_60_nights" },
      { nights: 90, quoteType: "rolling_90_nights" },
      { nights: 180, quoteType: "rolling_180_nights" },
    ];
    for (const { nights, quoteType } of ladder) {
      specs.push(spec(anchor, new Date(anchor.getTime() + nights * DAY_MS), quoteType, guests, pets));
    }
  }

  return specs;
}
