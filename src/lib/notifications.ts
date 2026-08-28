import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  appBaseUrl,
  defaultTimezone,
  firm,
  timesheetReceivedCc,
} from "@/lib/config";
import { getEmailContent, isEmailEnabled, sendEmail } from "@/lib/email";
import { renderEmail, type EmailTemplateKey } from "@/lib/email-templates";
import { formatPeriodLabel } from "@/lib/periods";

/**
 * Emails active reviewers that a timesheet is waiting for them, or admins if
 * there are no reviewers (admins can also review). Never throws: the timesheet
 * is already submitted, so a failed email must not make the submit look failed.
 */
export async function notifyReviewersOfSubmission(
  supabase: SupabaseClient,
  timesheetId: string,
  employeeId: string
): Promise<void> {
  if (!isEmailEnabled()) return;

  try {
    const summary = await loadTimesheetSummary(supabase, timesheetId);
    if (!summary) return;

    const { data: staff } = await supabase
      .from("profiles")
      .select("id, email, role")
      .in("role", ["reviewer", "admin"])
      .eq("status", "active")
      .eq("invite_status", "accepted");
    const active = (staff ?? []).filter(
      (p) => p.email && p.id !== employeeId
    );
    const reviewers = active.filter((p) => p.role === "reviewer");
    const recipients = reviewers.length
      ? reviewers
      : active.filter((p) => p.role === "admin");
    if (recipients.length === 0) {
      console.warn(`No one to notify about timesheet ${timesheetId}`);
      return;
    }

    const email = renderEmail(
      await getEmailContent("timesheet_submitted"),
      {
        firmName: firm.name,
        employeeName:
          summary.employee?.full_name ||
          summary.employee?.email ||
          "An employee",
        ...summary.variables,
      },
      {
        details: summary.details,
        buttonUrl: `${appBaseUrl}/reviewer/${timesheetId}`,
      }
    );

    for (const { email: address } of recipients) {
      const sent = await sendEmail({ to: address, ...email });
      if (!sent.ok) {
        console.error(`Review notification not sent: ${sent.error}`);
      }
    }
  } catch (e) {
    console.error("Review notification failed", e);
  }
}

/**
 * Acknowledges a submission to the employee, echoing their Challenges/Learnings,
 * and copies the CC list from TIMESHEET_RECEIVED_CC. Never throws: the timesheet
 * is already submitted, so a failed email must not make the submit look failed.
 */
export async function notifyEmployeeOfSubmission(
  supabase: SupabaseClient,
  timesheetId: string
): Promise<void> {
  if (!isEmailEnabled()) return;

  try {
    const summary = await loadTimesheetSummary(supabase, timesheetId);
    const email = summary?.employee?.email;
    if (!summary || !email || summary.employee?.status !== "active") return;

    const cc = timesheetReceivedCc();
    if (cc.invalid.length) {
      console.warn(
        `TIMESHEET_RECEIVED_CC has invalid entries, skipped: ${cc.invalid.join(", ")}`
      );
    }

    const submittedAt = formatInFirmTimezone(summary.submittedAt);
    const rendered = renderEmail(
      await getEmailContent("timesheet_received"),
      {
        firmName: firm.name,
        employeeName: summary.employee.full_name?.split(" ")[0] || "there",
        submittedAt,
        ...summary.variables,
      },
      {
        details: [...summary.details, { label: "Submitted", value: submittedAt }],
        note: summary.challengesLearnings || "Not provided.",
        noteLabel: "Your Challenges/Learnings",
        buttonUrl: `${appBaseUrl}/employee/timesheets/${timesheetId}`,
      }
    );
    const sent = await sendEmail({ to: email, cc: cc.valid, ...rendered });
    if (!sent.ok) console.error(`Submission receipt not sent: ${sent.error}`);
  } catch (e) {
    console.error("Submission receipt failed", e);
  }
}

// "Nov 7, 2026, 9:15 AM EST" in the firm's timezone, not the server's (UTC on
// Cloudflare), so employees see the time they actually submitted.
function formatInFirmTimezone(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date();
  return date.toLocaleString("en-US", {
    timeZone: defaultTimezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export type ReviewOutcome = "approved" | "edited_and_approved" | "rejected";

const REVIEW_TEMPLATE: Record<ReviewOutcome, EmailTemplateKey> = {
  approved: "timesheet_approved",
  edited_and_approved: "timesheet_approved_with_changes",
  rejected: "timesheet_returned",
};

/**
 * Tells the employee the outcome of a review. Never throws: the review is
 * already saved, so a failed email must not make it look failed.
 */
export async function notifyEmployeeOfReview(
  supabase: SupabaseClient,
  timesheetId: string,
  outcome: ReviewOutcome,
  note?: string | null
): Promise<void> {
  if (!isEmailEnabled()) return;

  try {
    const summary = await loadTimesheetSummary(supabase, timesheetId);
    const email = summary?.employee?.email;
    if (!summary || !email || summary.employee?.status !== "active") return;

    const rendered = renderEmail(
      await getEmailContent(REVIEW_TEMPLATE[outcome]),
      {
        firmName: firm.name,
        employeeName: summary.employee.full_name?.split(" ")[0] || "there",
        ...summary.variables,
      },
      {
        details: summary.details,
        note,
        buttonUrl: `${appBaseUrl}/employee/timesheets/${timesheetId}`,
      }
    );
    const sent = await sendEmail({ to: email, ...rendered });
    if (!sent.ok) console.error(`Review outcome not sent: ${sent.error}`);
  } catch (e) {
    console.error("Review outcome notification failed", e);
  }
}

async function loadTimesheetSummary(
  supabase: SupabaseClient,
  timesheetId: string
) {
  const { data: ts } = await supabase
    .from("timesheets")
    .select(
      "period_start, period_end, total_regular_hours, total_ot_hours, submitted_at, challenges_learnings, employee:profiles!employee_id(full_name, email, status), assignment:assignments(title, client:clients(name))"
    )
    .eq("id", timesheetId)
    .maybeSingle();
  if (!ts) return null;

  const assignment = first(ts.assignment);
  const client = first(assignment?.client)?.name ?? "Client";
  const title = assignment?.title || "Assignment";
  const period = formatPeriodLabel({
    start: ts.period_start,
    end: ts.period_end,
  });
  const hours = String(
    Number(ts.total_regular_hours) + Number(ts.total_ot_hours)
  );
  return {
    employee: first(ts.employee),
    submittedAt: ts.submitted_at as string | null,
    challengesLearnings: ts.challenges_learnings as string | null,
    variables: { client, title, period, hours },
    details: [
      { label: "Client", value: client },
      { label: "Assignment", value: title },
      { label: "Period", value: period },
      { label: "Hours", value: hours },
    ],
  };
}

// Supabase may type a joined row as either a single object or an array.
function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}
