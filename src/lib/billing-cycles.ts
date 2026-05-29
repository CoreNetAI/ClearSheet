// Billing-cycle helpers for full-cycle invoice validation (#6).
//
// Two cadences are in play: the *client's* billing_period (how often the client
// is invoiced) and the *assignment's* billing_period (how often the employee
// submits a timesheet). When the assignment cadence is FINER than the client's
// (e.g. weekly timesheets, bi-weekly client), one client cycle is made of
// several timesheet periods — its "constituent periods". An invoice must cover
// the whole client cycle, so every constituent period has to be approved first.
import { getPeriodForDate, shiftPeriod, type Period } from "@/lib/periods";
import type { BillingPeriod } from "@/lib/types";

// Coarseness ranking. Finer cadence = smaller number.
const RANK: Record<BillingPeriod, number> = {
  weekly: 1,
  biweekly: 2,
  semimonthly: 3,
  monthly: 4,
};

// True when timesheets (assignment cadence) are finer than the client's billing
// cadence, so they must be bundled into the client's cycle before invoicing.
export function isBundledCadence(
  assignment: BillingPeriod,
  client: BillingPeriod
): boolean {
  return RANK[assignment] < RANK[client];
}

// A Monday, used as the fixed anchor for bi-weekly *client* cycles so every
// client/employee lands on the same 14-day boundaries with no per-client setup.
// Weekly timesheets (also Monday-based) therefore tile cleanly into them.
const BIWEEKLY_EPOCH = "2024-01-01";

/** The client billing cycle (window) that contains a given date. */
export function clientCycleFor(
  clientPeriod: BillingPeriod,
  dateStr: string
): Period {
  return getPeriodForDate(
    clientPeriod,
    dateStr,
    clientPeriod === "biweekly" ? BIWEEKLY_EPOCH : undefined
  );
}

/**
 * The assignment-cadence period STARTS that fall inside a client cycle window,
 * limited to the assignment's active date range. Membership is by period start,
 * so a period straddling a boundary belongs to the cycle its start is in.
 * These are the constituent periods that must all be approved to invoice.
 */
export function expectedPeriodStarts(
  assignmentPeriod: BillingPeriod,
  cycle: Period,
  activeStart: string | null,
  activeEnd: string | null,
  anchor: string
): string[] {
  const starts: string[] = [];
  let p = getPeriodForDate(assignmentPeriod, cycle.start, anchor);
  // Advance to the first period whose start is on/after the cycle start.
  let guard = 0;
  while (p.start < cycle.start && guard++ < 100) {
    p = shiftPeriod(assignmentPeriod, p, 1, anchor);
  }
  guard = 0;
  while (p.start <= cycle.end && guard++ < 100) {
    const overlapsActive =
      (!activeStart || p.end >= activeStart) &&
      (!activeEnd || p.start <= activeEnd);
    if (overlapsActive) starts.push(p.start);
    p = shiftPeriod(assignmentPeriod, p, 1, anchor);
  }
  return starts;
}
