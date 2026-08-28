import { formatInTimeZone } from "date-fns-tz";

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import {
  MeetingsManager,
  type CycleOption,
  type MeetingItem,
  type MissingEmployee,
  type SlotOption,
} from "@/components/admin/meetings-manager";
import { deliveryProblems, freeSlots, meetingSettings, MEETING_COLUMNS, type MeetingRow } from "@/lib/meetings";
import {
  addDays,
  cycleWindow,
  dateInTz,
  daysBetween,
  slotsPerDay,
} from "@/lib/meeting-schedule";

export const dynamic = "force-dynamic";

type CycleRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  slot_count: number;
  eligible_count: number;
  unscheduled_employee_ids: string[];
};

export default async function AdminMeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  await requireRole("admin");
  const { cycle: requestedCycle } = await searchParams;
  const supabase = await createClient();
  const { settings: s, errors } = meetingSettings();
  const now = new Date();
  const today = dateInTz(now, s.timezone);

  const { data: cycleData } = await supabase
    .from("meeting_cycles")
    .select("id, starts_on, ends_on, slot_count, eligible_count, unscheduled_employee_ids")
    .order("starts_on", { ascending: false });
  const cycles = (cycleData ?? []) as CycleRow[];

  // Default: the running cycle, else the next one, else the latest.
  const selected =
    cycles.find((c) => c.id === requestedCycle) ??
    cycles.find((c) => c.starts_on <= today && today <= c.ends_on) ??
    [...cycles].reverse().find((c) => c.starts_on > today) ??
    cycles[0] ??
    null;

  let meetings: MeetingItem[] = [];
  let missing: MissingEmployee[] = [];
  let slots: SlotOption[] = [];

  if (selected) {
    const [{ data: rows }, { data: employees }] = await Promise.all([
      supabase
        .from("meetings")
        .select(`${MEETING_COLUMNS}, employee:profiles!employee_id(full_name, email)`)
        .eq("cycle_id", selected.id)
        .order("starts_at"),
      supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "employee")
        .eq("status", "active")
        .eq("invite_status", "accepted")
        .order("full_name"),
    ]);
    const meetingRows = (rows ?? []) as unknown as (MeetingRow & {
      employee: { full_name: string | null; email: string | null } | null;
    })[];

    meetings = meetingRows.map((m) => ({
      id: m.id,
      startsAt: m.starts_at,
      durationMinutes: m.duration_minutes,
      status: m.status,
      cancelReason: m.cancel_reason,
      employeeName: m.employee?.full_name || m.employee?.email || "Unknown employee",
      employeeEmail: m.employee?.email ?? null,
      zoomJoinUrl: m.zoom_join_url,
      inviteSentAt: m.invite_sent_at,
      inviteDueAt: new Date(Date.parse(m.starts_at) - s.noticeHours * 3_600_000).toISOString(),
      lastError: m.last_error,
    }));

    const scheduledIds = new Set(
      meetingRows.filter((m) => m.status === "scheduled").map((m) => m.employee_id)
    );
    missing = ((employees ?? []) as { id: string; full_name: string | null; email: string | null }[])
      .filter((e) => !scheduledIds.has(e.id))
      .map((e) => ({
        id: e.id,
        name: e.full_name || e.email || "Unnamed employee",
        email: e.email,
        overflow: selected.unscheduled_employee_ids.includes(e.id),
      }));

    if (selected.ends_on >= today) {
      slots = freeSlots(
        s,
        { index: 0, startsOn: selected.starts_on, endsOn: selected.ends_on },
        meetingRows,
        now
      ).map((t) => ({
        iso: t.toISOString(),
        date: formatInTimeZone(t, s.timezone, "yyyy-MM-dd"),
        time: formatInTimeZone(t, s.timezone, "HH:mm"),
      }));
    }
  }

  // When the next cycle will be generated, for the setup card.
  let nextCycle: { startsOn: string; generatesOn: string; dueNow: boolean } | null = null;
  if (!errors.length && s.firstCycleStart) {
    const since = daysBetween(s.firstCycleStart, today);
    const current = since < 0 ? 0 : Math.floor(since / s.cycleDays);
    for (const index of [current, current + 1]) {
      const w = cycleWindow(s, index);
      if (w.endsOn < today || cycles.some((c) => c.starts_on === w.startsOn)) continue;
      const generatesOn = addDays(w.startsOn, -s.generateDaysAhead);
      nextCycle = { startsOn: w.startsOn, generatesOn, dueNow: generatesOn <= today };
      break;
    }
  }

  const cycleOptions: CycleOption[] = cycles.map((c) => ({
    id: c.id,
    startsOn: c.starts_on,
    endsOn: c.ends_on,
    slotCount: c.slot_count,
    eligibleCount: c.eligible_count,
  }));

  return (
    <div>
      <PageHeader
        title="Meetings"
        description="Bi-weekly 1:1 Zoom meetings. Employees are shuffled into new slots every cycle."
      />
      <MeetingsManager
        timezone={s.timezone}
        settingsErrors={errors}
        deliveryProblems={errors.length ? [] : deliveryProblems(s)}
        summary={{
          conductors: s.conductors,
          hours: `${s.dayStart}–${s.dayEnd}`,
          durationMinutes: s.durationMinutes,
          gapMinutes: s.gapMinutes,
          includeWeekends: s.includeWeekends,
          cycleDays: s.cycleDays,
          noticeHours: s.noticeHours,
          slotsPerDay: slotsPerDay(s),
          skipDates: s.skipDates,
        }}
        nextCycle={nextCycle}
        cycles={cycleOptions}
        selectedCycleId={selected?.id ?? null}
        meetings={meetings}
        missing={missing}
        freeSlots={slots}
        cycleOpen={Boolean(selected && selected.ends_on >= today)}
        nowIso={now.toISOString()}
      />
    </div>
  );
}
