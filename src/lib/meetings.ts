import "server-only";
import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { firm } from "@/lib/config";
import { getEmailContent, isEmailEnabled, isTestAddress, sendEmail } from "@/lib/email";
import { renderEmail, type EmailTemplateKey } from "@/lib/email-templates";
import { buildIcs } from "@/lib/ics";
import {
  cycleSlots,
  cyclesDue,
  formatMeetingDate,
  formatMeetingTime,
  overlaps,
  readMeetingSettings,
  shuffle,
  type CycleWindow,
  type MeetingSettings,
} from "@/lib/meeting-schedule";
import {
  createZoomMeeting,
  deleteZoomMeeting,
  isZoomConfigured,
  updateZoomMeeting,
  ZoomError,
} from "@/lib/zoom";

type Db = SupabaseClient;

export const MEETING_COLUMNS =
  "id, cycle_id, employee_id, starts_at, duration_minutes, status, cancel_reason, canceled_at, zoom_meeting_id, zoom_join_url, invite_sent_at, invite_claimed_at, attempts, last_attempt_at, last_error, sequence";

export interface MeetingRow {
  id: string;
  cycle_id: string;
  employee_id: string;
  starts_at: string;
  duration_minutes: number;
  status: "scheduled" | "canceled";
  cancel_reason: string | null;
  canceled_at: string | null;
  zoom_meeting_id: string | null;
  zoom_join_url: string | null;
  invite_sent_at: string | null;
  invite_claimed_at: string | null;
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
  sequence: number;
}

interface EmployeeRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  status: string;
  invite_status: string;
}

export type MeetingOutcome =
  | { ok: true; message: string; warning?: string }
  | { ok: false; error: string };

/** How long a cron run may hold a meeting while sending. */
const CLAIM_MS = 5 * 60_000;
/** Earliest a generated or moved meeting may start. */
const MIN_LEAD_MS = 60 * 60_000;
const MAX_INVITES_PER_RUN = 25;

export function meetingSettings() {
  return readMeetingSettings();
}

/** Problems that block creating Zoom meetings or sending meeting emails. */
export function deliveryProblems(s: MeetingSettings): string[] {
  const problems: string[] = [];
  if (s.conductors.length === 0) problems.push("MEETING_CONDUCTORS is not set.");
  if (!isZoomConfigured()) problems.push("Zoom is not configured (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET).");
  if (!isEmailEnabled()) problems.push("Email is not configured (RESEND_API_KEY).");
  return problems;
}

function cryptoRandom(): number {
  return randomInt(0, 2 ** 32) / 2 ** 32;
}

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

function firstName(fullName: string | null): string {
  return fullName?.trim().split(/\s+/)[0] || "there";
}

async function loadMeeting(db: Db, id: string): Promise<MeetingRow | null> {
  const { data } = await db.from("meetings").select(MEETING_COLUMNS).eq("id", id).maybeSingle();
  return (data as MeetingRow | null) ?? null;
}

async function loadEmployee(db: Db, id: string): Promise<EmployeeRow | null> {
  const { data } = await db
    .from("profiles")
    .select("id, full_name, email, role, status, invite_status")
    .eq("id", id)
    .maybeSingle();
  return (data as EmployeeRow | null) ?? null;
}

function isEligible(e: EmployeeRow | null): e is EmployeeRow {
  return Boolean(
    e && e.role === "employee" && e.status === "active" && e.invite_status === "accepted"
  );
}

async function eligibleEmployees(db: Db): Promise<EmployeeRow[]> {
  const { data, error } = await db
    .from("profiles")
    .select("id, full_name, email, role, status, invite_status")
    .eq("role", "employee")
    .eq("status", "active")
    .eq("invite_status", "accepted")
    .order("id");
  if (error) throw new Error(`Could not load employees: ${error.message}`);
  return (data ?? []) as EmployeeRow[];
}

