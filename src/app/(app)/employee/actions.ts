"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { computeTotals } from "@/lib/calc";
import { rateForPeriod } from "@/lib/rates";
import { saveTimesheetSchema, entrySchema } from "@/lib/validation";
import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import type { EntryInput } from "@/lib/validation";
import { z } from "zod";

// Create (or fetch) the draft timesheet for an assignment + period, then open
// its editor. Invoked from the dashboard as a form action.
export async function openTimesheet(formData: FormData) {
  const assignmentId = String(formData.get("assignmentId") || "");
  const periodStart = String(formData.get("periodStart") || "");
  const periodEnd = String(formData.get("periodEnd") || "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Confirm the assignment belongs to the caller.
  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, employee_id")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment || assignment.employee_id !== user.id) {
    redirect("/employee?error=assignment");
  }

  // Reuse an existing timesheet for this assignment + period if present.
  const { data: existing } = await supabase
    .from("timesheets")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("period_start", periodStart)
    .maybeSingle();

  let timesheetId = existing?.id as string | undefined;

  if (!timesheetId) {
    const { data: created, error } = await supabase
      .from("timesheets")
      .insert({
        assignment_id: assignmentId,
        employee_id: user.id,
        period_start: periodStart,
        period_end: periodEnd,
        status: "draft",
      })
      .select("id")
      .single();
    if (error || !created) {
      redirect("/employee?error=create");
    }
    timesheetId = created.id;
  }

  redirect(`/employee/timesheets/${timesheetId}`);
}

async function loadEditableTimesheet(timesheetId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Unauthorized" };

  const { data: ts } = await supabase
    .from("timesheets")
    .select("id, employee_id, status, assignment_id, period_start")
    .eq("id", timesheetId)
    .maybeSingle();

  if (!ts || ts.employee_id !== user.id)
    return { ok: false as const, error: "Not found" };
  if (ts.status !== "draft")
    return {
      ok: false as const,
      error: "This timesheet can no longer be edited.",
    };

  // Price the period at the rate in force on its start date (rate history).
  const rate = await rateForPeriod(supabase, ts.assignment_id, ts.period_start);

  return { ok: true as const, supabase, user, ts, rate };
}

export async function saveTimesheet(
  timesheetId: string,
  entries: EntryInput[]
): Promise<ActionResult> {
  const parsed = z
    .object({ timesheetId: z.string().uuid(), entries: z.array(entrySchema).max(62) })
    .safeParse({ timesheetId, entries });
  if (!parsed.success) return actionError("Invalid timesheet data.");

  const ctx = await loadEditableTimesheet(timesheetId);
  if (!ctx.ok) return actionError(ctx.error);
  const { supabase, ts, rate } = ctx;

  const totals = computeTotals(parsed.data.entries, rate);

  // Replace all entries for this draft.
  const del = await supabase
    .from("timesheet_entries")
    .delete()
    .eq("timesheet_id", timesheetId);
  if (del.error) return actionError("Could not save entries.");

  const rows = parsed.data.entries
    .filter((e) => Number(e.hours) > 0)
    .map((e) => ({
      timesheet_id: timesheetId,
      work_date: e.work_date,
      hours: e.hours,
      entry_type: e.entry_type,
      note: e.note ?? null,
    }));

  if (rows.length > 0) {
    const ins = await supabase.from("timesheet_entries").insert(rows);
    if (ins.error) return actionError("Could not save entries.");
  }

  const upd = await supabase
    .from("timesheets")
    .update({
      total_regular_hours: totals.totalRegularHours,
      total_ot_hours: totals.totalOtHours,
      bill_amount: totals.billAmount,
      pay_amount: totals.payAmount,
    })
    .eq("id", timesheetId);
  if (upd.error) return actionError("Could not update totals.");

  void ts;
  revalidatePath(`/employee/timesheets/${timesheetId}`);
  revalidatePath("/employee");
  return actionOk();
}

export async function submitTimesheet(
  timesheetId: string,
  entries: EntryInput[]
): Promise<ActionResult> {
  // Persist latest edits first.
  const saved = await saveTimesheet(timesheetId, entries);
  if (!saved.ok) return saved;

  const ctx = await loadEditableTimesheet(timesheetId);
  if (!ctx.ok) return actionError(ctx.error);
  const { supabase, user } = ctx;

  // Require at least one entry with hours and a required approved-timesheet file.
  const { data: entryRows } = await supabase
    .from("timesheet_entries")
    .select("id, hours")
    .eq("timesheet_id", timesheetId);
  const hasHours = (entryRows ?? []).some((r) => Number(r.hours) > 0);
  if (!hasHours) return actionError("Add at least one day with hours.");

  const { data: atts } = await supabase
    .from("timesheet_attachments")
    .select("id")
    .eq("timesheet_id", timesheetId)
    .eq("attachment_type", "approved_timesheet");
  if (!atts || atts.length === 0) {
    return actionError(
      "Upload the client-approved timesheet before submitting."
    );
  }

  const { error } = await supabase
    .from("timesheets")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      review_note: null,
    })
    .eq("id", timesheetId);
  if (error) return actionError("Could not submit timesheet.");

  await writeAudit(supabase, {
    actorId: user.id,
    entityType: "timesheet",
    entityId: timesheetId,
    action: "submit",
  });

  revalidatePath("/employee");
  revalidatePath("/reviewer");
  return actionOk();
}
