import { Download } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { effectiveRate } from "@/lib/rates";
import { defaultTimezone } from "@/lib/config";
import { getCurrentPeriod } from "@/lib/periods";
import type { AssignmentRate } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip, Tip } from "@/components/ui/tooltip";
import {
  PayrollPreview,
  type PayrollRow,
} from "@/components/finance/payroll-preview";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  await requireRole("finance", "admin");
  const sp = await searchParams;
  const month = getCurrentPeriod("monthly", defaultTimezone);
  const start = DATE_RE.test(sp.start ?? "") ? sp.start! : month.start;
  const end = DATE_RE.test(sp.end ?? "") ? sp.end! : month.end;

  const supabase = await createClient();
  const { data } = await supabase
    .from("timesheets")
    .select(
      "id, period_start, assignment_id, total_regular_hours, total_ot_hours, pay_amount, employee:profiles!employee_id(full_name), assignment:assignments(employment_type, vendor, client:clients(name))"
    )
    .in("status", ["approved", "invoiced", "paid"])
    .gte("period_start", start)
    .lte("period_start", end)
    .order("period_start", { ascending: true });

  const rows = (data ?? []) as unknown as {
    id: string;
    period_start: string;
    assignment_id: string;
    total_regular_hours: number;
    total_ot_hours: number;
    pay_amount: number;
    employee: { full_name: string | null } | null;
    assignment: {
      employment_type: string | null;
      vendor: string | null;
      client: { name: string } | null;
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

  const previewRows: PayrollRow[] = rows.map((r) => ({
    id: r.id,
    employeeName: r.employee?.full_name ?? "—",
    vendor: r.assignment?.vendor ?? "",
    client: r.assignment?.client?.name ?? "",
    type: r.assignment?.employment_type ?? "",
    regular: Number(r.total_regular_hours),
    ot: Number(r.total_ot_hours),
    payRate: effectiveRate(
      ratesByAssignment.get(r.assignment_id) ?? [],
      r.period_start
    ).pay_rate,
    gross: Number(r.pay_amount),
  }));

  return (
    <div>
      <PageHeader
        title="Payroll export"
        description="Gross pay for approved hours in a chosen period."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Select period</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="grid gap-1">
              <Label htmlFor="start" className="flex items-center gap-1.5">
                Start
                <InfoTip content="Only timesheets whose period STARTS on or after this date are included. Pick the first day of the pay period." />
              </Label>
              <Input id="start" name="start" type="date" defaultValue={start} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="end" className="flex items-center gap-1.5">
                End
                <InfoTip content="Only timesheets whose period starts on or before this date are included. Pick the last day of the pay period." />
              </Label>
              <Input id="end" name="end" type="date" defaultValue={end} />
            </div>
            <Tip content="Reload the preview below for the chosen date range.">
              <Button type="submit" variant="outline">
                Update
              </Button>
            </Tip>
            <Tip content="Download the payroll run for this date range as a CSV (opens in any spreadsheet).">
              <Button variant="outline" asChild>
                <a href={`/finance/payroll/export?start=${start}&end=${end}&format=csv`}>
                  <Download className="h-4 w-4" />
                  CSV
                </a>
              </Button>
            </Tip>
            <Tip content="Download the payroll run for this date range as an Excel (.xlsx) file with all pay columns (vendor, terms, notes, gross).">
              <Button asChild>
                <a href={`/finance/payroll/export?start=${start}&end=${end}&format=xlsx`}>
                  <Download className="h-4 w-4" />
                  Excel
                </a>
              </Button>
            </Tip>
          </form>
        </CardContent>
      </Card>

      <PayrollPreview rows={previewRows} />
    </div>
  );
}
