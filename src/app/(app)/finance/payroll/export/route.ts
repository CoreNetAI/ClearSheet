import { NextResponse } from "next/server";

import { effectiveRate } from "@/lib/rates";
import {
  exportResponse,
  guardRole,
  parseFormat,
  type Cell,
} from "@/lib/export-response";
import type { AssignmentRate } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const guard = await guardRole(["finance", "admin"]);
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start") || "";
  const end = searchParams.get("end") || "";
  const format = parseFormat(searchParams.get("format"));
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  // Approved/invoiced/paid timesheets whose period falls in the range.
  const { data } = await supabase
    .from("timesheets")
    .select(
      "period_start, period_end, assignment_id, total_regular_hours, total_ot_hours, pay_amount, employee:profiles!employee_id(full_name, emp_code), assignment:assignments(employment_type, vendor, notes, client:clients(name, payment_terms_days))"
    )
    .in("status", ["approved", "invoiced", "paid"])
    .gte("period_start", start)
    .lte("period_start", end)
    .order("period_start", { ascending: true });

  const rows = (data ?? []) as unknown as {
    period_start: string;
    period_end: string;
    assignment_id: string;
    total_regular_hours: number;
    total_ot_hours: number;
    pay_amount: number;
    employee: { full_name: string | null; emp_code: string | null } | null;
    assignment: {
      employment_type: string | null;
      vendor: string | null;
      notes: string | null;
      client: { name: string; payment_terms_days: number | null } | null;
    } | null;
  }[];

  // Resolve each period's pay rate from the assignment's rate history.
  const assignmentIds = Array.from(
    new Set(rows.map((r) => r.assignment_id).filter(Boolean))
  );
  const ratesByAssignment = new Map<string, AssignmentRate[]>();
  if (assignmentIds.length) {
    const { data: rateRows } = await supabase
      .from("assignment_rates")
      .select("assignment_id, bill_rate, pay_rate, overtime_multiplier, effective_from")
      .in("assignment_id", assignmentIds);
    for (const rr of (rateRows ?? []) as AssignmentRate[]) {
      const arr = ratesByAssignment.get(rr.assignment_id) ?? [];
      arr.push(rr);
      ratesByAssignment.set(rr.assignment_id, arr);
    }
  }

  const headers = [
    "employee_name",
    "employee_id",
    "client",
    "vendor",
    "employment_type",
    "period_start",
    "period_end",
    "regular_hours",
    "ot_hours",
    "pay_rate",
    "payment_terms_days",
    "gross_pay",
    "notes",
  ];

  const dataRows: Cell[][] = rows.map((r) => [
    r.employee?.full_name ?? "",
    r.employee?.emp_code ?? "",
    r.assignment?.client?.name ?? "",
    r.assignment?.vendor ?? "",
    r.assignment?.employment_type ?? "",
    r.period_start,
    r.period_end,
    r.total_regular_hours,
    r.total_ot_hours,
    effectiveRate(ratesByAssignment.get(r.assignment_id) ?? [], r.period_start)
      .pay_rate,
    r.assignment?.client?.payment_terms_days ?? "",
    Number(r.pay_amount).toFixed(2),
    r.assignment?.notes ?? "",
  ]);

  return exportResponse(`payroll_${start}_to_${end}`, headers, dataRows, format);
}
