import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rateForPeriod } from "@/lib/rates";
import { listDays } from "@/lib/periods";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TimesheetStatusBadge } from "@/components/status-badge";
import { TimesheetReadOnly } from "@/components/timesheets/timesheet-readonly";
import { AttachmentPreview } from "@/components/attachments/attachment-preview";
import { ReviewActions } from "@/components/reviewer/review-actions";
import type {
  Assignment,
  Timesheet,
  TimesheetAttachment,
  TimesheetEntry,
} from "@/lib/types";

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireRole("reviewer", "admin");
  const supabase = await createClient();

  const { data } = await supabase
    .from("timesheets")
    .select(
      "*, assignment:assignments(*, client:clients(name)), employee:profiles!employee_id(full_name, email), entries:timesheet_entries(*), attachments:timesheet_attachments(*)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  const ts = data as Timesheet & {
    assignment: (Assignment & { client: { name: string } | null }) | null;
    employee: { full_name: string | null; email: string | null } | null;
    entries: TimesheetEntry[];
    attachments: TimesheetAttachment[];
  };

  const currency = ts.assignment?.currency ?? "USD";
  // Rate in force for this period (rate history) — used for live recompute when
  // the reviewer edits hours. Displayed totals below use the frozen snapshot.
  const rate = await rateForPeriod(supabase, ts.assignment_id, ts.period_start);
  const entries = (ts.entries ?? []).map((e) => ({
    work_date: e.work_date,
    hours: Number(e.hours),
    entry_type: e.entry_type,
  }));
  const attachments = ts.attachments ?? [];
  const isSubmitted = ts.status === "submitted";

  return (
    <div>
      <PageHeader
        title={ts.employee?.full_name ?? "Timesheet"}
        description={`${ts.assignment?.client?.name ?? "Client"} · ${
          ts.assignment?.title || "Assignment"
        } · ${formatDate(ts.period_start)} – ${formatDate(ts.period_end)}`}
        actions={
          <div className="flex items-center gap-2">
            <TimesheetStatusBadge status={ts.status} />
            <Button variant="outline" size="sm" asChild>
              <Link href="/reviewer">
                <ArrowLeft className="h-4 w-4" />
                Queue
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <TimesheetReadOnly
            entries={entries}
            attachments={attachments}
            totals={{
              totalRegularHours: Number(ts.total_regular_hours),
              totalOtHours: Number(ts.total_ot_hours),
              billAmount: Number(ts.bill_amount),
              payAmount: Number(ts.pay_amount),
            }}
            currency={currency}
            challengesLearnings={ts.challenges_learnings}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Approved proof</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            {attachments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No attachment uploaded.
              </p>
            ) : (
              attachments.map((a) => (
                <AttachmentPreview key={a.id} attachment={a} />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {isSubmitted ? (
        <div className="mt-6">
          <ReviewActions
            timesheetId={ts.id}
            periodDays={listDays({
              start: ts.period_start,
              end: ts.period_end,
            })}
            assignment={{
              bill_rate: rate.bill_rate,
              pay_rate: rate.pay_rate,
              overtime_multiplier: rate.overtime_multiplier,
              currency,
            }}
            initialEntries={entries}
          />
        </div>
      ) : (
        ts.review_note && (
          <div className="mt-6 rounded-md border bg-muted/40 px-4 py-3 text-sm">
            <p className="font-medium">Review note</p>
            <p className="text-muted-foreground">{ts.review_note}</p>
          </div>
        )
      )}
    </div>
  );
}
