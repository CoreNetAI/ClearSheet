import Link from "next/link";

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
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

export default async function MyTimesheetsPage() {
  const profile = await requireRole("employee", "admin");
  const supabase = await createClient();

  const { data } = await supabase
    .from("timesheets")
    .select("*, assignment:assignments(title, client:clients(name))")
    .eq("employee_id", profile.id)
    .order("period_start", { ascending: false });

  const timesheets = (data ?? []) as (Timesheet & {
    assignment: { title: string | null; client: { name: string } | null } | null;
  })[];

  return (
    <div>
      <PageHeader
        title="My timesheets"
        description="Every timesheet you've created, newest first."
      />
      <Card>
        <CardContent className="p-0">
          {timesheets.length === 0 ? (
            <p className="p-10 text-center text-muted-foreground">
              No timesheets yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Reg</TableHead>
                  <TableHead className="text-right">OT</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {timesheets.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      {formatDate(t.period_start)} – {formatDate(t.period_end)}
                    </TableCell>
                    <TableCell>{t.assignment?.client?.name ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {t.total_regular_hours}
                    </TableCell>
                    <TableCell className="text-right">
                      {t.total_ot_hours}
                    </TableCell>
                    <TableCell>
                      <TimesheetStatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="link" size="sm" asChild>
                        <Link href={`/employee/timesheets/${t.id}`}>
                          {t.status === "draft" ? "Edit" : "View"}
                        </Link>
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
