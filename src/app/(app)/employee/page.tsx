import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { defaultTimezone } from "@/lib/config";
import {
  getCurrentPeriod,
  listPeriodsThrough,
  formatPeriodLabel,
  type Period,
} from "@/lib/periods";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { TimesheetStatusBadge } from "@/components/status-badge";
import type { Assignment, BillingPeriod, Timesheet } from "@/lib/types";
import { openTimesheet } from "./actions";

type AssignmentWithClient = Assignment & { client: { name: string } | null };

type DashItem = {
  assignment: AssignmentWithClient;
  period: Period;
  ts?: Timesheet;
  overdue: boolean;
};

export default async function EmployeeDashboard() {
  const profile = await requireRole("employee", "admin");
  const supabase = await createClient();

  const { data: assignmentsRaw } = await supabase
    .from("assignments")
    .select("*, client:clients(name)")
    .eq("employee_id", profile.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  const assignments = (assignmentsRaw ?? []) as AssignmentWithClient[];

  // Every period from each assignment's start through the current period, so we
  // can surface missed/overdue periods alongside the current open one.
  const periodsByAssignment = new Map<string, Period[]>();
  for (const a of assignments) {
    const cadence = (a.billing_period ?? "weekly") as BillingPeriod;
    const periods = a.start_date
      ? listPeriodsThrough(cadence, defaultTimezone, a.start_date)
      : [getCurrentPeriod(cadence, defaultTimezone)];
    periodsByAssignment.set(a.id, periods);
  }

  // Existing timesheets across all those periods.
  const periodStarts = Array.from(
    new Set(
      Array.from(periodsByAssignment.values())
        .flat()
        .map((p) => p.start)
    )
  );
  const { data: tsRaw } = periodStarts.length
    ? await supabase
        .from("timesheets")
        .select("*")
        .eq("employee_id", profile.id)
        .in("period_start", periodStarts)
    : { data: [] as Timesheet[] };
  const timesheets = (tsRaw ?? []) as Timesheet[];

  function findTimesheet(assignmentId: string, period: Period) {
    return timesheets.find(
      (t) => t.assignment_id === assignmentId && t.period_start === period.start
    );
  }

  // Split into overdue (past periods never submitted) and current. A past
  // period only needs attention if it has no timesheet yet or is still a draft;
  // submitted/approved/invoiced/paid periods are done and stay out of the way.
  const overdueItems: DashItem[] = [];
  const currentItems: DashItem[] = [];
  for (const a of assignments) {
    const periods = periodsByAssignment.get(a.id)!;
    const current = periods[periods.length - 1];
    for (const period of periods) {
      const ts = findTimesheet(a.id, period);
      if (period.start === current.start) {
        currentItems.push({ assignment: a, period, ts, overdue: false });
      } else if (!ts || ts.status === "draft") {
        overdueItems.push({ assignment: a, period, ts, overdue: true });
      }
    }
  }
  // Oldest overdue first, so people clear the backlog in order.
  overdueItems.sort((x, y) => x.period.start.localeCompare(y.period.start));

  function renderCard(item: DashItem) {
    const { assignment: a, period, ts, overdue } = item;
    const rejected = ts?.status === "draft" && Boolean(ts.review_note);
    return (
      <Card
        key={`${a.id}-${period.start}`}
        className={overdue ? "border-warning/50" : undefined}
      >
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle>{a.client?.name ?? "Client"}</CardTitle>
              <CardDescription>{a.title || "Assignment"}</CardDescription>
            </div>
            {overdue ? (
              <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium">
                Overdue
              </span>
            ) : ts ? (
              <TimesheetStatusBadge status={ts.status} />
            ) : (
              <span className="text-xs text-muted-foreground">Not started</span>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="text-sm">
            <span className="text-muted-foreground">
              {overdue ? "Missed period: " : "Current period: "}
            </span>
            <span className="font-medium">{formatPeriodLabel(period)}</span>
          </div>
          {ts && (
            <div className="text-sm text-muted-foreground">
              {ts.total_regular_hours}h regular · {ts.total_ot_hours}h OT
            </div>
          )}
          {rejected && (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <p className="font-medium">Returned for changes</p>
              <p className="text-muted-foreground">{ts!.review_note}</p>
            </div>
          )}
          <form action={openTimesheet}>
            <input type="hidden" name="assignmentId" value={a.id} />
            <input type="hidden" name="periodStart" value={period.start} />
            <input type="hidden" name="periodEnd" value={period.end} />
            <Button
              type="submit"
              className="w-full"
              variant={overdue ? "outline" : "default"}
            >
              {ts
                ? ts.status === "draft"
                  ? "Continue timesheet"
                  : "View timesheet"
                : overdue
                  ? "Fill missed timesheet"
                  : "Start timesheet"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <PageHeader
        title={`Welcome, ${profile.full_name?.split(" ")[0] || "there"}`}
        description="Your active assignments and the current open period for each."
      />

      {assignments.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            You have no active assignments yet. An administrator will set these
            up.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {overdueItems.length > 0 && (
            <div className="grid gap-3">
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                <span className="font-medium">
                  You have {overdueItems.length} past{" "}
                  {overdueItems.length === 1 ? "period" : "periods"} that still
                  need a timesheet.
                </span>{" "}
                Please complete {overdueItems.length === 1 ? "it" : "them"}{" "}
                below.
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {overdueItems.map(renderCard)}
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {currentItems.map(renderCard)}
          </div>
        </div>
      )}

      <div className="mt-8">
        <Button variant="outline" asChild>
          <Link href="/employee/timesheets">
            <FileText className="h-4 w-4" />
            View all my timesheets
          </Link>
        </Button>
      </div>
    </div>
  );
}
