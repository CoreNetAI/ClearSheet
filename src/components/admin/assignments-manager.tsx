"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { InfoTip, Tip } from "@/components/ui/tooltip";
import { formatMoney, formatDate } from "@/lib/format";
import {
  BILLING_PERIODS,
  type Assignment,
  type AssignmentRate,
  type BillingPeriod,
  type EmploymentType,
} from "@/lib/types";
import {
  changeAssignmentRate,
  upsertAssignment,
} from "@/app/(app)/admin/actions";

type AssignmentRow = Assignment & {
  employee: { full_name: string | null } | null;
  client: { name: string } | null;
  rates: AssignmentRate[];
};

export function AssignmentsManager({
  assignments,
  employees,
  clients,
}: {
  assignments: AssignmentRow[];
  employees: { id: string; full_name: string | null }[];
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AssignmentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "ended">(
    "all"
  );

  const visibleAssignments = assignments.filter((a) => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [a.employee?.full_name, a.client?.name, a.title, a.vendor]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const [employeeId, setEmployeeId] = useState("");
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [billRate, setBillRate] = useState("0");
  const [payRate, setPayRate] = useState("0");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("W2");
  const [otMult, setOtMult] = useState("1.5");
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("weekly");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<"active" | "ended">("active");

  // Change-rate dialog (mid-project rate change → adds a rate-history row).
  const [rateTarget, setRateTarget] = useState<AssignmentRow | null>(null);
  const [rateBusy, setRateBusy] = useState(false);
  const [newBill, setNewBill] = useState("0");
  const [newPay, setNewPay] = useState("0");
  const [newOt, setNewOt] = useState("1.5");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  function openChangeRate(a: AssignmentRow) {
    setRateTarget(a);
    setNewBill(String(a.bill_rate));
    setNewPay(String(a.pay_rate));
    setNewOt(String(a.overtime_multiplier));
    setEffectiveFrom("");
  }

  async function submitRate() {
    if (!rateTarget) return;
    setRateBusy(true);
    const res = await changeAssignmentRate({
      assignmentId: rateTarget.id,
      bill_rate: Number(newBill),
      pay_rate: Number(newPay),
      overtime_multiplier: Number(newOt),
      effective_from: effectiveFrom,
    });
    setRateBusy(false);
    if (res.ok) {
      toast({ title: "Rate updated" });
      setRateTarget(null);
      router.refresh();
    } else {
      toast({ variant: "destructive", title: res.error });
    }
  }

  function openNew() {
    setEditing(null);
    setEmployeeId(employees[0]?.id ?? "");
    setClientId(clients[0]?.id ?? "");
    setTitle("");
    setBillRate("0");
    setPayRate("0");
    setEmploymentType("W2");
    setOtMult("1.5");
    setBillingPeriod("weekly");
    setVendor("");
    setNotes("");
    setStartDate("");
    setEndDate("");
    setStatus("active");
    setOpen(true);
  }

  function openEdit(a: AssignmentRow) {
    setEditing(a);
    setEmployeeId(a.employee_id);
    setClientId(a.client_id);
    setTitle(a.title ?? "");
    setBillRate(String(a.bill_rate));
    setPayRate(String(a.pay_rate));
    setEmploymentType((a.employment_type ?? "W2") as EmploymentType);
    setOtMult(String(a.overtime_multiplier));
    setBillingPeriod((a.billing_period ?? "weekly") as BillingPeriod);
    setVendor(a.vendor ?? "");
    setNotes(a.notes ?? "");
    setStartDate(a.start_date);
    setEndDate(a.end_date ?? "");
    setStatus(a.status);
    setOpen(true);
  }

  async function submit() {
    setBusy(true);
    const res = await upsertAssignment({
      id: editing?.id,
      employee_id: employeeId,
      client_id: clientId,
      title,
      bill_rate: Number(billRate),
      pay_rate: Number(payRate),
      currency: "USD",
      employment_type: employmentType,
      overtime_multiplier: Number(otMult),
      billing_period: billingPeriod,
      vendor: vendor || null,
      notes: notes || null,
      start_date: startDate,
      end_date: endDate || null,
      status,
    });
    setBusy(false);
    if (res.ok) {
      toast({ title: editing ? "Assignment updated" : "Assignment created" });
      setOpen(false);
      router.refresh();
    } else {
      toast({ variant: "destructive", title: res.error });
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Tip content="Type to filter the list below by employee, client, assignment title, or vendor.">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employee, client, vendor…"
                className="w-48 pl-8 sm:w-64"
              />
            </div>
          </Tip>
          <Select
            value={statusFilter}
            onValueChange={(v) =>
              setStatusFilter(v as "all" | "active" | "ended")
            }
          >
            <Tip content="Show only Active or only Ended assignments (or All).">
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
            </Tip>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="ended">Ended</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Tip content="Download all assignments (employee, client, rates, vendor, notes, dates) as an Excel file.">
            <Button variant="outline" asChild>
              <a href="/admin/assignments/export?format=xlsx">
                <Download className="h-4 w-4" />
                Export
              </a>
            </Button>
          </Tip>
          <Tip content="Place an employee on a client with bill/pay rates and a billing period.">
            <Button
              onClick={openNew}
              disabled={employees.length === 0 || clients.length === 0}
            >
              <Plus className="h-4 w-4" />
              New assignment
            </Button>
          </Tip>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Bill / Pay</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleAssignments.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No assignments match your filter.
                  </TableCell>
                </TableRow>
              )}
              {visibleAssignments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">
                    {a.employee?.full_name ?? "—"}
                  </TableCell>
                  <TableCell>{a.client?.name ?? "—"}</TableCell>
                  <TableCell>
                    {formatMoney(a.bill_rate)} / {formatMoney(a.pay_rate)}
                  </TableCell>
                  <TableCell className="capitalize">
                    {a.billing_period ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={a.status === "active" ? "success" : "secondary"}
                    >
                      {a.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Tip content="Record a mid-project rate change. Old periods keep their rate; new periods use the new one.">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => openChangeRate(a)}
                      >
                        Change rate
                      </Button>
                    </Tip>
                    <Button variant="link" size="sm" onClick={() => openEdit(a)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit assignment" : "New assignment"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="a-emp">Employee</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger id="a-emp">
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.full_name ?? e.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="a-client">Client</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger id="a-client">
                    <SelectValue placeholder="Select client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="a-title">Title</Label>
              <Input
                id="a-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="a-bill" className="flex items-center gap-1.5">
                  Bill rate
                  <InfoTip content="What you charge the CLIENT per hour for this person's work." />
                </Label>
                <Input
                  id="a-bill"
                  type="number"
                  min={0}
                  step={0.01}
                  value={billRate}
                  disabled={!!editing}
                  onChange={(e) => setBillRate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="a-pay" className="flex items-center gap-1.5">
                  Pay rate
                  <InfoTip content="What you PAY the worker per hour. The gap between bill and pay rate is your margin." />
                </Label>
                <Input
                  id="a-pay"
                  type="number"
                  min={0}
                  step={0.01}
                  value={payRate}
                  disabled={!!editing}
                  onChange={(e) => setPayRate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="a-ot" className="flex items-center gap-1.5">
                  OT ×
                  <InfoTip content="Overtime multiplier. Overtime hours are billed and paid at this multiple of the rate (e.g. 1.5 = time-and-a-half)." />
                </Label>
                <Input
                  id="a-ot"
                  type="number"
                  min={1}
                  step={0.1}
                  value={otMult}
                  disabled={!!editing}
                  onChange={(e) => setOtMult(e.target.value)}
                />
              </div>
            </div>
            {editing && (
              <p className="-mt-2 text-xs text-muted-foreground">
                Rates are managed via <strong>Change rate</strong> so past periods
                keep their original rate.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="a-type" className="flex items-center gap-1.5">
                  Employment type
                  <InfoTip content="W2 = your payrolled employee; 1099 = independent contractor. Affects tax/pay handling and shows in payroll." />
                </Label>
                <Select
                  value={employmentType}
                  onValueChange={(v) => setEmploymentType(v as EmploymentType)}
                >
                  <SelectTrigger id="a-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="W2">W2</SelectItem>
                    <SelectItem value="1099">1099</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="a-period" className="flex items-center gap-1.5">
                  Billing period
                  <InfoTip content="How often the employee submits a timesheet for this assignment (the work window). The client's own billing period controls how often they're invoiced." />
                </Label>
                <Select
                  value={billingPeriod}
                  onValueChange={(v) => setBillingPeriod(v as BillingPeriod)}
                >
                  <SelectTrigger id="a-period">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BILLING_PERIODS.map((p) => (
                      <SelectItem key={p} value={p} className="capitalize">
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="a-start">Start date</Label>
                <Input
                  id="a-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="a-end">End date (optional)</Label>
                <Input
                  id="a-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="a-status">Status</Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as "active" | "ended")}
                >
                  <SelectTrigger id="a-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="ended">Ended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="a-vendor" className="flex items-center gap-1.5">
                  Vendor (optional)
                  <InfoTip content="The third party (agency/subcontractor) the worker is sourced through and paid via. Leave blank if you hired them directly. Shows in the payroll export." />
                </Label>
                <Input
                  id="a-vendor"
                  value={vendor}
                  placeholder="e.g. agency the worker is sourced through"
                  onChange={(e) => setVendor(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="a-notes" className="flex items-center gap-1.5">
                Notes (optional)
                <InfoTip content="Free-text note about this assignment (e.g. special pay arrangement). Appears in the payroll export." />
              </Label>
              <Textarea
                id="a-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!rateTarget}
        onOpenChange={(o) => !o && setRateTarget(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Change rate</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              {rateTarget?.employee?.full_name ?? "—"} ·{" "}
              {rateTarget?.client?.name ?? "—"}. The new rate applies to periods
              starting on or after the effective date; earlier periods keep their
              rate.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="r-bill">Bill rate</Label>
                <Input
                  id="r-bill"
                  type="number"
                  min={0}
                  step={0.01}
                  value={newBill}
                  onChange={(e) => setNewBill(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="r-pay">Pay rate</Label>
                <Input
                  id="r-pay"
                  type="number"
                  min={0}
                  step={0.01}
                  value={newPay}
                  onChange={(e) => setNewPay(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="r-ot">OT ×</Label>
                <Input
                  id="r-ot"
                  type="number"
                  min={1}
                  step={0.1}
                  value={newOt}
                  onChange={(e) => setNewOt(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="r-eff" className="flex items-center gap-1.5">
                Effective from
                <InfoTip content="The new rate applies to periods starting on or after this date. Earlier periods keep their old rate, so past invoices aren't changed." />
              </Label>
              <Input
                id="r-eff"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
            {rateTarget && rateTarget.rates.length > 0 && (
              <div className="grid gap-1">
                <Label>Rate history</Label>
                <div className="rounded-md border text-sm">
                  {rateTarget.rates.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-2 border-b px-3 py-1.5 last:border-0"
                    >
                      <span className="text-muted-foreground">
                        from {formatDate(r.effective_from)}
                      </span>
                      <span>
                        {formatMoney(r.bill_rate)} / {formatMoney(r.pay_rate)} ·{" "}
                        {r.overtime_multiplier}× OT
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRateTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitRate} disabled={rateBusy || !effectiveFrom}>
              {rateBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Save rate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