/** "Sam Lee, Alex Kim": conductors' names from their profiles, else emails. */
async function conductorNames(db: Db, emails: string[]): Promise<string> {
  if (emails.length === 0) return "";
  const { data } = await db.from("profiles").select("email, full_name").not("email", "is", null);
  const byEmail = new Map(
    (data ?? []).map((p: { email: string; full_name: string | null }) => [
      p.email.toLowerCase(),
      p.full_name?.trim(),
    ])
  );
  return emails.map((e) => byEmail.get(e) || e).join(", ");
}

/**
 * Marks a meeting as being worked on. Returns false when another run already
 * holds it, so the same email is never sent twice.
 */
async function claim(db: Db, id: string, now: Date): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - CLAIM_MS).toISOString();
  const { data } = await db
    .from("meetings")
    .update({ invite_claimed_at: now.toISOString() })
    .eq("id", id)
    .or(`invite_claimed_at.is.null,invite_claimed_at.lt."${staleBefore}"`)
    .select("id");
  return (data?.length ?? 0) > 0;
}

function isBusy(m: MeetingRow, now: Date): boolean {
  return Boolean(
    m.invite_claimed_at && now.getTime() - Date.parse(m.invite_claimed_at) < CLAIM_MS
  );
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

type NoticeKind = "invite" | "rescheduled" | "canceled";

const NOTICE_TEMPLATE: Record<NoticeKind, EmailTemplateKey> = {
  invite: "meeting_invite",
  rescheduled: "meeting_rescheduled",
  canceled: "meeting_canceled",
};

async function sendNotice(
  db: Db,
  s: MeetingSettings,
  m: MeetingRow,
  employee: EmployeeRow,
  kind: NoticeKind,
  previousStart?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!employee.email) return { ok: false, error: "The employee has no email address." };
  const tz = s.timezone;
  const conductors = await conductorNames(db, s.conductors);
  const duration = `${m.duration_minutes} minutes`;
  const variables: Record<string, string> = {
    employeeName: firstName(employee.full_name),
    meetingDate: formatMeetingDate(m.starts_at, tz),
    meetingTime: formatMeetingTime(m.starts_at, tz),
    duration,
    conductors,
    firmName: firm.name,
    previousDate: previousStart ? formatMeetingDate(previousStart, tz) : "",
    previousTime: previousStart ? formatMeetingTime(previousStart, tz) : "",
  };
  const details = [
    { label: "Date", value: variables.meetingDate },
    { label: "Time", value: variables.meetingTime },
    { label: "Length", value: duration },
    { label: "With", value: conductors },
    ...(kind !== "canceled" && m.zoom_join_url
      ? [{ label: "Zoom", value: m.zoom_join_url }]
      : []),
  ];
  const email = renderEmail(await getEmailContent(NOTICE_TEMPLATE[kind]), variables, {
    details,
    buttonUrl: kind === "canceled" ? null : m.zoom_join_url,
  });

  const ics = buildIcs({
    uid: `meeting-${m.id}@clearsheet`,
    sequence: m.sequence + (kind === "canceled" ? 1 : 0),
    start: new Date(m.starts_at),
    durationMinutes: m.duration_minutes,
    summary: `1:1 meeting — ${employee.full_name || "Employee"}`,
    description: m.zoom_join_url ? `Join Zoom meeting: ${m.zoom_join_url}` : undefined,
    location: kind === "canceled" ? null : m.zoom_join_url,
    organizerEmail: s.conductors[0],
    canceled: kind === "canceled",
  });

  return sendEmail({
    to: [employee.email, ...s.conductors],
    subject: email.subject,
    html: email.html,
    attachments: [
      {
        filename: kind === "canceled" ? "meeting-canceled.ics" : "meeting.ics",
        content: new TextEncoder().encode(ics),
        contentType: "text/calendar; charset=utf-8",
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

function zoomInput(s: MeetingSettings, m: MeetingRow, employee: EmployeeRow) {
  return {
    topic: `${firm.name} 1:1 — ${employee.full_name || employee.email || "Employee"}`,
    startsAt: new Date(m.starts_at),
    durationMinutes: m.duration_minutes,
    timezone: s.timezone,
  };
}

/** Creates the Zoom meeting if it doesn't exist yet and saves its link. */
async function ensureZoom(
  db: Db,
  s: MeetingSettings,
  m: MeetingRow,
  employee: EmployeeRow
): Promise<MeetingRow> {
  if (m.zoom_meeting_id && m.zoom_join_url) return m;
  const zoom = await createZoomMeeting(s.conductors[0], zoomInput(s, m, employee));
  // Save right away so a later email failure never creates a second meeting.
  const { error } = await db
    .from("meetings")
    .update({ zoom_meeting_id: zoom.id, zoom_join_url: zoom.joinUrl })
    .eq("id", m.id);
  if (error) {
    await deleteZoomMeeting(zoom.id).catch(() => {});
    throw new Error(`Could not save the Zoom link: ${error.message}`);
  }
  return { ...m, zoom_meeting_id: zoom.id, zoom_join_url: zoom.joinUrl };
}

async function cancelRow(
  db: Db,
  m: MeetingRow,
  reason: string,
  actorId: string | null,
  now: Date
) {
  return db
    .from("meetings")
    .update({
      status: "canceled",
      cancel_reason: reason,
      canceled_at: now.toISOString(),
      canceled_by: actorId,
      invite_claimed_at: null,
    })
    .eq("id", m.id);
}

// ---------------------------------------------------------------------------
// Sending an invite (cron, or "Send now" on the admin screen)
// ---------------------------------------------------------------------------

/**
 * Sends the meeting email for a claimed meeting: checks the employee is still
 * active, creates the Zoom meeting if needed, and emails the employee and
 * conductors. Always releases the claim.
 */
async function deliverInvite(
  db: Db,
  s: MeetingSettings,
  m: MeetingRow,
  now: Date
): Promise<MeetingOutcome & { canceled?: boolean }> {
  const employee = await loadEmployee(db, m.employee_id);
  if (!isEligible(employee)) {
    // Deactivated (or role changed) since the cycle was generated.
    if (m.zoom_meeting_id) await deleteZoomMeeting(m.zoom_meeting_id).catch(() => {});
    await cancelRow(db, m, "Employee is no longer an active employee", null, now);
    return { ok: true, canceled: true, message: "Canceled: the employee is no longer active." };
  }

  const fail = async (error: string): Promise<MeetingOutcome> => {
    await db
      .from("meetings")
      .update({
        last_error: error,
        attempts: m.attempts + 1,
        last_attempt_at: now.toISOString(),
        invite_claimed_at: null,
      })
      .eq("id", m.id);
    return { ok: false, error };
  };

  if (!employee.email) return fail("The employee has no email address.");
  if (isTestAddress(employee.email)) {
    return fail(`Not sent: ${employee.email} is a test address.`);
  }
  const problems = deliveryProblems(s);
  if (problems.length) return fail(problems.join(" "));

  let ready: MeetingRow;
  try {
    ready = await ensureZoom(db, s, m, employee);
  } catch (e) {
    return fail(errorText(e));
  }

  const sent = await sendNotice(db, s, ready, employee, "invite");
  if (!sent.ok) return fail(`Email failed: ${sent.error}`);

  await db
    .from("meetings")
    .update({
      invite_sent_at: now.toISOString(),
      invite_claimed_at: null,
      last_error: null,
      attempts: m.attempts + 1,
      last_attempt_at: now.toISOString(),
    })
    .eq("id", m.id);
  return { ok: true, message: "Invite sent." };
}

/** Wait 1, 2, 4 … up to 30 minutes between retries of a failing meeting. */
function retryReady(m: MeetingRow, now: Date): boolean {
  if (m.attempts === 0 || !m.last_attempt_at) return true;
  const waitMin = Math.min(2 ** (m.attempts - 1), 30);
  return now.getTime() - Date.parse(m.last_attempt_at) >= waitMin * 60_000;
}

async function sendDueInvites(db: Db, s: MeetingSettings, now: Date) {
  const result = {
    sent: 0,
    canceled: 0,
    failed: [] as { meetingId: string; error: string }[],
  };
  const dueBy = new Date(now.getTime() + s.noticeHours * 3_600_000).toISOString();
  const { data, error } = await db
    .from("meetings")
    .select(MEETING_COLUMNS)
    .eq("status", "scheduled")
    .is("invite_sent_at", null)
    .gt("starts_at", now.toISOString())
    .lte("starts_at", dueBy)
    .order("starts_at")
    .limit(MAX_INVITES_PER_RUN * 2);
  if (error) {
    result.failed.push({ meetingId: "-", error: `Could not load meetings: ${error.message}` });
    return result;
  }

  const due = ((data ?? []) as MeetingRow[]).filter((m) => retryReady(m, now));
  for (const m of due.slice(0, MAX_INVITES_PER_RUN)) {
    if (!(await claim(db, m.id, now))) continue;
    const outcome = await deliverInvite(db, s, m, now);
    if (!outcome.ok) result.failed.push({ meetingId: m.id, error: outcome.error });
    else if (outcome.canceled) result.canceled += 1;
    else result.sent += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Generating cycles
// ---------------------------------------------------------------------------

async function generateCycle(
  db: Db,
  s: MeetingSettings,
  window: CycleWindow,
  now: Date
): Promise<{ startsOn: string; scheduled: number; unscheduled: number } | null> {
  // Never overlap an existing cycle (for example after MEETING_CYCLE_DAYS changes).
  const { data: overlapping } = await db
    .from("meeting_cycles")
    .select("id")
    .lte("starts_on", window.endsOn)
    .gte("ends_on", window.startsOn)
    .limit(1);
  if (overlapping?.length) return null;

  const earliest = now.getTime() + MIN_LEAD_MS;
  const slots = cycleSlots(s, window).filter((t) => t.getTime() >= earliest);
  const employees = shuffle(await eligibleEmployees(db), cryptoRandom);
  const scheduled = employees.slice(0, slots.length);
  const unscheduled = employees.slice(slots.length);

  const { data: cycle, error } = await db
    .from("meeting_cycles")
    .insert({
      starts_on: window.startsOn,
      ends_on: window.endsOn,
      timezone: s.timezone,
      slot_count: slots.length,
      eligible_count: employees.length,
      unscheduled_employee_ids: unscheduled.map((e) => e.id),
      settings: {
        dayStart: s.dayStart,
        dayEnd: s.dayEnd,
        durationMinutes: s.durationMinutes,
        gapMinutes: s.gapMinutes,
        includeWeekends: s.includeWeekends,
        skipDates: s.skipDates,
        conductors: s.conductors,
      },
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return null; // another run just made it
    throw new Error(`Could not create cycle ${window.startsOn}: ${error.message}`);
  }

  if (scheduled.length) {
    const { error: insertError } = await db.from("meetings").insert(
      scheduled.map((e, i) => ({
        cycle_id: cycle.id,
        employee_id: e.id,
        starts_at: slots[i].toISOString(),
        duration_minutes: s.durationMinutes,
      }))
    );
    if (insertError) {
      // Roll back so the next run tries again from scratch.
      await db.from("meeting_cycles").delete().eq("id", cycle.id);
      throw new Error(`Could not create meetings for ${window.startsOn}: ${insertError.message}`);
    }
  }
  return {
    startsOn: window.startsOn,
    scheduled: scheduled.length,
    unscheduled: unscheduled.length,
  };
}

// ---------------------------------------------------------------------------
// Cron entry point
// ---------------------------------------------------------------------------

export interface MeetingCronResult {
  ok: boolean;
  skipped?: string;
  settingsErrors: string[];
  cyclesGenerated: { startsOn: string; scheduled: number; unscheduled: number }[];
  invitesSent: number;
  canceledInactive: number;
  failures: { meetingId: string; error: string }[];
}

export async function runMeetingCron(db: Db, now = new Date()): Promise<MeetingCronResult> {
  const { settings: s, errors } = meetingSettings();
  const result: MeetingCronResult = {
    ok: true,
    settingsErrors: errors,
    cyclesGenerated: [],
    invitesSent: 0,
    canceledInactive: 0,
    failures: [],
  };
  if (errors.length) {
    return { ...result, ok: false, skipped: "Meeting settings are incomplete." };
  }

  for (const window of cyclesDue(s, now)) {
    try {
      const made = await generateCycle(db, s, window, now);
      if (made) result.cyclesGenerated.push(made);
    } catch (e) {
      result.failures.push({ meetingId: "-", error: errorText(e) });
    }
  }

  const invites = await sendDueInvites(db, s, now);
  result.invitesSent = invites.sent;
  result.canceledInactive = invites.canceled;
  result.failures.push(...invites.failed);
  result.ok = result.failures.length === 0;
  return result;
}

// ---------------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------------

async function findOverlap(
  db: Db,
  start: Date,
  durationMinutes: number,
  exceptId?: string
): Promise<MeetingRow | null> {
  const from = new Date(start.getTime() - 240 * 60_000).toISOString();
  const to = new Date(start.getTime() + durationMinutes * 60_000).toISOString();
  const { data } = await db
    .from("meetings")
    .select(MEETING_COLUMNS)
    .eq("status", "scheduled")
    .gte("starts_at", from)
    .lt("starts_at", to);
  return (
    ((data ?? []) as MeetingRow[]).find(
      (o) =>
        o.id !== exceptId &&
        overlaps(start, durationMinutes, new Date(o.starts_at), o.duration_minutes)
    ) ?? null
  );
}

function describe(s: MeetingSettings, iso: string): string {
  return `${formatMeetingDate(iso, s.timezone)} at ${formatMeetingTime(iso, s.timezone)}`;
}

export async function rescheduleMeeting(
  db: Db,
  meetingId: string,
  newStart: Date,
  now = new Date()
): Promise<MeetingOutcome> {
  const { settings: s } = meetingSettings();
  const m = await loadMeeting(db, meetingId);
  if (!m) return { ok: false, error: "Meeting not found." };
  if (m.status !== "scheduled") return { ok: false, error: "This meeting is canceled." };
  if (isBusy(m, now)) {
    return { ok: false, error: "This meeting's email is being sent right now. Try again in a minute." };
  }
  if (Number.isNaN(newStart.getTime())) return { ok: false, error: "Pick a valid date and time." };
  if (newStart.getTime() < now.getTime() + 5 * 60_000) {
    return { ok: false, error: "Pick a time at least 5 minutes from now." };
  }
  if (newStart.getTime() === Date.parse(m.starts_at)) {
    return { ok: false, error: "The meeting is already at that time." };
  }
  const clash = await findOverlap(db, newStart, m.duration_minutes, m.id);
  if (clash) {
    return {
      ok: false,
      error: `That time overlaps another meeting (${describe(s, clash.starts_at)}).`,
    };
  }

  const employee = await loadEmployee(db, m.employee_id);
  if (!isEligible(employee)) {
    return { ok: false, error: "This employee is no longer active. Cancel the meeting instead." };
  }

  const previousStart = m.starts_at;
  const moved: MeetingRow = {
    ...m,
    starts_at: newStart.toISOString(),
    sequence: m.sequence + 1,
  };

  // Move the Zoom meeting first, so a Zoom failure leaves everything unchanged.
  if (m.zoom_meeting_id) {
    try {
      await updateZoomMeeting(m.zoom_meeting_id, zoomInput(s, moved, employee));
    } catch (e) {
      if (e instanceof ZoomError && e.notFound) {
        moved.zoom_meeting_id = null; // deleted in Zoom; make a new one below
        moved.zoom_join_url = null;
      } else {
        return { ok: false, error: `Not rescheduled. ${errorText(e)}` };
      }
    }
  }

  const { error } = await db
    .from("meetings")
    .update({
      starts_at: moved.starts_at,
      sequence: moved.sequence,
      zoom_meeting_id: moved.zoom_meeting_id,
      zoom_join_url: moved.zoom_join_url,
      last_error: null,
      attempts: 0,
      last_attempt_at: null,
    })
    .eq("id", m.id);
  if (error) {
    // Put Zoom back where it was.
    if (moved.zoom_meeting_id) {
      await updateZoomMeeting(moved.zoom_meeting_id, zoomInput(s, m, employee)).catch(() => {});
    }
    return {
      ok: false,
      error: error.code === "23505" ? "Another meeting starts at that exact time." : "Could not save the new time.",
    };
  }

  const when = describe(s, moved.starts_at);
  const dueBy = now.getTime() + s.noticeHours * 3_600_000;

  if (m.invite_sent_at) {
    // They already have the old time: tell them now.
    let ready = moved;
    try {
      ready = await ensureZoom(db, s, moved, employee);
    } catch (e) {
      await db.from("meetings").update({ last_error: errorText(e) }).eq("id", m.id);
      return { ok: true, message: `Moved to ${when}.`, warning: `No email sent: ${errorText(e)}` };
    }
    const sent = await sendNotice(db, s, ready, employee, "rescheduled", previousStart);
    if (!sent.ok) {
      await db.from("meetings").update({ last_error: `Email failed: ${sent.error}` }).eq("id", m.id);
      return { ok: true, message: `Moved to ${when}.`, warning: `Email failed: ${sent.error}` };
    }
    await db.from("meetings").update({ invite_sent_at: now.toISOString() }).eq("id", m.id);
    return { ok: true, message: `Moved to ${when}. The employee and conductors were emailed.` };
  }

  if (newStart.getTime() <= dueBy) {
    // Inside the notice window: the invite goes out now instead of waiting.
    if (!(await claim(db, m.id, now))) {
      return { ok: true, message: `Moved to ${when}. The invite will go out within a minute.` };
    }
    const sent = await deliverInvite(db, s, moved, now);
    if (!sent.ok) return { ok: true, message: `Moved to ${when}.`, warning: sent.error };
    return { ok: true, message: `Moved to ${when}. The invite was emailed now.` };
  }

  const inviteAt = new Date(newStart.getTime() - s.noticeHours * 3_600_000).toISOString();
  return { ok: true, message: `Moved to ${when}. The invite will go out ${describe(s, inviteAt)}.` };
}

export async function cancelMeeting(
  db: Db,
  meetingId: string,
  actorId: string,
  now = new Date()
): Promise<MeetingOutcome> {
  const { settings: s } = meetingSettings();
  const m = await loadMeeting(db, meetingId);
  if (!m) return { ok: false, error: "Meeting not found." };
  if (m.status !== "scheduled") return { ok: false, error: "This meeting is already canceled." };
  if (isBusy(m, now)) {
    return { ok: false, error: "This meeting's email is being sent right now. Try again in a minute." };
  }

  const warnings: string[] = [];
  if (m.zoom_meeting_id) {
    try {
      await deleteZoomMeeting(m.zoom_meeting_id);
    } catch (e) {
      warnings.push(`The Zoom meeting could not be deleted; delete it in Zoom. ${errorText(e)}`);
    }
  }

  const { error } = await cancelRow(db, m, "Canceled by admin", actorId, now);
  if (error) return { ok: false, error: "Could not cancel the meeting." };

  let message = "Meeting canceled.";
  if (m.invite_sent_at) {
    const employee = await loadEmployee(db, m.employee_id);
    if (employee?.email && !isTestAddress(employee.email)) {
      const sent = await sendNotice(db, s, m, employee, "canceled");
      if (sent.ok) message = "Meeting canceled. The employee and conductors were emailed.";
      else warnings.push(`Cancellation email failed: ${sent.error}`);
    }
  } else {
    message = "Meeting canceled. No email was needed: the invite hadn't gone out yet.";
  }
  return warnings.length ? { ok: true, message, warning: warnings.join(" ") } : { ok: true, message };
}

/** "Send now" / "Resend" on the admin screen. */
export async function sendMeetingNow(
  db: Db,
  meetingId: string,
  now = new Date()
): Promise<MeetingOutcome> {
  const { settings: s } = meetingSettings();
  const m = await loadMeeting(db, meetingId);
  if (!m) return { ok: false, error: "Meeting not found." };
  if (m.status !== "scheduled") return { ok: false, error: "This meeting is canceled." };
  if (Date.parse(m.starts_at) <= now.getTime()) {
    return { ok: false, error: "This meeting has already started." };
  }
  if (!(await claim(db, m.id, now))) {
    return { ok: false, error: "This meeting's email is being sent right now. Try again in a minute." };
  }
  const outcome = await deliverInvite(db, s, { ...m, attempts: 0 }, now);
  if (!outcome.ok) return outcome;
  return outcome.canceled
    ? { ok: true, message: outcome.message }
    : { ok: true, message: m.invite_sent_at ? "Invite sent again." : "Invite sent." };
}

/** Standard slots in a cycle that are free and still in the future. */
export function freeSlots(
  s: MeetingSettings,
  window: CycleWindow,
  meetings: Pick<MeetingRow, "starts_at" | "duration_minutes" | "status">[],
  now: Date,
  leadMs = 5 * 60_000
): Date[] {
  const live = meetings.filter((m) => m.status === "scheduled");
  return cycleSlots(s, window).filter(
    (t) =>
      t.getTime() >= now.getTime() + leadMs &&
      !live.some((m) =>
        overlaps(t, s.durationMinutes, new Date(m.starts_at), m.duration_minutes)
      )
  );
}

/** Puts an eligible employee into the first free slot of a cycle. */
export async function addEmployeeToCycle(
  db: Db,
  cycleId: string,
  employeeId: string,
  now = new Date()
): Promise<MeetingOutcome> {
  const { settings: s } = meetingSettings();
  const { data: cycle } = await db
    .from("meeting_cycles")
    .select("id, starts_on, ends_on, unscheduled_employee_ids")
    .eq("id", cycleId)
    .maybeSingle();
  if (!cycle) return { ok: false, error: "Cycle not found." };

  const employee = await loadEmployee(db, employeeId);
  if (!isEligible(employee)) {
    return { ok: false, error: "Only active employees who accepted their invite can be scheduled." };
  }

  const { data: rows } = await db
    .from("meetings")
    .select(MEETING_COLUMNS)
    .eq("cycle_id", cycleId);
  const meetings = (rows ?? []) as MeetingRow[];
  if (meetings.some((m) => m.employee_id === employeeId && m.status === "scheduled")) {
    return { ok: false, error: "This employee already has a meeting in this cycle." };
  }

  const window = { index: 0, startsOn: cycle.starts_on, endsOn: cycle.ends_on };
  const slot = freeSlots(s, window, meetings, now, MIN_LEAD_MS)[0];
  if (!slot) return { ok: false, error: "No free slots are left in this cycle." };

  const { data: inserted, error } = await db
    .from("meetings")
    .insert({
      cycle_id: cycleId,
      employee_id: employeeId,
      starts_at: slot.toISOString(),
      duration_minutes: s.durationMinutes,
    })
    .select(MEETING_COLUMNS)
    .single();
  if (error || !inserted) {
    return {
      ok: false,
      error: error?.code === "23505" ? "That slot was just taken. Try again." : "Could not add the meeting.",
    };
  }
  await db
    .from("meeting_cycles")
    .update({
      unscheduled_employee_ids: (cycle.unscheduled_employee_ids as string[]).filter(
        (id) => id !== employeeId
      ),
    })
    .eq("id", cycleId);

  const when = describe(s, slot.toISOString());
  if (slot.getTime() <= now.getTime() + s.noticeHours * 3_600_000 && (await claim(db, inserted.id, now))) {
    const sent = await deliverInvite(db, s, inserted as MeetingRow, now);
    if (!sent.ok) return { ok: true, message: `Scheduled for ${when}.`, warning: sent.error };
    return { ok: true, message: `Scheduled for ${when}. The invite was emailed now.` };
  }
  return { ok: true, message: `Scheduled for ${when}.` };
}
