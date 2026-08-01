import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rateForPeriod } from "@/lib/rates";
import { listDays } from "@/lib/periods";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { TimesheetStatusBadge } from "@/components/status-badge";
import { TimesheetEditor } from "@/components/timesheets/timesheet-editor";
import { TimesheetReadOnly } from "@/components/timesheets/timesheet-readonly";
import type { Assignment, Timesheet, TimesheetEntry, TimesheetAttachment } from "@/lib/types";

export default async function TimesheetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: ts } = await supabase
    .from("timesheets")
    .select(
      "*, assignment:assignments(*, client:clients(name)), reviewer:profiles!reviewed_by(full_name), entries:timesheet_entries(*), attachments:timesheet_attachments(*)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!ts) notFound();

  const timesheet = ts as Timesheet & {
    assignment: (Assignment & { client: { name: string } | null }) | null;
    reviewer: { full_name: string | null } | null;
    entries: TimesheetEntry[];
    attachments: TimesheetAttachment[];
  };

  const assignment = timesheet.assignment;
  const currency = assignment?.currency ?? "USD";
  // Rate in force for this period (rate history), not the assignment's current rate.
  const rate = await rateForPeriod(
    supabase,
    timesheet.assignment_id,
    timesheet.period_start
  );
  const editable =
    timesheet.status === "draft" &&
    (timesheet.employee_id === profile.id || profile.role === "admin");

  const entries = (timesheet.entries ?? []).map((e) => ({
    work_date: e.work_date,
    hours: Number(e.hours),
    entry_type: e.entry_type,
  }));

  const attachments = (timesheet.attachments ?? []).map((a) => ({
    id: a.id,
    file_name: a.file_name,
    attachment_type: a.attachment_type,
    uploaded_at: a.uploaded_at,
  }));

  return (
    <div>
      <PageHeader
        title={assignment?.client?.name ?? "Timesheet"}
        description={`${assignment?.title || "Assignment"} · ${formatDate(
          timesheet.period_start
        )} – ${formatDate(timesheet.period_end)}`}
        actions={
          <div className="flex items-center gap-2">
            <TimesheetStatusBadge status={timesheet.status} />
            <Button variant="outline" size="sm" asChild>
              <Link href="/employee/timesheets">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Link>
            </Button>
          </div>
        }
      />

      {timesheet.reviewed_at &&
        ["approved", "invoiced", "paid"].includes(timesheet.status) && (
        <div className="mb-4 rounded-md border bg-muted/40 px-4 py-3 text-sm">
          <span className="font-medium">Approved by</span>{" "}
          {timesheet.reviewer?.full_name ?? "—"} on{" "}
          {formatDateTime(timesheet.reviewed_at)}
          {timesheet.review_note ? (
            <span className="block text-muted-foreground">
              Note: {timesheet.review_note}
            </span>
          ) : null}
        </div>
      )}

      {editable ? (
        <TimesheetEditor
          timesheetId={timesheet.id}
          periodDays={listDays({
            start: timesheet.period_start,
            end: timesheet.period_end,
          })}
          assignment={{
            bill_rate: rate.bill_rate,
            pay_rate: rate.pay_rate,
            overtime_multiplier: rate.overtime_multiplier,
            currency,
          }}
          initialEntries={entries}
          initialAttachments={attachments}
          reviewNote={timesheet.review_note}
          initialChallengesLearnings={timesheet.challenges_learnings}
        />
      ) : (
        <TimesheetReadOnly
          entries={entries}
          attachments={attachments}
          totals={{
            totalRegularHours: Number(timesheet.total_regular_hours),
            totalOtHours: Number(timesheet.total_ot_hours),
            billAmount: Number(timesheet.bill_amount),
            payAmount: Number(timesheet.pay_amount),
          }}
          currency={currency}
          showAmounts={false}
          challengesLearnings={timesheet.challenges_learnings}
        />
      )}
    </div>
  );
}
