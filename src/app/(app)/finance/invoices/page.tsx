import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getInvoiceAttribution } from "@/lib/invoice-attribution";
import { PageHeader } from "@/components/layout/page-header";
import {
  InvoicesList,
  type InvoiceRow,
} from "@/components/finance/invoices-list";
import type { Invoice } from "@/lib/types";

export default async function InvoicesPage() {
  await requireRole("finance", "admin");
  const supabase = await createClient();

  const { data } = await supabase
    .from("invoices")
    .select("*, client:clients(name)")
    .order("created_at", { ascending: false });

  const invoices = (data ?? []) as (Invoice & {
    client: { name: string } | null;
  })[];

  const attribution = await getInvoiceAttribution(invoices.map((i) => i.id));

  const rows: InvoiceRow[] = invoices.map((inv) => {
    const a = attribution.get(inv.id);
    return {
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      clientName: inv.client?.name ?? "",
      periodStart: inv.period_start,
      periodEnd: inv.period_end,
      total: Number(inv.total),
      status: inv.status,
      generatedBy: a?.generatedBy ?? "",
      reviewedBy: a?.reviewedBy ?? "",
      accountedBy: a?.accountedBy ?? "",
    };
  });

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="All generated invoices, newest first."
      />
      <InvoicesList invoices={rows} />
    </div>
  );
}
