import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { RateLike } from "@/lib/calc";
import type { AssignmentRate } from "@/lib/types";

/**
 * The rate in force for a period: the row with the latest `effective_from`
 * on-or-before the period's start. Falls back to the earliest row if the period
 * predates all rates, then to zeros if there are none.
 */
export function effectiveRate(
  rows: Pick<
    AssignmentRate,
    "bill_rate" | "pay_rate" | "overtime_multiplier" | "effective_from"
  >[],
  periodStart: string
): RateLike {
  if (!rows.length) return { bill_rate: 0, pay_rate: 0, overtime_multiplier: 1.5 };
  // Sort ascending by effective_from, then take the last one <= periodStart.
  const sorted = [...rows].sort((a, b) =>
    a.effective_from.localeCompare(b.effective_from)
  );
  let chosen = sorted[0];
  for (const r of sorted) {
    if (r.effective_from <= periodStart) chosen = r;
    else break;
  }
  return {
    bill_rate: Number(chosen.bill_rate),
    pay_rate: Number(chosen.pay_rate),
    overtime_multiplier: Number(chosen.overtime_multiplier) || 1.5,
  };
}

/** All rate rows for an assignment (newest first). */
export async function fetchRatesForAssignment(
  supabase: SupabaseClient,
  assignmentId: string
): Promise<AssignmentRate[]> {
  const { data } = await supabase
    .from("assignment_rates")
    .select("*")
    .eq("assignment_id", assignmentId)
    .order("effective_from", { ascending: false });
  return (data ?? []) as AssignmentRate[];
}

/** Convenience: the effective rate for one assignment + period in a single call. */
export async function rateForPeriod(
  supabase: SupabaseClient,
  assignmentId: string,
  periodStart: string
): Promise<RateLike> {
  const rows = await fetchRatesForAssignment(supabase, assignmentId);
  return effectiveRate(rows, periodStart);
}
