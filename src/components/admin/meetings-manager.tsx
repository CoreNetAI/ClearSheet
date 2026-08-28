"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, Loader2, Send, UserPlus, Video, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import {
  addToCycleAction,
  cancelMeetingAction,
  rescheduleMeetingAction,
  sendMeetingNowAction,
  type MeetingActionData,
} from "@/app/(app)/admin/meetings/actions";
import type { ActionResult } from "@/lib/actions";

export interface MeetingItem {
  id: string;
  startsAt: string;
  durationMinutes: number;
  status: "scheduled" | "canceled";
  cancelReason: string | null;
  employeeName: string;
  employeeEmail: string | null;
  zoomJoinUrl: string | null;
  inviteSentAt: string | null;
  inviteDueAt: string;
  lastError: string | null;
}

export interface CycleOption {
  id: string;
  startsOn: string;
  endsOn: string;
  slotCount: number;
  eligibleCount: number;
}

export interface MissingEmployee {
  id: string;
  name: string;
  email: string | null;
  /** Left out because there were more employees than slots. */
  overflow: boolean;
}

export interface SlotOption {
  iso: string;
  date: string; // yyyy-MM-dd in the firm's timezone
  time: string; // HH:mm in the firm's timezone
}

interface Summary {
  conductors: string[];
  hours: string;
  durationMinutes: number;
  gapMinutes: number;
  includeWeekends: boolean;
  cycleDays: number;
  noticeHours: number;
  slotsPerDay: number;
  skipDates: string[];
}

function formatter(tz: string, opts: Intl.DateTimeFormatOptions) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts });
  return (iso: string) => f.format(new Date(iso));
}

function formatDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const CUSTOM = "custom";
const MISSING_PREVIEW = 5;

