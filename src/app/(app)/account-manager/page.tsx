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
  CardDescription,
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

export default async function AccountManagerPage() {
  const profile = await requireRole("account_manager", "admin");
  const supabase = await createClient();

  // Account managers see only their own clients; admins (the superset role)
  // see every client's overview.
  const isAdmin = profile.role === "admin";
  let clientsQuery = supabase.from("clients").select("id, name");
  if (!isAdmin) {
    clientsQuery = clientsQuery.eq("account_manager_id", profile.id);
  }
  const { data: clients } = await clientsQuery.order("name", {
    ascending: true,
  });

  const clientList = (clients ?? []) as { id: string; name: string }[];
  const clientIds = clientList.map((c) => c.id);

  const { data: assignmentsRaw } = clientIds.length
    ? await supabase
        .from("assignments")
        .select(
          "id, client_id, billing_period, start_date, employee:profiles!employee_id(full_name)"
        )
        .in("client_id", clientIds)
        .eq("status", "active")
    : { data: [] as unknown[] };

  const assignments = (assignmentsRaw ?? []) as unknown as {
    id: string;
    client_id: string;
    billing_period: BillingPeriod | null;
    start_date: string;
    employee: { full_name: string | null } | null;
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

  return (
    <div>
      <RealtimeRefresher channel="am-overview" />
      <PageHeader
        title={isAdmin ? "All clients" : "My clients"}
        description={
          isAdmin
            ? "Current-period submission status across all clients."
            : "Current-period submission status for employees on your clients."
        }
      />

      {clientList.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {isAdmin
              ? "No clients yet."
              : "No clients are assigned to you yet."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {clientList.map((client) => {
            const rows = assignments
              .filter((a) => a.client_id === client.id)
              .map((a) => {
                const period = periodByAssignment.get(a.id)!;
                return {
                  id: a.id,
                  employee: a.employee?.full_name ?? "—",
                  period,
                  status: statusByKey.get(`${a.id}|${period.start}`) ?? null,
                };
              });
            return (
              <Card key={client.id}>
                <CardHeader>
                  <CardTitle>{client.name}</CardTitle>
                  <CardDescription>
                    {rows.length} active assignment{rows.length === 1 ? "" : "s"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {rows.length === 0 ? (
                    <p className="p-6 text-sm text-muted-foreground">
                      No active assignments.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead>Period</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium">
                              {r.employee}
                            </TableCell>
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
            );
          })}
        </div>
      )}
    </div>
  );
}
