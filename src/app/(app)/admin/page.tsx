import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { defaultTimezone } from "@/lib/config";
import {
  getCurrentPeriod,
  formatPeriodLabel,
  type Period,
} from "@/lib/periods";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TimesheetStatusBadge } from "@/components/status-badge";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import type { BillingPeriod, TimesheetStatus } from "@/lib/types";

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-3xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

export default async function AdminDashboard() {
  await requireRole("admin");
  const supabase = await createClient();

  const { data: assignmentsRaw } = await supabase
    .from("assignments")
    .select(
      "id, billing_period, start_date, employee:profiles!employee_id(full_name), client:clients(name)"
    )
    .eq("status", "active");

  const assignments = (assignmentsRaw ?? []) as unknown as {
    id: string;
    billing_period: BillingPeriod | null;
    start_date: string;
    employee: { full_name: string | null } | null;
    client: { name: string } | null;
  }[];

  const periodByAssignment = new Map<string, Period>();
  for (const a of assignments) {
    periodByAssignment.set(
      a.id,
      getCurrentPeriod(
        (a.billing_period ?? "weekly") as BillingPeriod,
        defaultTimezone,
        a.start_date
      )
    );
  }
  const periodStarts = Array.from(
    new Set(Array.from(periodByAssignment.values()).map((p) => p.start))
  );

  const { data: tsRows } = periodStarts.length
    ? await supabase
        .from("timesheets")
        .select("assignment_id, period_start, status")
        .in("period_start", periodStarts)
    : { data: [] as { assignment_id: string; period_start: string; status: TimesheetStatus }[] };

  const statusByKey = new Map<string, TimesheetStatus>();
  for (const t of tsRows ?? []) {
    statusByKey.set(`${t.assignment_id}|${t.period_start}`, t.status);
  }

  const rows = assignments.map((a) => {
    const period = periodByAssignment.get(a.id)!;
    return {
      id: a.id,
      employee: a.employee?.full_name ?? "—",
      client: a.client?.name ?? "—",
      period,
      status: statusByKey.get(`${a.id}|${period.start}`) ?? null,
    };
  });

  const submitted = rows.filter((r) => r.status === "submitted").length;
  const notStarted = rows.filter((r) => r.status === null).length;

  // Exclude the hidden operator account so this matches the Users page count.
  const { count: activeUsers } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .eq("is_operator", false);

  return (
    <div>
      <RealtimeRefresher channel="admin-dashboard" />
      <PageHeader
        title="Submission dashboard"
        description="Live status of the current period across all active assignments."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active users" value={activeUsers ?? 0} />
        <Stat label="Active assignments" value={assignments.length} />
        <Stat label="Awaiting review" value={submitted} />
        <Stat label="Not started" value={notStarted} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current period status</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-10 text-center text-muted-foreground">
              No active assignments.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.employee}</TableCell>
                    <TableCell>{r.client}</TableCell>
                    <TableCell>{formatPeriodLabel(r.period)}</TableCell>
                    <TableCell>
                      {r.status ? (
                        <TimesheetStatusBadge status={r.status} />
                      ) : (
                        <Badge variant="outline">Not started</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
