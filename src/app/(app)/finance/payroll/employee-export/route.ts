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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One employee's full timesheet history (any status) within a date range.
export async function GET(request: Request) {
  const guard = await guardRole(["finance", "admin"]);
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId") || "";
  const start = searchParams.get("start") || "";
  const end = searchParams.get("end") || "";
  const format = parseFormat(searchParams.get("format"));
  if (!UUID_RE.test(employeeId)) {
    return NextResponse.json({ error: "Invalid employee" }, { status: 400 });
  }
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  const { data: emp } = await supabase
    .from("profiles")
    .select("full_name, emp_code")
    .eq("id", employeeId)
    .maybeSingle();

  const { data } = await supabase
    .from("timesheets")
    .select(
      "period_start, period_end, status, assignment_id, total_regular_hours, total_ot_hours, bill_amount, pay_amount, assignment:assignments(title, employment_type, vendor, notes, client:clients(name))"
    )
    .eq("employee_id", employeeId)
    .gte("period_start", start)
    .lte("period_start", end)
    .order("period_start", { ascending: true });

  const rows = (data ?? []) as unknown as {
    period_start: string;
    period_end: string;
    status: string;
    assignment_id: string;
    total_regular_hours: number;
    total_ot_hours: number;
    bill_amount: number;
    pay_amount: number;
    assignment: {
      title: string | null;
      employment_type: string | null;
      vendor: string | null;
      notes: string | null;
      client: { name: string } | null;
    } | null;
  }[];

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
    "period_start",
    "period_end",
    "status",
    "client",
    "assignment",
    "employment_type",
    "vendor",
    "regular_hours",
    "ot_hours",
    "bill_rate",
    "pay_rate",
    "bill_amount",
    "gross_pay",
    "notes",
  ];

  const dataRows: Cell[][] = rows.map((r) => {
    const rate = effectiveRate(
      ratesByAssignment.get(r.assignment_id) ?? [],
      r.period_start
    );
    return [
      r.period_start,
      r.period_end,
      r.status,
      r.assignment?.client?.name ?? "",
      r.assignment?.title ?? "",
      r.assignment?.employment_type ?? "",
      r.assignment?.vendor ?? "",
      r.total_regular_hours,
      r.total_ot_hours,
      rate.bill_rate,
      rate.pay_rate,
      Number(r.bill_amount).toFixed(2),
      Number(r.pay_amount).toFixed(2),
      r.assignment?.notes ?? "",
    ];
  });

  // Append this employee's invoice adjustments (deductions/reimbursements) whose
  // invoice was issued in range, so the gross_pay column nets correctly.
  const { data: adjData } = await supabase
    .from("invoice_adjustments")
    .select(
      "kind, label, amount, invoice:invoices(issued_date, client:clients(name))"
    )
    .eq("employee_id", employeeId);
  const adjRows = (adjData ?? []) as unknown as {
    kind: string;
    label: string;
    amount: number;
    invoice: { issued_date: string | null; client: { name: string } | null } | null;
  }[];
  for (const a of adjRows) {
    const issued = a.invoice?.issued_date ?? "";
    if (issued && (issued < start || issued > end)) continue;
    const signed =
      a.kind === "deduction" ? -Number(a.amount) : Number(a.amount);
    dataRows.push([
      issued,
      "",
      `adjustment (${a.kind})`,
      a.invoice?.client?.name ?? "",
      a.label,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      signed.toFixed(2),
      "",
    ]);
  }

  const slug = (emp?.emp_code || emp?.full_name || "employee")
    .toString()
    .replace(/[^a-z0-9]+/gi, "_");
  return exportResponse(`history_${slug}_${start}_to_${end}`, headers, dataRows, format);
}
