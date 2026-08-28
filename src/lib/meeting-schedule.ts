// Settings and slot math for the bi-weekly 1:1 meetings. Pure functions (no
// database, no network) so the schedule can be checked in isolation.
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export interface MeetingSettings {
  /** Conductor emails, lowercased. The first is the Zoom host. */
  conductors: string[];
  timezone: string;
  /** First day of the first cycle (yyyy-MM-dd), or null when not set. */
  firstCycleStart: string | null;
  cycleDays: number;
  dayStart: string; // HH:mm
  dayEnd: string; // HH:mm
  durationMinutes: number;
  gapMinutes: number;
  includeWeekends: boolean;
  skipDates: string[];
  /** Generate a cycle this many days before it starts. */
  generateDaysAhead: number;
  /** Email each meeting this many hours before it starts. */
  noticeHours: number;
}

export interface MeetingSettingsResult {
  settings: MeetingSettings;
  /** Problems that stop the scheduler from running. */
  errors: string[];
}

type Env = Record<string, string | undefined>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function intSetting(
  env: Env,
  name: string,
  fallback: number,
  min: number,
  max: number,
  errors: string[]
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    errors.push(`${name} must be a whole number from ${min} to ${max}.`);
    return fallback;
  }
  return n;
}

/** Reads the MEETING_* settings. Missing values fall back to the defaults. */
export function readMeetingSettings(env: Env = process.env): MeetingSettingsResult {
  const errors: string[] = [];

  const conductorEntries = (env.MEETING_CONDUCTORS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const badConductors = conductorEntries.filter((e) => !EMAIL_RE.test(e));
  if (badConductors.length) {
    errors.push(`MEETING_CONDUCTORS has invalid entries: ${badConductors.join(", ")}`);
  }
  const conductors = Array.from(
    new Set(conductorEntries.filter((e) => EMAIL_RE.test(e)))
  );
  if (conductors.length === 0) errors.push("MEETING_CONDUCTORS is not set.");

  const timezone = env.DEFAULT_TIMEZONE?.trim() || "America/New_York";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    errors.push(`DEFAULT_TIMEZONE "${timezone}" is not a valid timezone.`);
  }

  const firstRaw = env.MEETING_FIRST_CYCLE_START?.trim() || "";
  let firstCycleStart: string | null = null;
  if (!firstRaw) {
    errors.push("MEETING_FIRST_CYCLE_START is not set.");
  } else if (!isValidDate(firstRaw)) {
    errors.push("MEETING_FIRST_CYCLE_START must be a date like 2026-11-16.");
  } else {
    firstCycleStart = firstRaw;
  }

  let dayStart = env.MEETING_DAY_START?.trim() || "10:00";
  let dayEnd = env.MEETING_DAY_END?.trim() || "16:00";
  if (!TIME_RE.test(dayStart)) {
    errors.push("MEETING_DAY_START must be a 24-hour time like 10:00.");
    dayStart = "10:00";
  }
  if (!TIME_RE.test(dayEnd)) {
    errors.push("MEETING_DAY_END must be a 24-hour time like 16:00.");
    dayEnd = "16:00";
  }

  const durationMinutes = intSetting(env, "MEETING_DURATION_MINUTES", 15, 5, 240, errors);
  const gapMinutes = intSetting(env, "MEETING_GAP_MINUTES", 15, 0, 240, errors);
  if (toMinutes(dayEnd) - toMinutes(dayStart) < durationMinutes) {
    errors.push("MEETING_DAY_END must be at least one meeting after MEETING_DAY_START.");
  }

  const skipEntries = (env.MEETING_SKIP_DATES ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const badSkip = skipEntries.filter((d) => !isValidDate(d));
  if (badSkip.length) {
    errors.push(`MEETING_SKIP_DATES has invalid dates: ${badSkip.join(", ")}`);
  }

  const noticeHours = intSetting(env, "MEETING_NOTICE_HOURS", 24, 1, 168, errors);
  // A cycle must exist before its first meeting's email is due.
  const minAhead = Math.ceil(noticeHours / 24) + 1;
  const generateDaysAhead = intSetting(
    env,
    "MEETING_GENERATE_DAYS_AHEAD",
    Math.max(3, minAhead),
    minAhead,
    30,
    errors
  );

  return {
    settings: {
      conductors,
      timezone,
      firstCycleStart,
      cycleDays: intSetting(env, "MEETING_CYCLE_DAYS", 14, 1, 60, errors),
      dayStart,
      dayEnd,
      durationMinutes,
      gapMinutes,
      includeWeekends: /^(1|true|yes|on)$/i.test(env.MEETING_INCLUDE_WEEKENDS?.trim() ?? ""),
      skipDates: skipEntries.filter(isValidDate),
      generateDaysAhead,
      noticeHours,
    },
    errors,
  };
}

// ---------------------------------------------------------------------------
// Date helpers on yyyy-MM-dd strings (calendar days, timezone-free)
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY
  );
}

