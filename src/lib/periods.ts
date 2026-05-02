// Billing-period math (spec §9). All boundary arithmetic uses UTC-midnight
// Dates derived from 'yyyy-MM-dd' strings, so it is DST/timezone-safe. The
// only timezone-aware step is determining "today" in the firm's timezone.
import { formatInTimeZone } from "date-fns-tz";

import type { BillingPeriod } from "@/lib/types";

export interface Period {
  start: string; // yyyy-MM-dd (inclusive)
  end: string; // yyyy-MM-dd (inclusive)
}

const MS_PER_DAY = 86_400_000;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function toUTC(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  return fmt(new Date(toUTC(dateStr).getTime() + days * MS_PER_DAY));
}

function diffDays(a: string, b: string): number {
  return Math.round((toUTC(a).getTime() - toUTC(b).getTime()) / MS_PER_DAY);
}

function lastDayOfMonth(year: number, monthIndex0: number): number {
  // Day 0 of next month = last day of this month.
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/** Current date (yyyy-MM-dd) in the firm's timezone. */
export function todayInTz(tz: string): string {
  return formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
}

/** The period of `billingPeriod` that contains `dateStr`. */
export function getPeriodForDate(
  billingPeriod: BillingPeriod,
  dateStr: string,
  anchorStr?: string
): Period {
  const d = toUTC(dateStr);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const dom = d.getUTCDate();

  switch (billingPeriod) {
    case "weekly": {
      // Monday–Sunday week containing the date.
      const dow = d.getUTCDay(); // 0=Sun..6=Sat
      const sinceMonday = (dow + 6) % 7;
      const start = addDays(dateStr, -sinceMonday);
      return { start, end: addDays(start, 6) };
    }
    case "biweekly": {
      // 14-day windows anchored to the assignment start date.
      const anchor = anchorStr ?? dateStr;
      const delta = diffDays(dateStr, anchor);
      const index = Math.floor(delta / 14);
      const start = addDays(anchor, index * 14);
      return { start, end: addDays(start, 13) };
    }
    case "semimonthly": {
      if (dom <= 15) {
        return {
          start: `${year}-${String(month + 1).padStart(2, "0")}-01`,
          end: `${year}-${String(month + 1).padStart(2, "0")}-15`,
        };
      }
      const last = lastDayOfMonth(year, month);
      return {
        start: `${year}-${String(month + 1).padStart(2, "0")}-16`,
        end: `${year}-${String(month + 1).padStart(2, "0")}-${last}`,
      };
    }
    case "monthly":
    default: {
      const last = lastDayOfMonth(year, month);
      const mm = String(month + 1).padStart(2, "0");
      return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${last}` };
    }
  }
}

/** The current period for a billing cadence, in the firm timezone. */
export function getCurrentPeriod(
  billingPeriod: BillingPeriod,
  tz: string,
  anchorStr?: string
): Period {
  return getPeriodForDate(billingPeriod, todayInTz(tz), anchorStr);
}

/** Shift to the previous / next period of the same cadence. */
export function shiftPeriod(
  billingPeriod: BillingPeriod,
  period: Period,
  direction: -1 | 1,
  anchorStr?: string
): Period {
  const ref =
    direction === -1
      ? addDays(period.start, -1)
      : addDays(period.end, 1);
  return getPeriodForDate(billingPeriod, ref, anchorStr);
}

/**
 * Every period from the one containing `startDate` through the current period
 * (inclusive), oldest first. Used to surface missed/overdue periods on the
 * employee dashboard. Capped at the `maxPeriods` most-recent periods as a
 * safety bound for assignments with a very old start date.
 */
export function listPeriodsThrough(
  billingPeriod: BillingPeriod,
  tz: string,
  startDate: string,
  maxPeriods = 26
): Period[] {
  const current = getCurrentPeriod(billingPeriod, tz, startDate);
  const periods: Period[] = [current];
  let p = current;
  while (periods.length < maxPeriods) {
    const prev = shiftPeriod(billingPeriod, p, -1, startDate);
    if (prev.end < startDate) break; // entirely before the assignment start
    periods.unshift(prev);
    p = prev;
  }
  return periods;
}

/** Every calendar day in a period as yyyy-MM-dd strings. */
export function listDays(period: Period): string[] {
  const days: string[] = [];
  const n = diffDays(period.end, period.start);
  for (let i = 0; i <= n; i++) days.push(addDays(period.start, i));
  return days;
}

/** "Jan 6" */
export function formatDayShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  void y;
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Mon" */
export function weekdayShort(dateStr: string): string {
  return formatInTimeZone(toUTC(dateStr), "UTC", "EEE");
}

/** "Jan 6 – Jan 12, 2025" */
export function formatPeriodLabel(period: Period): string {
  const [, , ] = period.start.split("-");
  const endYear = period.end.split("-")[0];
  return `${formatDayShort(period.start)} – ${formatDayShort(
    period.end
  )}, ${endYear}`;
}
