"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, FileText, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Tip } from "@/components/ui/tooltip";
import { formatMoney } from "@/lib/format";
import { formatDate } from "@/lib/format";
import { generateInvoice } from "@/app/(app)/finance/actions";

export interface ApprovedItem {
  // Stable per (cycle, employee, assignment) — selection key, not a timesheet id.
  key: string;
  employeeName: string;
  assignmentTitle: string;
  regularHours: number;
  otHours: number;
  billAmount: number;
  // The constituent timesheet ids this item invoices (one or more).
  timesheetIds: string[];
  // False when the billing cycle still has unapproved constituent periods.
  ready: boolean;
  missingPeriods?: number;
}

export interface ApprovedGroup {
  clientId: string;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  items: ApprovedItem[];
}

function GroupCard({ group }: { group: ApprovedGroup }) {
  const router = useRouter();
  const { toast } = useToast();
  // Only ready items are selectable; default-select them all.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(group.items.filter((i) => i.ready).map((i) => i.key))
  );
  const [busy, setBusy] = useState(false);

  const selectedTotal = useMemo(
    () =>
      group.items
        .filter((i) => selected.has(i.key))
        .reduce((s, i) => s + i.billAmount, 0),
    [group.items, selected]
  );

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleGenerate() {
    const timesheetIds = group.items
      .filter((i) => i.ready && selected.has(i.key))
      .flatMap((i) => i.timesheetIds);
    if (timesheetIds.length === 0) {
      toast({ variant: "destructive", title: "Select at least one line." });
      return;
    }
    setBusy(true);
    const res = await generateInvoice({
      clientId: group.clientId,
      periodStart: group.periodStart,
      periodEnd: group.periodEnd,
      timesheetIds,
    });
    setBusy(false);
    if (res.ok && res.data) {
      toast({ title: "Invoice created" });
      router.push(`/finance/invoices/${res.data.invoiceId}`);
    } else if (!res.ok) {
      toast({ variant: "destructive", title: res.error });
    }
  }

  const hasReady = group.items.some((i) => i.ready);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>{group.clientName}</CardTitle>
            <CardDescription>
              {formatDate(group.periodStart)} – {formatDate(group.periodEnd)}
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-sm text-muted-foreground">Selected</div>
            <div className="text-lg font-bold">
              {formatMoney(selectedTotal)}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-1">
          {group.items.map((i) => (
            <li
              key={i.key}
              className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
                i.ready ? "" : "opacity-60"
              }`}
            >
              <Checkbox
                checked={selected.has(i.key)}
                disabled={!i.ready}
                onCheckedChange={() => toggle(i.key)}
                aria-label={`Include ${i.employeeName}`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{i.employeeName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {i.assignmentTitle} · {i.regularHours}h
                  {i.otHours > 0 ? ` + ${i.otHours}h OT` : ""}
                </p>
                {!i.ready && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-600">
                    <Clock className="h-3 w-3" />
                    Waiting on {i.missingPeriods ?? 1} more period
                    {(i.missingPeriods ?? 1) === 1 ? "" : "s"} in this cycle to
                    be approved
                  </p>
                )}
              </div>
              <div className="text-sm font-medium">
                {formatMoney(i.billAmount)}
              </div>
            </li>
          ))}
        </ul>
        <Tip content="Create one invoice for the ticked employees covering this client's full billing cycle. Greyed (waiting) lines can't be included yet.">
          <Button
            onClick={handleGenerate}
            disabled={busy || !hasReady}
            className="w-full"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            Generate invoice
          </Button>
        </Tip>
      </CardContent>
    </Card>
  );
}

export function ApprovedList({ groups }: { groups: ApprovedGroup[] }) {
  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          No approved timesheets waiting to be invoiced.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map((g) => (
        <GroupCard key={`${g.clientId}-${g.periodStart}-${g.periodEnd}`} group={g} />
      ))}
    </div>
  );
}
