"use client";

import { type ChangeEvent, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  Eraser,
  FileSpreadsheet,
  Loader2,
  Save,
  Send,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { computeTotals } from "@/lib/calc";
import { CHALLENGES_LEARNINGS_MAX } from "@/lib/validation";
import { formatDayShort, weekdayShort } from "@/lib/periods";
import type { EntryType } from "@/lib/types";
import {
  parseTimesheetWorkbook,
  type ImportRow,
} from "@/lib/xlsx-timesheet";
import {
  AttachmentsManager,
  type AttachmentItem,
} from "@/components/timesheets/attachments-manager";
import { saveTimesheet, submitTimesheet } from "@/app/(app)/employee/actions";

function isWeekday(date: string): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
}

type DayCell = { regular: string; overtime: string; holiday: string; pto: string };
const EMPTY: DayCell = { regular: "", overtime: "", holiday: "", pto: "" };
const CATS: { key: keyof DayCell; type: EntryType; label: string }[] = [
  { key: "regular", type: "regular", label: "Regular" },
  { key: "overtime", type: "overtime", label: "Overtime" },
  { key: "holiday", type: "holiday", label: "Holiday" },
  { key: "pto", type: "pto", label: "PTO" },
];

export function TimesheetEditor({
  timesheetId,
  periodDays,
  assignment,
  initialEntries,
  initialAttachments,
  reviewNote,
  initialChallengesLearnings,
}: {
  timesheetId: string;
  periodDays: string[];
  assignment: {
    bill_rate: number;
    pay_rate: number;
    overtime_multiplier: number;
    currency: string;
  };
  initialEntries: { work_date: string; hours: number; entry_type: EntryType }[];
  initialAttachments: AttachmentItem[];
  reviewNote?: string | null;
  initialChallengesLearnings?: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [attachments, setAttachments] =
    useState<AttachmentItem[]>(initialAttachments);
  const [challengesLearnings, setChallengesLearnings] = useState(
    initialChallengesLearnings ?? ""
  );

  const [grid, setGrid] = useState<Record<string, DayCell>>(() => {
    const base: Record<string, DayCell> = {};
    for (const d of periodDays) base[d] = { ...EMPTY };
    for (const e of initialEntries) {
      if (!base[e.work_date]) base[e.work_date] = { ...EMPTY };
      const cat = CATS.find((c) => c.type === e.entry_type);
      if (cat) {
        const cur = parseFloat(base[e.work_date][cat.key] || "0");
        base[e.work_date][cat.key] = String(cur + Number(e.hours));
      }
    }
    return base;
  });

  const [fillHours, setFillHours] = useState("8");
  const excelRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);

  function setCell(date: string, key: keyof DayCell, value: string) {
    setGrid((g) => ({ ...g, [date]: { ...g[date], [key]: value } }));
  }

  function fillWeekdays() {
    const h = parseFloat(fillHours);
    if (!(h > 0)) {
      toast({ variant: "destructive", title: "Enter hours per day first." });
      return;
    }
    setGrid((g) => {
      const next = { ...g };
      for (const d of periodDays) {
        if (isWeekday(d)) next[d] = { ...next[d], regular: String(h) };
      }
      return next;
    });
    toast({ title: `Filled weekdays with ${h}h regular` });
  }

  function clearAll() {
    setGrid(() => {
      const base: Record<string, DayCell> = {};
      for (const d of periodDays) base[d] = { ...EMPTY };
      return base;
    });
  }

  async function handleExcelChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (excelRef.current) excelRef.current.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const { rows, matchedDays } = await parseTimesheetWorkbook(
        file,
        periodDays
      );
      if (matchedDays === 0) {
        toast({
          variant: "destructive",
          title: "Couldn't read hours from that file",
          description:
            "No dates in the sheet matched this period. Check the file or enter hours manually.",
        });
        return;
      }
      setImportRows(rows);
    } catch {
      toast({
        variant: "destructive",
        title: "Could not read the spreadsheet",
        description: "Make sure it's a valid .xlsx or .csv file.",
      });
    } finally {
      setImporting(false);
    }
  }

  function applyImport() {
    if (!importRows) return;
    setGrid((g) => {
      const next = { ...g };
      for (const r of importRows) {
        next[r.date] = {
          regular: r.regular ? String(r.regular) : "",
          overtime: r.overtime ? String(r.overtime) : "",
          holiday: r.holiday ? String(r.holiday) : "",
          pto: r.pto ? String(r.pto) : "",
        };
      }
      return next;
    });
    setImportRows(null);
    toast({ title: "Hours imported — review and submit" });
  }

  const flatEntries = useMemo(() => {
    const out: { work_date: string; hours: number; entry_type: EntryType }[] =
      [];
    for (const date of periodDays) {
      const cell = grid[date] || EMPTY;
      for (const cat of CATS) {
        const h = parseFloat(cell[cat.key] || "0");
        if (h > 0) out.push({ work_date: date, hours: h, entry_type: cat.type });
      }
    }
    return out;
  }, [grid, periodDays]);

  const totals = useMemo(
    () =>
      computeTotals(flatEntries, {
        bill_rate: assignment.bill_rate,
        pay_rate: assignment.pay_rate,
        overtime_multiplier: assignment.overtime_multiplier,
      }),
    [flatEntries, assignment]
  );

  const hasApproved = attachments.some(
    (a) => a.attachment_type === "approved_timesheet"
  );
  const hasHours = flatEntries.length > 0;

  function dayTotal(date: string): number {
    const c = grid[date] || EMPTY;
    return CATS.reduce((s, cat) => s + (parseFloat(c[cat.key] || "0") || 0), 0);
  }

  function handleSave() {
    startTransition(async () => {
      const res = await saveTimesheet(
        timesheetId,
        flatEntries,
        challengesLearnings
      );
      if (res.ok) toast({ title: "Draft saved" });
      else toast({ variant: "destructive", title: res.error });
    });
  }

  async function handleSubmit() {
    if (!hasHours) {
      toast({ variant: "destructive", title: "Add at least one day with hours." });
      return;
    }
    if (!challengesLearnings.trim()) {
      toast({
        variant: "destructive",
        title: "Enter your Challenges/Learnings before submitting.",
      });
      return;
    }
    if (!hasApproved) {
      toast({
        variant: "destructive",
        title: "Upload the approved timesheet before submitting.",
      });
      return;
    }
    setSubmitting(true);
    const res = await submitTimesheet(
      timesheetId,
      flatEntries,
      challengesLearnings
    );
    setSubmitting(false);
    if (res.ok) {
      toast({ title: "Timesheet submitted for review" });
      router.refresh();
    } else {
      toast({ variant: "destructive", title: res.error });
    }
  }

  return (
    <div className="grid gap-6">
      {reviewNote && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <p className="font-medium">Reviewer returned this timesheet</p>
          <p className="text-muted-foreground">{reviewNote}</p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Hours</CardTitle>
          <CardDescription>
            Enter hours per day. Overtime is billed/paid at{" "}
            {assignment.overtime_multiplier}×. Holiday/PTO are paid but not
            billed.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-end gap-2 border-b p-3">
            <div className="grid gap-1">
              <label
                htmlFor="fillHours"
                className="text-xs font-medium text-muted-foreground"
              >
                Hours / weekday
              </label>
              <Input
                id="fillHours"
                type="number"
                min={0}
                max={24}
                step={0.25}
                inputMode="decimal"
                value={fillHours}
                onChange={(e) => setFillHours(e.target.value)}
                className="h-9 w-24"
              />
            </div>
            <Button variant="outline" onClick={fillWeekdays}>
              <CalendarPlus className="h-4 w-4" />
              Fill weekdays
            </Button>
            <Button
              variant="outline"
              onClick={() => excelRef.current?.click()}
              disabled={importing}
            >
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              Import from Excel/CSV
            </Button>
            <input
              ref={excelRef}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={handleExcelChange}
            />
            <Button variant="ghost" onClick={clearAll} className="ml-auto">
              <Eraser className="h-4 w-4" />
              Clear
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-3 font-medium">Day</th>
                  {CATS.map((c) => (
                    <th key={c.key} className="p-3 text-center font-medium">
                      {c.label}
                    </th>
                  ))}
                  <th className="p-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {periodDays.map((date) => (
                  <tr key={date} className="border-b last:border-0">
                    <td className="whitespace-nowrap p-3">
                      <span className="font-medium">{weekdayShort(date)}</span>{" "}
                      <span className="text-muted-foreground">
                        {formatDayShort(date)}
                      </span>
                    </td>
                    {CATS.map((c) => (
                      <td key={c.key} className="p-2">
                        <Input
                          type="number"
                          min={0}
                          max={24}
                          step={0.25}
                          inputMode="decimal"
                          value={grid[date]?.[c.key] ?? ""}
                          onChange={(e) =>
                            setCell(date, c.key, e.target.value)
                          }
                          className="mx-auto h-9 w-20 text-center"
                          aria-label={`${c.label} hours for ${date}`}
                        />
                      </td>
                    ))}
                    <td className="p-3 text-right font-medium">
                      {dayTotal(date) || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Totals</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row label="Regular hours" value={`${totals.totalRegularHours}h`} />
            <Row label="Overtime hours" value={`${totals.totalOtHours}h`} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Approved timesheet</CardTitle>
            <CardDescription>
              Upload the client-approved timesheet (required to submit).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AttachmentsManager
              timesheetId={timesheetId}
              attachments={attachments}
              editable
              onAdd={(a) => setAttachments((prev) => [...prev, a])}
              onRemove={(id) =>
                setAttachments((prev) => prev.filter((x) => x.id !== id))
              }
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <label htmlFor="challengesLearnings">Challenges/Learnings</label>
          </CardTitle>
          <CardDescription>
            Share any challenges you faced or things you learned this period
            (required to submit).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1">
          <Textarea
            id="challengesLearnings"
            value={challengesLearnings}
            onChange={(e) => setChallengesLearnings(e.target.value)}
            maxLength={CHALLENGES_LEARNINGS_MAX}
            rows={4}
            aria-required
          />
          <p className="text-right text-xs text-muted-foreground">
            {challengesLearnings.length}/{CHALLENGES_LEARNINGS_MAX}
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          onClick={handleSave}
          disabled={pending || submitting}
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save draft
        </Button>
        <Button onClick={handleSubmit} disabled={submitting || pending}>
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Submit for review
        </Button>
      </div>

      <Dialog
        open={importRows !== null}
        onOpenChange={(open) => !open && setImportRows(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review imported hours</DialogTitle>
            <DialogDescription>
              We matched {importRows?.length ?? 0} day
              {(importRows?.length ?? 0) === 1 ? "" : "s"} from your file.
              Applying this replaces the hours for those days — you can still
              edit before submitting.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-2 font-medium">Day</th>
                  <th className="p-2 text-right font-medium">Reg</th>
                  <th className="p-2 text-right font-medium">OT</th>
                  <th className="p-2 text-right font-medium">Hol</th>
                  <th className="p-2 text-right font-medium">PTO</th>
                </tr>
              </thead>
              <tbody>
                {importRows?.map((r) => (
                  <tr key={r.date} className="border-b last:border-0">
                    <td className="whitespace-nowrap p-2">
                      <span className="font-medium">{weekdayShort(r.date)}</span>{" "}
                      <span className="text-muted-foreground">
                        {formatDayShort(r.date)}
                      </span>
                    </td>
                    <td className="p-2 text-right">{r.regular || ""}</td>
                    <td className="p-2 text-right">{r.overtime || ""}</td>
                    <td className="p-2 text-right">{r.holiday || ""}</td>
                    <td className="p-2 text-right">{r.pto || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportRows(null)}>
              Cancel
            </Button>
            <Button onClick={applyImport}>Apply to timesheet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
