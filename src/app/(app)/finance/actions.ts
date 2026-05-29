"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { round2 } from "@/lib/calc";
import { effectiveRate } from "@/lib/rates";
import { todayInTz } from "@/lib/periods";
import {
  clientCycleFor,
  expectedPeriodStarts,
  isBundledCadence,
} from "@/lib/billing-cycles";
import { defaultTimezone } from "@/lib/config";
import {
  generateInvoiceSchema,
  invoiceAdjustmentSchema,
  markInvoiceSchema,
} from "@/lib/validation";
import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import type { AssignmentRate, BillingPeriod } from "@/lib/types";
import { z } from "zod";

async function financeContext() {
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
  if (!profile || !["finance", "admin"].includes(profile.role)) return null;
  return { supabase, userId: user.id };
}

function addDaysISO(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export async function generateInvoice(input: {
  clientId: string;
  periodStart: string;
  periodEnd: string;
  timesheetIds: string[];
}): Promise<ActionResult<{ invoiceId: string }>> {
  const parsed = generateInvoiceSchema.safeParse(input);
  if (!parsed.success) return actionError("Invalid invoice request.");
  const { clientId, periodStart, periodEnd, timesheetIds } = parsed.data;

  const ctx = await financeContext();
  if (!ctx) return actionError("Not authorized.");
  const { supabase, userId } = ctx;

  // Load the candidate timesheets with snapshot data.
  const { data: tsRows } = await supabase
    .from("timesheets")
    .select(
      "id, status, period_start, assignment_id, bill_amount, total_ot_hours, employee:profiles!employee_id(full_name), assignment:assignments(title, billing_period, start_date, end_date, client_id, client:clients(billing_period))"
    )
    .in("id", timesheetIds);

  const rows = (tsRows ?? []) as unknown as {
    id: string;
    status: string;
    period_start: string;
    assignment_id: string;
    bill_amount: number;
    total_ot_hours: number;
    employee: { full_name: string | null } | null;
    assignment: {
      title: string | null;
      billing_period: BillingPeriod | null;
      start_date: string | null;
      end_date: string | null;
      client_id: string;
      client: { billing_period: BillingPeriod | null } | null;
    } | null;
  }[];

  if (rows.length !== timesheetIds.length) {
    return actionError("Some timesheets could not be found.");
  }
  for (const r of rows) {
    if (r.status !== "approved") {
      return actionError("All timesheets must be approved.");
    }
    if (r.assignment?.client_id !== clientId) {
      return actionError("Timesheets must all belong to the same client.");
    }
  }

  // Enforce full-cycle invoicing (#6): when an assignment is billed on a finer
  // cadence than the client, every constituent period of the client's billing
  // cycle must be approved AND included — no invoicing half a cycle.
  const selectedStartsByAssignment = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = selectedStartsByAssignment.get(r.assignment_id) ?? new Set();
    set.add(r.period_start);
    selectedStartsByAssignment.set(r.assignment_id, set);
  }
  for (const r of rows) {
    const aCad = (r.assignment?.billing_period ?? "weekly") as BillingPeriod;
    const cCad = (r.assignment?.client?.billing_period ?? aCad) as BillingPeriod;
    if (!isBundledCadence(aCad, cCad)) continue;
    const anchor = r.assignment?.start_date ?? r.period_start;
    const cycle = clientCycleFor(cCad, r.period_start);
    const expected = expectedPeriodStarts(
      aCad,
      cycle,
      r.assignment?.start_date ?? null,
      r.assignment?.end_date ?? null,
      anchor
    );
    const selected = selectedStartsByAssignment.get(r.assignment_id) ?? new Set();
    if (expected.some((s) => !selected.has(s))) {
      return actionError(
        "This client is invoiced per full billing cycle. Wait until every period in the cycle is approved, then invoice the whole cycle."
      );
    }
  }

  // Billable hours per timesheet (regular + overtime) from entries.
  const { data: entryRows } = await supabase
    .from("timesheet_entries")
    .select("timesheet_id, hours, entry_type")
    .in("timesheet_id", timesheetIds);
  const billableByTs = new Map<string, number>();
  for (const e of entryRows ?? []) {
    if (e.entry_type === "regular" || e.entry_type === "overtime") {
      billableByTs.set(
        e.timesheet_id,
        (billableByTs.get(e.timesheet_id) ?? 0) + Number(e.hours)
      );
    }
  }

  // Resolve each timesheet's bill rate from the assignment's rate history
  // (the rate in force for that period), so the line item's rate matches its
  // frozen amount even after a mid-project rate change.
  const assignmentIds = Array.from(
    new Set(rows.map((r) => r.assignment_id).filter(Boolean))
  );
  const { data: rateRows } = await supabase
    .from("assignment_rates")
    .select("assignment_id, bill_rate, pay_rate, overtime_multiplier, effective_from")
    .in("assignment_id", assignmentIds);
  const ratesByAssignment = new Map<string, AssignmentRate[]>();
  for (const rr of (rateRows ?? []) as AssignmentRate[]) {
    const arr = ratesByAssignment.get(rr.assignment_id) ?? [];
    arr.push(rr);
    ratesByAssignment.set(rr.assignment_id, arr);
  }
  const billRateFor = (r: { assignment_id: string; period_start: string }) =>
    effectiveRate(ratesByAssignment.get(r.assignment_id) ?? [], r.period_start)
      .bill_rate;

  const subtotal = round2(rows.reduce((s, r) => s + Number(r.bill_amount), 0));

  // Sequential per-year invoice number (concurrency-safe DB function).
  const { data: numberData, error: numberErr } = await supabase.rpc(
    "next_invoice_number"
  );
  if (numberErr || !numberData) {
    return actionError("Could not allocate an invoice number.");
  }
  const invoiceNumber = numberData as string;

  // Due date = issue date + the client's configured payment terms (net days).
  // Snapshotted here, so later changes to the client's terms don't move it.
  const { data: client } = await supabase
    .from("clients")
    .select("payment_terms_days")
    .eq("id", clientId)
    .maybeSingle();
  const termsDays = client?.payment_terms_days ?? 30;

  const issued = todayInTz(defaultTimezone);
  const due = addDaysISO(issued, termsDays);

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .insert({
      client_id: clientId,
      invoice_number: invoiceNumber,
      period_start: periodStart,
      period_end: periodEnd,
      status: "draft",
      subtotal,
      total: subtotal,
      issued_date: issued,
      due_date: due,
      created_by: userId,
    })
    .select("id")
    .single();

  if (invErr || !invoice) {
    return actionError("Could not create invoice.");
  }

  const lineItems = rows.map((r) => ({
    invoice_id: invoice.id,
    timesheet_id: r.id,
    employee_name: r.employee?.full_name ?? null,
    assignment_title: r.assignment?.title ?? null,
    hours: round2(billableByTs.get(r.id) ?? 0),
    bill_rate: billRateFor(r),
    amount: round2(Number(r.bill_amount)),
  }));

  const { error: liErr } = await supabase
    .from("invoice_line_items")
    .insert(lineItems);
  if (liErr) {
    // Roll back the invoice shell to avoid an empty invoice.
    await supabase.from("invoices").delete().eq("id", invoice.id);
    return actionError("Could not create invoice line items.");
  }

  const { error: tsErr } = await supabase
    .from("timesheets")
    .update({ status: "invoiced" })
    .in("id", timesheetIds);
  if (tsErr) {
    return actionError("Invoice created, but timesheets could not be updated.");
  }

  await writeAudit(supabase, {
    actorId: userId,
    entityType: "invoice",
    entityId: invoice.id,
    action: "generate",
    detail: { invoiceNumber, clientId, count: rows.length, subtotal },
  });

  revalidatePath("/finance");
  revalidatePath("/finance/invoices");
  return actionOk({ invoiceId: invoice.id });
}

