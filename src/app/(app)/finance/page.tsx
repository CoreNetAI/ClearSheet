import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { round2 } from "@/lib/calc";
import {
  clientCycleFor,
  expectedPeriodStarts,
  isBundledCadence,
} from "@/lib/billing-cycles";
import type { BillingPeriod } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import {
  ApprovedList,
  type ApprovedGroup,
  type ApprovedItem,
} from "@/components/finance/approved-list";

export default async function FinanceApprovedPage() {
  await requireRole("finance", "admin");
  const supabase = await createClient();

  const { data } = await supabase
    .from("timesheets")
    .select(
      "id, employee_id, period_start, period_end, total_regular_hours, total_ot_hours, bill_amount, employee:profiles!employee_id(full_name), assignment:assignments(id, title, billing_period, start_date, end_date, client_id, client:clients(name, billing_period))"
    )
    .eq("status", "approved")
    .order("period_start", { ascending: true });

  const rows = (data ?? []) as unknown as {
    id: string;
    employee_id: string;
    period_start: string;
    period_end: string;
    total_regular_hours: number;
    total_ot_hours: number;
    bill_amount: number;
    employee: { full_name: string | null } | null;
    assignment: {
      id: string;
      title: string | null;
      billing_period: BillingPeriod | null;
      start_date: string | null;
      end_date: string | null;
      client_id: string;
      client: { name: string; billing_period: BillingPeriod | null } | null;
    } | null;
  }[];

  // Which assignment+period_starts are approved — used to tell whether a
  // bundled client cycle has all its constituent periods approved yet.
  const approvedStartsByAssignment = new Map<string, Set<string>>();
  for (const r of rows) {
    const aId = r.assignment?.id;
    if (!aId) continue;
    const set = approvedStartsByAssignment.get(aId) ?? new Set<string>();
    set.add(r.period_start);
    approvedStartsByAssignment.set(aId, set);
  }

  // Accumulate one item per (cycle, employee, assignment) in bundled mode, or
  // one item per timesheet in single mode (cadences match → already a cycle).
  type Bundle = ApprovedItem & {
    clientId: string;
    clientName: string;
    cycleStart: string;
    cycleEnd: string;
    assignmentId: string;
    assignmentPeriod: BillingPeriod;
    assignmentStart: string | null;
    assignmentEnd: string | null;
    bundled: boolean;
  };
  const bundleMap = new Map<string, Bundle>();

  for (const r of rows) {
    const clientId = r.assignment?.client_id ?? "unknown";
    const clientName = r.assignment?.client?.name ?? "Client";
    const aCad = (r.assignment?.billing_period ?? "weekly") as BillingPeriod;
    const cCad = (r.assignment?.client?.billing_period ?? aCad) as BillingPeriod;
    const bundled = isBundledCadence(aCad, cCad);

    const cycle = bundled
      ? clientCycleFor(cCad, r.period_start)
      : { start: r.period_start, end: r.period_end };

    const aId = r.assignment?.id ?? "unknown";
    const key = bundled
      ? `${clientId}|${cycle.start}|${cycle.end}|${r.employee_id}|${aId}`
      : `${clientId}|${cycle.start}|${cycle.end}|${r.id}`;

    let b = bundleMap.get(key);
    if (!b) {
      b = {
        key,
        clientId,
        clientName,
        cycleStart: cycle.start,
        cycleEnd: cycle.end,
        assignmentId: aId,
        assignmentPeriod: aCad,
        assignmentStart: r.assignment?.start_date ?? null,
        assignmentEnd: r.assignment?.end_date ?? null,
        bundled,
        employeeName: r.employee?.full_name ?? "—",
        assignmentTitle: r.assignment?.title ?? "—",
        regularHours: 0,
        otHours: 0,
        billAmount: 0,
        timesheetIds: [],
        ready: true,
        missingPeriods: 0,
      };
      bundleMap.set(key, b);
    }
    b.regularHours = round2(b.regularHours + Number(r.total_regular_hours));
    b.otHours = round2(b.otHours + Number(r.total_ot_hours));
    b.billAmount = round2(b.billAmount + Number(r.bill_amount));
    b.timesheetIds.push(r.id);
  }

  // Readiness: a bundled item is ready only when every constituent period of
  // its client cycle is approved.
  for (const b of bundleMap.values()) {
    if (!b.bundled) continue;
    const expected = expectedPeriodStarts(
      b.assignmentPeriod,
      { start: b.cycleStart, end: b.cycleEnd },
      b.assignmentStart,
      b.assignmentEnd,
      b.assignmentStart ?? b.cycleStart
    );
    const approved = approvedStartsByAssignment.get(b.assignmentId) ?? new Set();
    const missing = expected.filter((s) => !approved.has(s));
    b.ready = expected.length > 0 && missing.length === 0;
    b.missingPeriods = missing.length;
  }

  // Group items into invoice cards by (client, cycle window).
  const groupMap = new Map<string, ApprovedGroup>();
  for (const b of bundleMap.values()) {
    const gKey = `${b.clientId}|${b.cycleStart}|${b.cycleEnd}`;
    let g = groupMap.get(gKey);
    if (!g) {
      g = {
        clientId: b.clientId,
        clientName: b.clientName,
        periodStart: b.cycleStart,
        periodEnd: b.cycleEnd,
        items: [],
      };
      groupMap.set(gKey, g);
    }
    const { ready, missingPeriods, ...rest } = b;
    g.items.push({
      key: rest.key,
      employeeName: rest.employeeName,
      assignmentTitle: rest.assignmentTitle,
      regularHours: rest.regularHours,
      otHours: rest.otHours,
      billAmount: rest.billAmount,
      timesheetIds: rest.timesheetIds,
      ready,
      missingPeriods,
    });
  }

  // Sort items so ready ones come first within each card.
  const groups = Array.from(groupMap.values()).map((g) => ({
    ...g,
    items: g.items.sort((a, b) => Number(b.ready) - Number(a.ready)),
  }));

  return (
    <div>
      <PageHeader
        title="Approved hours"
        description="Generate one invoice per client and full billing cycle from approved timesheets."
      />
      <ApprovedList groups={groups} />
    </div>
  );
}
