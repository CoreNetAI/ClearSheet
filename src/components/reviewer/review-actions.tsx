"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { formatMoney } from "@/lib/format";
import { formatDayShort, weekdayShort } from "@/lib/periods";
import type { EntryType } from "@/lib/types";
import {
  approveTimesheet,
  editAndApprove,
  rejectTimesheet,
} from "@/app/(app)/reviewer/actions";

type DayCell = { regular: string; overtime: string; holiday: string; pto: string };
const EMPTY: DayCell = { regular: "", overtime: "", holiday: "", pto: "" };
const CATS: { key: keyof DayCell; type: EntryType; label: string }[] = [
  { key: "regular", type: "regular", label: "Reg" },
  { key: "overtime", type: "overtime", label: "OT" },
  { key: "holiday", type: "holiday", label: "Hol" },
  { key: "pto", type: "pto", label: "PTO" },
];

export function ReviewActions({
  timesheetId,
  periodDays,
  assignment,
  initialEntries,
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
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<null | "approve" | "reject" | "edit">(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [note, setNote] = useState("");
  const [editNote, setEditNote] = useState("");

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

  async function doApprove() {
    setBusy("approve");
    const res = await approveTimesheet(timesheetId);
    setBusy(null);
    if (res.ok) {
      toast({ title: "Approved" });
      router.push("/reviewer");
    } else {
      toast({ variant: "destructive", title: res.error });
    }
  }

  async function doReject() {
    setBusy("reject");
    const res = await rejectTimesheet(timesheetId, note);
    setBusy(null);
    if (res.ok) {
      toast({ title: "Returned to employee" });
      setRejectOpen(false);
      router.push("/reviewer");
    } else {
      toast({ variant: "destructive", title: res.error });
    }
  }

  async function doEditApprove() {
    setBusy("edit");
    const res = await editAndApprove(timesheetId, editNote, flatEntries);
    setBusy(null);
    if (res.ok) {
      toast({ title: "Edited and approved" });
      setEditOpen(false);
      router.push("/reviewer");
    } else {
      toast({ variant: "destructive", title: res.error });
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button onClick={doApprove} disabled={busy !== null} variant="success">
        {busy === "approve" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Check className="h-4 w-4" />
        )}
        Approve
      </Button>

      <Button
        onClick={() => setEditOpen(true)}
        disabled={busy !== null}
        variant="outline"
      >
        <Pencil className="h-4 w-4" />
        Edit &amp; approve
      </Button>

      <Button
        onClick={() => setRejectOpen(true)}
        disabled={busy !== null}
        variant="destructive"
      >
        <X className="h-4 w-4" />
        Reject
      </Button>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return timesheet</DialogTitle>
            <DialogDescription>
              The employee will see this note and can edit and resubmit.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reject-note">Reason</Label>
            <Textarea
              id="reject-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Thursday hours look high — please confirm with client."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={doReject}
              disabled={busy === "reject" || note.trim().length === 0}
            >
              {busy === "reject" && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Return to employee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit & approve dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit hours &amp; approve</DialogTitle>
            <DialogDescription>
              Adjust hours, add a required note explaining the change, then
              approve.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-2 font-medium">Day</th>
                  {CATS.map((c) => (
                    <th key={c.key} className="p-2 text-right font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periodDays.map((date) => (
                  <tr key={date} className="border-b last:border-0">
                    <td className="whitespace-nowrap p-2">
                      <span className="font-medium">{weekdayShort(date)}</span>{" "}
                      <span className="text-muted-foreground">
                        {formatDayShort(date)}
                      </span>
                    </td>
                    {CATS.map((c) => (
                      <td key={c.key} className="p-1">
                        <Input
                          type="number"
                          min={0}
                          max={24}
                          step={0.25}
                          value={grid[date]?.[c.key] ?? ""}
                          onChange={(e) =>
                            setGrid((g) => ({
                              ...g,
                              [date]: { ...g[date], [c.key]: e.target.value },
                            }))
                          }
                          className="h-8 w-16 text-right"
                          aria-label={`${c.label} ${date}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-sm text-muted-foreground">
            New totals: {totals.totalRegularHours}h regular, {totals.totalOtHours}h
            OT · bill {formatMoney(totals.billAmount, assignment.currency)}
          </p>

          <div className="grid gap-2">
            <Label htmlFor="edit-note">Note (required)</Label>
            <Textarea
              id="edit-note"
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="e.g. Corrected Friday from 10h to 8h per client approval."
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="success"
              onClick={doEditApprove}
              disabled={busy === "edit" || editNote.trim().length === 0}
            >
              {busy === "edit" && <Loader2 className="h-4 w-4 animate-spin" />}
              Save &amp; approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