export async function markInvoice(
  invoiceId: string,
  status: "paid" | "void" | "sent"
): Promise<ActionResult> {
  const parsed = markInvoiceSchema.safeParse({ invoiceId, status });
  if (!parsed.success) return actionError("Invalid request.");

  const ctx = await financeContext();
  if (!ctx) return actionError("Not authorized.");
  const { supabase, userId } = ctx;

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return actionError("Invoice not found.");

  const { data: lis } = await supabase
    .from("invoice_line_items")
    .select("timesheet_id")
    .eq("invoice_id", invoiceId);
  const tsIds = (lis ?? [])
    .map((l) => l.timesheet_id)
    .filter((x): x is string => Boolean(x));

  if (status === "paid") {
    const { error } = await supabase
      .from("invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", invoiceId);
    if (error) return actionError("Could not mark paid.");
    if (tsIds.length) {
      await supabase
        .from("timesheets")
        .update({ status: "paid" })
        .in("id", tsIds)
        .eq("status", "invoiced");
    }
  } else if (status === "void") {
    const { error } = await supabase
      .from("invoices")
      .update({ status: "void" })
      .eq("id", invoiceId);
    if (error) return actionError("Could not void invoice.");
    // Return invoiced timesheets to approved so they can be re-invoiced.
    if (tsIds.length) {
      await supabase
        .from("timesheets")
        .update({ status: "approved" })
        .in("id", tsIds)
        .eq("status", "invoiced");
    }
  } else if (status === "sent") {
    const { error } = await supabase
      .from("invoices")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", invoiceId);
    if (error) return actionError("Could not mark sent.");
  }

  await writeAudit(supabase, {
    actorId: userId,
    entityType: "invoice",
    entityId: invoiceId,
    action: `mark_${status}`,
  });

  revalidatePath("/finance/invoices");
  revalidatePath(`/finance/invoices/${invoiceId}`);
  return actionOk();
}

