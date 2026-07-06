import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { appBaseUrl, defaultTimezone, firm } from "@/lib/config";
import {
  getCurrentPeriod,
  listPeriodsThrough,
  formatPeriodLabel,
  type Period,
} from "@/lib/periods";
import { isEmailEnabled, sendEmail, timesheetReminderHtml } from "@/lib/email";
import type { Assignment, BillingPeriod, Profile, Timesheet } from "@/lib/types";

export interface ReminderResult {
  ok: boolean;
  emailConfigured: boolean;
  employeesNotified: number;
  remindersSent: number;
  duePeriods: number;
  failures: { email: string; error: string }[];
  skipped?: string;
}

type AssignmentRow = Assignment & { client: { name: string } | null };

interface DueItem {
  client: string;
  title: string;
  periodLabel: string;
}

/**
 * Email every active employee a reminder listing each timesheet period that is
 * still awaiting submission (the current open period plus any missed past ones).
 * Uses the service-role client so it can see all employees; intended to be
 * called from the secured cron endpoint. A period counts as "due" when it has
 * no timesheet yet or one still in `draft` — submitted/approved/etc. are done.
 */
export async function sendTimesheetReminders(): Promise<ReminderResult> {
  const empty: ReminderResult = {
    ok: true,
    emailConfigured: true,
    employeesNotified: 0,
    remindersSent: 0,
    duePeriods: 0,
    failures: [],
  };

  if (!isEmailEnabled()) {
    return { ...empty, ok: false, emailConfigured: false, skipped: "Email not configured" };
  }

  const supabase = createServiceClient();

  const { data: assignmentsRaw } = await supabase
    .from("assignments")
    .select("*, client:clients(name)")
    .eq("status", "active");
  const assignments = (assignmentsRaw ?? []) as AssignmentRow[];
  if (assignments.length === 0) return empty;

  // Active employees who hold those assignments (need their email + name).
  const employeeIds = Array.from(new Set(assignments.map((a) => a.employee_id)));
  const { data: profilesRaw } = await supabase
    .from("profiles")
    .select("id, full_name, email, status")
    .in("id", employeeIds)
    .eq("status", "active");
  const profiles = (profilesRaw ?? []) as Profile[];
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  // Every candidate period per assignment, and the set of period starts to look up.
  const periodsByAssignment = new Map<string, Period[]>();
  const periodStarts = new Set<string>();
  for (const a of assignments) {
    const cadence = (a.billing_period ?? "weekly") as BillingPeriod;
    const periods = a.start_date
      ? listPeriodsThrough(cadence, defaultTimezone, a.start_date)
      : [getCurrentPeriod(cadence, defaultTimezone)];
    periodsByAssignment.set(a.id, periods);
    periods.forEach((p) => periodStarts.add(p.start));
  }

  const { data: tsRaw } = periodStarts.size
    ? await supabase
        .from("timesheets")
        .select("assignment_id, period_start, status")
        .in("employee_id", employeeIds)
        .in("period_start", Array.from(periodStarts))
    : { data: [] as Pick<Timesheet, "assignment_id" | "period_start" | "status">[] };
  const timesheets = (tsRaw ?? []) as Pick<
    Timesheet,
    "assignment_id" | "period_start" | "status"
  >[];

  function statusFor(assignmentId: string, periodStart: string) {
    return timesheets.find(
      (t) => t.assignment_id === assignmentId && t.period_start === periodStart
    )?.status;
  }

  // Group due periods by employee.
  const dueByEmployee = new Map<string, DueItem[]>();
  for (const a of assignments) {
    const periods = periodsByAssignment.get(a.id)!;
    for (const period of periods) {
      const status = statusFor(a.id, period.start);
      const isDue = !status || status === "draft";
      if (!isDue) continue;
      const list = dueByEmployee.get(a.employee_id) ?? [];
      list.push({
        client: a.client?.name ?? "Client",
        title: a.title || "Assignment",
        periodLabel: formatPeriodLabel(period),
      });
      dueByEmployee.set(a.employee_id, list);
    }
  }

  const result: ReminderResult = { ...empty };
  for (const [employeeId, items] of dueByEmployee) {
    const profile = profileById.get(employeeId);
    if (!profile?.email) continue; // inactive, or no email on file
    result.duePeriods += items.length;
    const sent = await sendEmail({
      to: profile.email,
      subject: `Timesheet reminder — ${items.length} period${
        items.length === 1 ? "" : "s"
      } awaiting submission`,
      html: timesheetReminderHtml({
        firmName: firm.name,
        employeeName: profile.full_name?.split(" ")[0] || "there",
        appUrl: appBaseUrl,
        items,
      }),
    });
    if (sent.ok) {
      result.employeesNotified += 1;
      result.remindersSent += 1;
    } else {
      result.failures.push({ email: profile.email, error: sent.error });
    }
  }

  result.ok = result.failures.length === 0;
  return result;
}
