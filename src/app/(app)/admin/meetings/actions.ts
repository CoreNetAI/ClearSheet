"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import {
  addEmployeeToCycle,
  cancelMeeting,
  meetingSettings,
  rescheduleMeeting,
  sendMeetingNow,
  type MeetingOutcome,
} from "@/lib/meetings";
import { zonedToUtc } from "@/lib/meeting-schedule";

export type MeetingActionData = { message: string; warning?: string };

async function adminContext() {
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
  if (profile?.role !== "admin") return null;
  return { supabase, userId: user.id };
}

const uuid = z.string().uuid();

async function finish(
  ctx: NonNullable<Awaited<ReturnType<typeof adminContext>>>,
  outcome: MeetingOutcome,
  audit: { entityId: string; action: string; detail?: Record<string, unknown> }
): Promise<ActionResult<MeetingActionData>> {
  if (!outcome.ok) return actionError(outcome.error);
  await writeAudit(ctx.supabase, {
    actorId: ctx.userId,
    entityType: "meeting",
    ...audit,
    detail: { ...audit.detail, ...(outcome.warning ? { warning: outcome.warning } : {}) },
  });
  revalidatePath("/admin/meetings");
  return actionOk({ message: outcome.message, warning: outcome.warning });
}

/** `date` (yyyy-MM-dd) and `time` (HH:mm) are in the firm's timezone. */
export async function rescheduleMeetingAction(
  meetingId: string,
  date: string,
  time: string
): Promise<ActionResult<MeetingActionData>> {
  if (!uuid.safeParse(meetingId).success) return actionError("Meeting not found.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return actionError("Pick a date and time.");
  }
  const ctx = await adminContext();
  if (!ctx) return actionError("Not authorized.");

  const { settings } = meetingSettings();
  const newStart = zonedToUtc(date, time, settings.timezone);
  const outcome = await rescheduleMeeting(ctx.supabase, meetingId, newStart);
  return finish(ctx, outcome, {
    entityId: meetingId,
    action: "reschedule",
    detail: { starts_at: newStart.toISOString() },
  });
}

export async function cancelMeetingAction(
  meetingId: string
): Promise<ActionResult<MeetingActionData>> {
  if (!uuid.safeParse(meetingId).success) return actionError("Meeting not found.");
  const ctx = await adminContext();
  if (!ctx) return actionError("Not authorized.");
  const outcome = await cancelMeeting(ctx.supabase, meetingId, ctx.userId);
  return finish(ctx, outcome, { entityId: meetingId, action: "cancel" });
}

export async function sendMeetingNowAction(
  meetingId: string
): Promise<ActionResult<MeetingActionData>> {
  if (!uuid.safeParse(meetingId).success) return actionError("Meeting not found.");
  const ctx = await adminContext();
  if (!ctx) return actionError("Not authorized.");
  const outcome = await sendMeetingNow(ctx.supabase, meetingId);
  return finish(ctx, outcome, { entityId: meetingId, action: "send_invite" });
}

export async function addToCycleAction(
  cycleId: string,
  employeeId: string
): Promise<ActionResult<MeetingActionData>> {
  if (!uuid.safeParse(cycleId).success || !uuid.safeParse(employeeId).success) {
    return actionError("Not found.");
  }
  const ctx = await adminContext();
  if (!ctx) return actionError("Not authorized.");
  const outcome = await addEmployeeToCycle(ctx.supabase, cycleId, employeeId);
  return finish(ctx, outcome, {
    entityId: cycleId,
    action: "add_employee",
    detail: { employee_id: employeeId },
  });
}