// Attach a deduction or reimbursement to an invoice at the accounting stage.
export async function addInvoiceAdjustment(input: {
  invoiceId: string;
  kind: "deduction" | "reimbursement";
  label: string;
  amount: number;
  employeeId?: string | null;
}): Promise<ActionResult> {
  const parsed = invoiceAdjustmentSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message || "Invalid adjustment.");
  }

  const ctx = await financeContext();
  if (!ctx) return actionError("Not authorized.");
  const { supabase, userId } = ctx;

  const { error } = await supabase.from("invoice_adjustments").insert({
    invoice_id: parsed.data.invoiceId,
    employee_id: parsed.data.employeeId || null,
    kind: parsed.data.kind,
    label: parsed.data.label.trim(),
    amount: parsed.data.amount,
    created_by: userId,
  });
  if (error) return actionError("Could not add the adjustment.");

  await writeAudit(supabase, {
    actorId: userId,
    entityType: "invoice",
    entityId: parsed.data.invoiceId,
    action: "adjustment_add",
    detail: {
      kind: parsed.data.kind,
      label: parsed.data.label,
      amount: parsed.data.amount,
    },
  });

  revalidatePath(`/finance/invoices/${parsed.data.invoiceId}`);
  revalidatePath("/finance/invoices");
  return actionOk();
}

export async function deleteInvoiceAdjustment(input: {
  id: string;
  invoiceId: string;
}): Promise<ActionResult> {
  const id = z.string().uuid().safeParse(input.id);
  const invoiceId = z.string().uuid().safeParse(input.invoiceId);
  if (!id.success || !invoiceId.success) return actionError("Invalid request.");

  const ctx = await financeContext();
  if (!ctx) return actionError("Not authorized.");
  const { supabase, userId } = ctx;

  const { error } = await supabase
    .from("invoice_adjustments")
    .delete()
    .eq("id", id.data);
  if (error) return actionError("Could not remove the adjustment.");

  await writeAudit(supabase, {
    actorId: userId,
    entityType: "invoice",
    entityId: invoiceId.data,
    action: "adjustment_remove",
    detail: { adjustmentId: id.data },
  });

  revalidatePath(`/finance/invoices/${invoiceId.data}`);
  revalidatePath("/finance/invoices");
  return actionOk();
}
