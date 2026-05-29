import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

export interface InvoiceAttribution {
  generatedBy: string; // who created the invoice
  reviewedBy: string; // reviewers of the invoice's timesheets (comma-joined)
  accountedBy: string; // who marked it paid
}

/**
 * Per-invoice audit attribution. Reads from audit_log (admin-only under RLS) and
 * across timesheet reviewers, so it uses the service client. Call ONLY from
 * server code already gated to finance/admin.
 */
export async function getInvoiceAttribution(
  invoiceIds: string[]
): Promise<Map<string, InvoiceAttribution>> {
  const result = new Map<string, InvoiceAttribution>();
  if (!invoiceIds.length) return result;

  const service = createServiceClient();

  const { data: invRows } = await service
    .from("invoices")
    .select("id, created_by")
    .in("id", invoiceIds);
  const createdByInvoice = new Map<string, string | null>();
  for (const i of invRows ?? [])
    createdByInvoice.set(i.id as string, (i.created_by as string) ?? null);

  // Who marked each invoice paid ("accounted").
  const { data: paidRows } = await service
    .from("audit_log")
    .select("entity_id, actor_id")
    .eq("entity_type", "invoice")
    .eq("action", "mark_paid")
    .in("entity_id", invoiceIds);
  const accountedByInvoice = new Map<string, string>();
  for (const p of paidRows ?? [])
    if (p.actor_id)
      accountedByInvoice.set(p.entity_id as string, p.actor_id as string);

  // Reviewers of each invoice's constituent timesheets.
  const { data: lineItems } = await service
    .from("invoice_line_items")
    .select("invoice_id, timesheet_id")
    .in("invoice_id", invoiceIds);
  const tsIds = Array.from(
    new Set(
      (lineItems ?? [])
        .map((l) => l.timesheet_id)
        .filter((x): x is string => Boolean(x))
    )
  );
  const reviewerByTs = new Map<string, string | null>();
  if (tsIds.length) {
    const { data: tsRows } = await service
      .from("timesheets")
      .select("id, reviewed_by")
      .in("id", tsIds);
    for (const t of tsRows ?? [])
      reviewerByTs.set(t.id as string, (t.reviewed_by as string) ?? null);
  }
  const reviewersByInvoice = new Map<string, Set<string>>();
  for (const li of lineItems ?? []) {
    const reviewer = li.timesheet_id ? reviewerByTs.get(li.timesheet_id) : null;
    if (!reviewer) continue;
    const set = reviewersByInvoice.get(li.invoice_id) ?? new Set<string>();
    set.add(reviewer);
    reviewersByInvoice.set(li.invoice_id, set);
  }

  // Resolve every referenced profile id to a name in one query.
  const ids = new Set<string>();
  for (const v of createdByInvoice.values()) if (v) ids.add(v);
  for (const v of accountedByInvoice.values()) ids.add(v);
  for (const set of reviewersByInvoice.values()) for (const r of set) ids.add(r);
  const nameById = new Map<string, string>();
  if (ids.size) {
    const { data: profs } = await service
      .from("profiles")
      .select("id, full_name")
      .in("id", Array.from(ids));
    for (const p of profs ?? [])
      nameById.set(p.id as string, (p.full_name as string) ?? "");
  }
  const nameOf = (id?: string | null) => (id && nameById.get(id)) || "";

  for (const id of invoiceIds) {
    result.set(id, {
      generatedBy: nameOf(createdByInvoice.get(id)),
      reviewedBy: Array.from(reviewersByInvoice.get(id) ?? [])
        .map((r) => nameById.get(r) || "")
        .filter(Boolean)
        .join(", "),
      accountedBy: nameOf(accountedByInvoice.get(id)),
    });
  }
  return result;
}
