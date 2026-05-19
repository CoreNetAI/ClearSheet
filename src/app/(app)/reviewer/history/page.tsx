import Link from "next/link";

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TimesheetStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { Timesheet } from "@/lib/types";

export default async function ReviewerHistoryPage() {
  await requireRole("reviewer", "admin");
  const supabase = await createClient();

  const { data } = await supabase
    .from("timesheets")
    .select(
      "*, employee:profiles!employee_id(full_name), reviewer:profiles!reviewed_by(full_name), assignment:assignments(client:clients(name))"
    )
    .not("reviewed_at", "is", null)
    .order("reviewed_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as unknown as (Timesheet & {
    employee: { full_name: string | null } | null;
    reviewer: { full_name: string | null } | null;
    assignment: { client: { name: string } | null } | null;
  })[];

  return (
    <div>
      <PageHeader
        title="Review history"
        description="Recently reviewed timesheets."
      />
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-10 text-center text-muted-foreground">
              Nothing reviewed yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Approved by</TableHead>
                  <TableHead>Reviewed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      {t.employee?.full_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      {t.assignment?.client?.name ?? "—"}
                    </TableCell>
                    <TableCell>
                      {formatDate(t.period_start)} – {formatDate(t.period_end)}
                    </TableCell>
                    <TableCell>{t.reviewer?.full_name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(t.reviewed_at)}
                    </TableCell>
                    <TableCell>
                      <TimesheetStatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/reviewer/${t.id}`}>View</Link>
                      </Button>
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
