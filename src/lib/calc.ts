// Hour aggregation and bill/pay calculations (spec §9).
//
// Rules:
//   regular hours total = regular + holiday + pto
//   ot hours total      = overtime
//   billable regular    = regular only (holiday/PTO are paid but NOT billed)
//   bill = billableRegular*bill_rate + ot*bill_rate*multiplier
//   pay  = (regular+holiday+pto)*pay_rate + ot*pay_rate*multiplier
import type { EntryType } from "@/lib/types";

export interface EntryLike {
  entry_type: EntryType;
  hours: number;
}

export interface RateLike {
  bill_rate: number;
  pay_rate: number;
  overtime_multiplier: number;
}

export interface TimesheetTotals {
  regularHours: number; // entry_type = regular
  overtimeHours: number; // entry_type = overtime
  holidayHours: number;
  ptoHours: number;
  totalRegularHours: number; // regular + holiday + pto
  totalOtHours: number; // overtime
  billableHours: number; // regular + overtime (the hours that get billed)
  billAmount: number;
  payAmount: number;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeTotals(
  entries: EntryLike[],
  rates: RateLike
): TimesheetTotals {
  let regular = 0;
  let overtime = 0;
  let holiday = 0;
  let pto = 0;

  for (const e of entries) {
    const h = Number(e.hours) || 0;
    switch (e.entry_type) {
      case "regular":
        regular += h;
        break;
      case "overtime":
        overtime += h;
        break;
      case "holiday":
        holiday += h;
        break;
      case "pto":
        pto += h;
        break;
    }
  }

  const totalRegularHours = round2(regular + holiday + pto);
  const totalOtHours = round2(overtime);
  const mult = Number(rates.overtime_multiplier) || 1.5;

  const billAmount = round2(
    regular * rates.bill_rate + overtime * rates.bill_rate * mult
  );
  const payAmount = round2(
    (regular + holiday + pto) * rates.pay_rate +
      overtime * rates.pay_rate * mult
  );

  return {
    regularHours: round2(regular),
    overtimeHours: round2(overtime),
    holidayHours: round2(holiday),
    ptoHours: round2(pto),
    totalRegularHours,
    totalOtHours,
    billableHours: round2(regular + overtime),
    billAmount,
    payAmount,
  };
}

/** Gross pay for the payroll export = pay_amount (already includes OT + PTO). */
export function grossPay(totals: TimesheetTotals): number {
  return totals.payAmount;
}
