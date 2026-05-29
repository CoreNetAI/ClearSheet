"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";

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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip, Tip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { formatMoney } from "@/lib/format";
import type { AdjustmentKind, InvoiceAdjustment } from "@/lib/types";
import {
  addInvoiceAdjustment,
  deleteInvoiceAdjustment,
} from "@/app/(app)/finance/actions";

const NONE = "__none__";

export function InvoiceAdjustments({
  invoiceId,
  invoiceTotal,
  adjustments,
  employees,
  editable,
}: {
  invoiceId: string;
  invoiceTotal: number;
  adjustments: InvoiceAdjustment[];
  employees: { id: string; name: string }[];
  editable: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [kind, setKind] = useState<AdjustmentKind>("deduction");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [employeeId, setEmployeeId] = useState<string>(NONE);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const employeeName = (id: string | null) =>
    id ? employees.find((e) => e.id === id)?.name ?? "—" : null;

  const deductions = adjustments
    .filter((a) => a.kind === "deduction")
    .reduce((s, a) => s + Number(a.amount), 0);
  const reimbursements = adjustments
    .filter((a) => a.kind === "reimbursement")
    .reduce((s, a) => s + Number(a.amount), 0);
  const net = invoiceTotal - deductions + reimbursements;

  async function add() {
    if (!label.trim() || !amount) {
      toast({ variant: "destructive", title: "Enter a label and amount." });
      return;
    }
    setBusy(true);
    const res = await addInvoiceAdjustment({
      invoiceId,
      kind,
      label: label.trim(),
      amount: Number(amount),
      employeeId: employeeId === NONE ? null : employeeId,
    });
    setBusy(false);
    if (!res.ok) {
      toast({ variant: "destructive", title: res.error });
      return;
    }
    setLabel("");
    setAmount("");
    setEmployeeId(NONE);
    toast({ title: "Adjustment added" });
    router.refresh();
  }

  async function remove(id: string) {
    setRemovingId(id);
    const res = await deleteInvoiceAdjustment({ id, invoiceId });
    setRemovingId(null);
    if (!res.ok) {
      toast({ variant: "destructive", title: res.error });
      return;
    }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Adjustments</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {adjustments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No deductions or reimbursements on this invoice.
          </p>
        ) : (
          <ul className="grid gap-1">
            {adjustments.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    a.kind === "deduction"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-emerald-500/10 text-emerald-600"
                  }`}
                >
                  {a.kind === "deduction" ? "Deduction" : "Reimbursement"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{a.label}</p>
                  {employeeName(a.employee_id) && (
                    <p className="truncate text-xs text-muted-foreground">
                      {employeeName(a.employee_id)}
                    </p>
                  )}
                </div>
                <span className="font-medium">
                  {a.kind === "deduction" ? "−" : "+"}
                  {formatMoney(a.amount)}
                </span>
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove"
                    disabled={removingId === a.id}
                    onClick={() => remove(a.id)}
                  >
                    {removingId === a.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-1 border-t pt-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Invoice total</span>
            <span>{formatMoney(invoiceTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">− Deductions</span>
            <span>{formatMoney(deductions)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">+ Reimbursements</span>
            <span>{formatMoney(reimbursements)}</span>
          </div>
          <div className="flex justify-between text-base font-bold">
            <span>Net</span>
            <span>{formatMoney(net)}</span>
          </div>
        </div>

        {editable && (
          <div className="grid gap-3 border-t pt-3 sm:grid-cols-[8rem_1fr_8rem_auto] sm:items-end">
            <div className="grid gap-1">
              <Label htmlFor="adj-kind" className="flex items-center gap-1.5">
                Type
                <InfoTip content="Deduction lowers the net (e.g. BGC, 2% fee); Reimbursement raises it (e.g. vendor expenses paid back)." />
              </Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as AdjustmentKind)}
              >
                <SelectTrigger id="adj-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deduction">Deduction</SelectItem>
                  <SelectItem value="reimbursement">Reimbursement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="adj-label">Label</Label>
              <Input
                id="adj-label"
                value={label}
                placeholder="e.g. BGC deduction"
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="adj-amount">Amount</Label>
              <Input
                id="adj-amount"
                type="number"
                min={0}
                step={0.01}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <Tip content="Save this adjustment to the invoice and update the net below.">
              <Button onClick={add} disabled={busy}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Add
              </Button>
            </Tip>
            {employees.length > 0 && (
              <div className="grid gap-1 sm:col-span-4">
                <Label htmlFor="adj-emp" className="flex items-center gap-1.5">
                  Employee (optional)
                  <InfoTip content="Tag this adjustment to one person so it flows into THEIR payroll. Leave as 'Whole invoice' if it applies to the invoice overall." />
                </Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger id="adj-emp" className="sm:w-72">
                    <SelectValue placeholder="Whole invoice" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Whole invoice</SelectItem>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