export function dateInTz(instant: Date, tz: string): string {
  return formatInTimeZone(instant, tz, "yyyy-MM-dd");
}

/** The UTC instant of a wall-clock time in the firm's timezone. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  return fromZonedTime(`${date}T${time}:00`, tz);
}

// ---------------------------------------------------------------------------
// Cycles and slots
// ---------------------------------------------------------------------------

export interface CycleWindow {
  index: number;
  startsOn: string;
  endsOn: string;
}

export function cycleWindow(s: MeetingSettings, index: number): CycleWindow {
  const startsOn = addDays(s.firstCycleStart!, index * s.cycleDays);
  return { index, startsOn, endsOn: addDays(startsOn, s.cycleDays - 1) };
}

/**
 * Cycles that should exist by `now`: the one running today (if it still has
 * days left) and the next one once it is within `generateDaysAhead` days.
 */
export function cyclesDue(s: MeetingSettings, now: Date): CycleWindow[] {
  if (!s.firstCycleStart) return [];
  const today = dateInTz(now, s.timezone);
  const sinceFirst = daysBetween(s.firstCycleStart, today);
  const current = sinceFirst < 0 ? 0 : Math.floor(sinceFirst / s.cycleDays);
  const candidates = sinceFirst < 0 ? [0] : [current, current + 1];
  return candidates
    .map((i) => cycleWindow(s, i))
    .filter(
      (c) =>
        today <= c.endsOn && daysBetween(today, c.startsOn) <= s.generateDaysAhead
    );
}

export function isWorkingDay(s: MeetingSettings, date: string): boolean {
  if (s.skipDates.includes(date)) return false;
  if (s.includeWeekends) return true;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
}

/** Every meeting start time in a cycle, earliest first. */
export function cycleSlots(s: MeetingSettings, cycle: CycleWindow): Date[] {
  const slots: Date[] = [];
  const startMin = toMinutes(s.dayStart);
  const endMin = toMinutes(s.dayEnd);
  for (let date = cycle.startsOn; date <= cycle.endsOn; date = addDays(date, 1)) {
    if (!isWorkingDay(s, date)) continue;
    for (
      let t = startMin;
      t + s.durationMinutes <= endMin;
      t += s.durationMinutes + s.gapMinutes
    ) {
      slots.push(zonedToUtc(date, fromMinutes(t), s.timezone));
    }
  }
  return slots;
}

export function slotsPerDay(s: MeetingSettings): number {
  const span = toMinutes(s.dayEnd) - toMinutes(s.dayStart);
  if (span < s.durationMinutes) return 0;
  return Math.floor((span - s.durationMinutes) / (s.durationMinutes + s.gapMinutes)) + 1;
}

/** Fisher–Yates shuffle with an injectable random source (for tests). */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** True when [aStart, aStart+aMin) overlaps [bStart, bStart+bMin). */
export function overlaps(aStart: Date, aMin: number, bStart: Date, bMin: number): boolean {
  const a0 = aStart.getTime();
  const b0 = bStart.getTime();
  return a0 < b0 + bMin * 60_000 && b0 < a0 + aMin * 60_000;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function formatMeetingDate(instant: Date | string, tz: string): string {
  return formatInTimeZone(new Date(instant), tz, "EEEE, MMM d, yyyy");
}

export function formatMeetingTime(instant: Date | string, tz: string): string {
  return formatInTimeZone(new Date(instant), tz, "h:mm a zzz");
}
