import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { firm } from "@/lib/config";
import { buildInvoicePdf } from "@/lib/pdf/invoice-pdf";

// Fetches an invoice with the given client and renders its PDF. Works with any
// Supabase client (user-scoped for downloads, service for emailing).
export async function renderInvoicePdf(
  supabase: SupabaseClient,
  invoiceId: string
): Promise<{ bytes: Uint8Array; invoiceNumber: string } | null> {
  const { data } = await supabase
    .from("invoices")
    .select(
      "*, client:clients(name, billing_address, contact_name, contact_email), line_items:invoice_line_items(*)"
    )
    .eq("id", invoiceId)
    .maybeSingle();

  if (!data) return null;

  const bytes = await buildInvoicePdf({
    firm: {
      name: firm.name,
      address: firm.address,
      email: firm.email,
      logoUrl: firm.logoUrl,
    },
    invoice: {
      invoice_number: data.invoice_number,
      issued_date: data.issued_date,
      due_date: data.due_date,
      period_start: data.period_start,
      period_end: data.period_end,
      subtotal: Number(data.subtotal),
      total: Number(data.total),
      currency: "USD",
    },
    client: {
      name: data.client?.name ?? "Client",
      billing_address: data.client?.billing_address ?? null,
      contact_name: data.client?.contact_name ?? null,
      contact_email: data.client?.contact_email ?? null,
    },
    lineItems: (data.line_items ?? []).map(
      (li: {
        employee_name: string | null;
        assignment_title: string | null;
        hours: number;
        bill_rate: number;
        amount: number;
      }) => ({
        employee_name: li.employee_name,
        assignment_title: li.assignment_title,
        hours: Number(li.hours),
        bill_rate: Number(li.bill_rate),
        amount: Number(li.amount),
      })
    ),
  });

  return { bytes, invoiceNumber: data.invoice_number };
}