export function MeetingsManager(props: {
  timezone: string;
  settingsErrors: string[];
  deliveryProblems: string[];
  summary: Summary;
  nextCycle: { startsOn: string; generatesOn: string; dueNow: boolean } | null;
  cycles: CycleOption[];
  selectedCycleId: string | null;
  meetings: MeetingItem[];
  missing: MissingEmployee[];
  freeSlots: SlotOption[];
  cycleOpen: boolean;
  /** Server time, so server and browser render the same labels. */
  nowIso: string;
}) {
  const { timezone: tz, summary, meetings } = props;
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [moving, setMoving] = useState<MeetingItem | null>(null);
  const [canceling, setCanceling] = useState<MeetingItem | null>(null);
  const [slotChoice, setSlotChoice] = useState<string>("");
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("");
  const [showAllMissing, setShowAllMissing] = useState(false);

  const time = useMemo(() => formatter(tz, { hour: "numeric", minute: "2-digit" }), [tz]);
  const dayKey = useMemo(
    () => formatter(tz, { year: "numeric", month: "2-digit", day: "2-digit" }),
    [tz]
  );
  const dateTime = useMemo(
    () =>
      formatter(tz, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    [tz]
  );
  const slotLabel = useMemo(
    () =>
      formatter(tz, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    [tz]
  );
  const tzName = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? tz,
    [tz]
  );

  const nowMs = Date.parse(props.nowIso);
  const scheduled = meetings.filter((m) => m.status === "scheduled");
  const counts = {
    scheduled: scheduled.length,
    sent: scheduled.filter((m) => m.inviteSentAt).length,
    canceled: meetings.length - scheduled.length,
    failed: scheduled.filter((m) => m.lastError && !m.inviteSentAt).length,
  };

  // Group by day in the firm's timezone, keeping start-time order.
  const byDay = useMemo(() => {
    const groups = new Map<string, MeetingItem[]>();
    for (const m of meetings) {
      const key = dayKey(m.startsAt);
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    return Array.from(groups.entries());
  }, [meetings, dayKey]);

  async function run(
    key: string,
    action: () => Promise<ActionResult<MeetingActionData>>,
    onDone?: () => void
  ) {
    setBusy(key);
    const res = await action();
    setBusy(null);
    if (!res.ok) {
      toast({ variant: "destructive", title: res.error });
      return;
    }
    onDone?.();
    if (res.data?.warning) {
      toast({ variant: "destructive", title: res.data.message, description: res.data.warning });
    } else {
      toast({ title: res.data?.message ?? "Done" });
    }
    router.refresh();
  }

  function openMove(m: MeetingItem) {
    setMoving(m);
    setSlotChoice(props.freeSlots.length ? "" : CUSTOM);
    setCustomDate("");
    setCustomTime("");
  }

  function submitMove() {
    if (!moving) return;
    let date = customDate;
    let at = customTime;
    if (slotChoice !== CUSTOM) {
      const slot = props.freeSlots.find((s) => s.iso === slotChoice);
      if (!slot) return;
      date = slot.date;
      at = slot.time;
    }
    const id = moving.id;
    run(`move-${id}`, () => rescheduleMeetingAction(id, date, at), () => setMoving(null));
  }

  const selectedCycle = props.cycles.find((c) => c.id === props.selectedCycleId) ?? null;
  const canMove =
    slotChoice === CUSTOM ? Boolean(customDate && customTime) : Boolean(slotChoice);

  return (
    // min-w-0 lets the wide table scroll inside its card instead of the page.
    <div className="grid min-w-0 gap-6 [&>*]:min-w-0">
      {/* Setup */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Setup</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {props.settingsErrors.length > 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="mb-1 flex items-center gap-2 font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" /> Meetings are paused until these settings are fixed
              </p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {props.settingsErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : (
            props.deliveryProblems.length > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
                <p className="mb-1 flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" /> Invites can&apos;t be sent yet
                </p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {props.deliveryProblems.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )
          )}
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Conductors (in every meeting)</dt>
              <dd>
                {summary.conductors.length
                  ? summary.conductors.map((c, i) => (
                      <span key={c} className="block break-all">
                        {c}
                        {i === 0 && <span className="text-muted-foreground"> · Zoom host</span>}
                      </span>
                    ))
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Meeting hours</dt>
              <dd>
                {summary.hours} {tzName}, {summary.includeWeekends ? "every day" : "weekdays"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Slots</dt>
              <dd>
                {summary.durationMinutes} min meetings, {summary.gapMinutes} min gap ·{" "}
                {summary.slotsPerDay} per day
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Cycle</dt>
              <dd>Every {summary.cycleDays} days, employees reshuffled</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd>One email {summary.noticeHours} hours before each meeting</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Next cycle</dt>
              <dd>
                {props.nextCycle
                  ? `Starts ${formatDay(props.nextCycle.startsOn)} · ${
                      props.nextCycle.dueNow
                        ? "being generated now"
                        : `generated ${formatDay(props.nextCycle.generatesOn)}`
                    }`
                  : "—"}
              </dd>
            </div>
            {summary.skipDates.length > 0 && (
              <div>
                <dt className="text-muted-foreground">Skipped dates</dt>
                <dd>{summary.skipDates.map(formatDay).join(", ")}</dd>
              </div>
            )}
          </dl>
          <p className="text-xs text-muted-foreground">
            Change these with the MEETING_* settings on the server. Changes apply from the next
            cycle.
          </p>
        </CardContent>
      </Card>

      {props.cycles.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No cycles yet. The first one is generated automatically
            {props.nextCycle ? ` on ${formatDay(props.nextCycle.generatesOn)}` : ""}.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Cycle picker + counts */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Select
              value={props.selectedCycleId ?? undefined}
              onValueChange={(id) => router.push(`/admin/meetings?cycle=${id}`)}
            >
              <SelectTrigger className="w-full sm:w-80" aria-label="Cycle">
                <SelectValue placeholder="Choose a cycle" />
              </SelectTrigger>
              <SelectContent>
                {props.cycles.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {formatDay(c.startsOn)} – {formatDay(c.endsOn)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{counts.scheduled} scheduled</Badge>
              <Badge variant="success">{counts.sent} invites sent</Badge>
              {counts.failed > 0 && <Badge variant="destructive">{counts.failed} failing</Badge>}
              {counts.canceled > 0 && <Badge variant="outline">{counts.canceled} canceled</Badge>}
              {selectedCycle && (
                <Badge variant="outline">{selectedCycle.slotCount} slots</Badge>
              )}
            </div>
          </div>

          {/* Employees without a meeting */}
          {props.missing.length > 0 && (
            <Card className="border-warning/50">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4" />
                  {props.missing.length} active employee{props.missing.length === 1 ? "" : "s"} without
                  a meeting in this cycle
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <p className="text-muted-foreground">
                  They joined after the cycle was generated, their meeting was canceled, or there
                  were more employees than slots. They&apos;ll be included in the next cycle.
                </p>
                <ul className="divide-y">
                  {(showAllMissing ? props.missing : props.missing.slice(0, MISSING_PREVIEW)).map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
                    >
                      <span className="min-w-0 break-words">
                        <span className="font-medium">{e.name}</span>{" "}
                        <span className="text-muted-foreground">{e.email}</span>
                        {e.overflow && (
                          <Badge variant="outline" className="ml-2">
                            no slot left
                          </Badge>
                        )}
                      </span>
                      {props.cycleOpen && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null || props.freeSlots.length === 0}
                          onClick={() =>
                            run(`add-${e.id}`, () => addToCycleAction(props.selectedCycleId!, e.id))
                          }
                        >
                          {busy === `add-${e.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <UserPlus className="h-4 w-4" />
                          )}
                          Add to next free slot
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {props.missing.length > MISSING_PREVIEW && (
                  <Button
                    variant="link"
                    size="sm"
                    className="justify-self-start px-0"
                    onClick={() => setShowAllMissing((v) => !v)}
                  >
                    {showAllMissing ? "Show fewer" : `Show all ${props.missing.length}`}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Meetings */}
          <Card>
            <CardContent className="p-0">
              {meetings.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No meetings in this cycle.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-28">Time ({tzName})</TableHead>
                        <TableHead>Employee</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Zoom</TableHead>
                        <TableHead className="text-right" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byDay.map(([key, items]) => (
                        <DayRows
                          key={key}
                          items={items}
                          nowMs={nowMs}
                          time={time}
                          dateTime={dateTime}
                          dayLabel={formatter(tz, {
                            weekday: "long",
                            month: "short",
                            day: "numeric",
                          })(items[0].startsAt)}
                          busy={busy}
                          onMove={openMove}
                          onCancel={setCanceling}
                          onSend={(m) => run(`send-${m.id}`, () => sendMeetingNowAction(m.id))}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Reschedule */}
      <Dialog open={moving !== null} onOpenChange={(o) => !o && setMoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule meeting</DialogTitle>
            <DialogDescription>
              {moving && (
                <>
                  {moving.employeeName}, now {slotLabel(moving.startsAt)} {tzName}.{" "}
                  {moving.inviteSentAt
                    ? "Their invite already went out, so they and the conductors are emailed the new time right away."
                    : `Their invite goes out ${summary.noticeHours} hours before the new time (right away if that's sooner).`}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>New time</Label>
              <Select value={slotChoice} onValueChange={setSlotChoice}>
                <SelectTrigger aria-label="New time">
                  <SelectValue placeholder="Choose a free slot" />
                </SelectTrigger>
                <SelectContent>
                  {props.freeSlots.map((s) => (
                    <SelectItem key={s.iso} value={s.iso}>
                      {slotLabel(s.iso)}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM}>Another date and time…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {slotChoice === CUSTOM && (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="move-date">Date</Label>
                  <Input
                    id="move-date"
                    type="date"
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="move-time">Time ({tzName})</Label>
                  <Input
                    id="move-time"
                    type="time"
                    step={300}
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(null)}>
              Close
            </Button>
            <Button onClick={submitMove} disabled={!canMove || busy !== null}>
              {busy?.startsWith("move-") && <Loader2 className="h-4 w-4 animate-spin" />}
              Reschedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel */}
      <Dialog open={canceling !== null} onOpenChange={(o) => !o && setCanceling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel meeting?</DialogTitle>
            <DialogDescription>
              {canceling && (
                <>
                  {canceling.employeeName}, {slotLabel(canceling.startsAt)} {tzName}. The Zoom
                  meeting is deleted.{" "}
                  {canceling.inviteSentAt
                    ? "Their invite already went out, so they and the conductors get a cancellation email."
                    : "Their invite hasn't gone out, so no email is sent."}{" "}
                  This can&apos;t be undone, but you can add them back to a free slot.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCanceling(null)}>
              Keep meeting
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() => {
                const id = canceling!.id;
                run(`cancel-${id}`, () => cancelMeetingAction(id), () => setCanceling(null));
              }}
            >
              {busy?.startsWith("cancel-") && <Loader2 className="h-4 w-4 animate-spin" />}
              Cancel meeting
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DayRows({
  items,
  dayLabel,
  nowMs,
  time,
  dateTime,
  busy,
  onMove,
  onCancel,
  onSend,
}: {
  items: MeetingItem[];
  dayLabel: string;
  nowMs: number;
  time: (iso: string) => string;
  dateTime: (iso: string) => string;
  busy: string | null;
  onMove: (m: MeetingItem) => void;
  onCancel: (m: MeetingItem) => void;
  onSend: (m: MeetingItem) => void;
}) {
  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell colSpan={6} className="py-2 text-xs font-semibold uppercase tracking-wide">
          {dayLabel}
        </TableCell>
      </TableRow>
      {items.map((m) => {
        const start = Date.parse(m.startsAt);
        const ended = start + m.durationMinutes * 60_000 < nowMs;
        const upcoming = m.status === "scheduled" && start > nowMs;
        const canceled = m.status === "canceled";
        return (
          <TableRow key={m.id} className={canceled ? "text-muted-foreground" : undefined}>
            <TableCell className={canceled ? "line-through" : "font-medium"}>
              {time(m.startsAt)}
            </TableCell>
            <TableCell>
              <div className="font-medium">{m.employeeName}</div>
              <div className="text-xs text-muted-foreground">{m.employeeEmail}</div>
            </TableCell>
            <TableCell>
              {canceled ? (
                <Badge variant="outline" title={m.cancelReason ?? undefined}>
                  Canceled
                </Badge>
              ) : ended ? (
                <Badge variant="outline">{m.inviteSentAt ? "Done" : "Missed"}</Badge>
              ) : m.inviteSentAt ? (
                <Badge variant="success">Invite sent</Badge>
              ) : m.lastError ? (
                <Badge variant="destructive">Failing</Badge>
              ) : (
                <Badge variant="secondary">Scheduled</Badge>
              )}
              {canceled && m.cancelReason && (
                <div className="mt-1 text-xs">{m.cancelReason}</div>
              )}
              {!canceled && m.lastError && (
                <div className="mt-1 max-w-xs text-xs text-destructive">{m.lastError}</div>
              )}
            </TableCell>
            <TableCell className="whitespace-nowrap text-sm">
              {m.inviteSentAt
                ? `Sent ${dateTime(m.inviteSentAt)}`
                : canceled
                  ? "—"
                  : `Goes out ${dateTime(m.inviteDueAt)}`}
            </TableCell>
            <TableCell>
              {m.zoomJoinUrl && !canceled ? (
                <a
                  href={m.zoomJoinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                >
                  <Video className="h-4 w-4" /> Join
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {canceled ? "—" : "Created with the invite"}
                </span>
              )}
            </TableCell>
            <TableCell className="whitespace-nowrap text-right">
              {upcoming && (
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => onMove(m)}
                  >
                    <CalendarClock className="h-4 w-4" /> Reschedule
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => onSend(m)}
                  >
                    {busy === `send-${m.id}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {m.inviteSentAt ? "Resend" : "Send now"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={busy !== null}
                    onClick={() => onCancel(m)}
                  >
                    <X className="h-4 w-4" /> Cancel
                  </Button>
                </div>
              )}
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
}
