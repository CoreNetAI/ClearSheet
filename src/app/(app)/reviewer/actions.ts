"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { computeTotals } from "@/lib/calc";
import { rateForPeriod } from "@/lib/rates";
import { entrySchema } from "@/lib/validation";
import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import type { EntryInput } from "@/lib/validation";

async function reviewerContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !["reviewer", "admin"].includes(profile.role)) return null;
  return { supabase, userId: user.id };
}

export async function approveTimesheet(
  timesheetId: string
): Promise<ActionResult> {
  const ctx = await reviewerContext();
  if (!ctx) return actionError("Not authorized.");
  const { supabase, userId } = ctx;

  const { data: ts } = await supabase
    .from("timesheets")
    .select("id, status")
    .eq("id", timesheetId)
    .maybeSingle();
  if (!ts) return actionError("Timesheet not found.");
  if (ts.status !== "submitted")
    return actionError("Only submitted timesheets can be approved.");

  const { error } = await supabase
    .from("timesheets")
    .update({
      status: "approved",
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_note: null,
    })
    .eq("id", timesheetId);
  if (error) return actionError("Could not approve.");

  await writeAudit(supabase, {
    actorId: userId,
    entityType: "timesheet",
    entityId: timesheetId,
    action: "approve",
  });

  revalidatePath("/reviewer");
  revalidatePath(`/reviewer/${timesheetId}`);
  return actionOk();
}

export async function rejectTimesheet(
  timesheetId: string,
  note: string
): Promise<ActionResult> {
  const parsed = z.string().min(1).max(1000).safeParse(note);
  if (!parsed.success) return actionError("A note is required to reject.");

  const ctx = await reviewerContext();
  if (!ctx) return actionError("Not authorized.");
  const { supabase, userId } = ctx;

  const { data: ts } = await supabase
    .from("timesheets")
    .select("id, status")
    .eq("id", timesheetId)
    .maybeSingle();
  if (!ts) return actionError("Timesheet not found.");
  if (ts.status !== "submitted")
    return actionError("Only submitted timesheets can be rejected.");

  const { error } = await supabase
    .from("timesheets")
    .update({
      status: "draft",
      review_note: parsed.data,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      submitted_at: null,
    })
    .eq("id", timesheetId);
  if (error) return actionError("Could not reject.");

  await writeAudit(supabase, {
    actorId: userId,
    entityType: "timesheet",
    entityId: timesheetId,
    action: "reject",
    detail: { note: parsed.data },
  });

  revalidatePath("/reviewer");
  revalidatePath(`/reviewer/${timesheetId}`);
  return actionOk();
}

export async function editAndApprove(
  timesheetId: string,
  note: string,
  entries: EntryInput[]
): Promise<ActionResult> {
  const parsed = z
    .object({
      note: z.string().min(1, "A note is required").max(1000),
      entries: z.array(entrySchema).max(62),
    })
    .safeParse({ note, entries });
  if (!parsed.success) {
    return actionError(
      parsed.error.issues[0]?.message || "Invalid edit data."
    );
  }

  const ctx = await reviewerContext();
  if (!ctx) return actionError("Not authorized.");
  const { supabase, userId } = ctx;

  const { data: ts } = await supabase
    .from("timesheets")
    .select("id, status, assignment_id, period_start")
    .eq("id", timesheetId)
    .maybeSingle();
  if (!ts) return actionError("Timesheet not found.");
  if (ts.status !== "submitted")
    return actionError("Only submitted timesheets can be edited.");

  // Price the period at the rate in force on its start date (rate history).
  const rate = await rateForPeriod(supabase, ts.assignment_id, ts.period_start);
  const totals = computeTotals(parsed.data.entries, rate);

  // Replace entries with the reviewer's edited set.
  const del = await supabase
    .from("timesheet_entries")
    .delete()
    .eq("timesheet_id", timesheetId);
  if (del.error) return actionError("Could not update entries.");

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

  const { error } = await supabase
    .from("timesheets")
    .update({
      status: "approved",
      total_regular_hours: totals.totalRegularHours,
      total_ot_hours: totals.totalOtHours,
      bill_amount: totals.billAmount,
      pay_amount: totals.payAmount,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_note: parsed.data.note,
    })
    .eq("id", timesheetId);
  if (error) return actionError("Could not approve.");

  await writeAudit(supabase, {
    actorId: userId,
    entityType: "timesheet",
    entityId: timesheetId,
    action: "edit_and_approve",
    detail: { note: parsed.data.note, totals },
  });

  revalidatePath("/reviewer");
  revalidatePath(`/reviewer/${timesheetId}`);
  return actionOk();
}
