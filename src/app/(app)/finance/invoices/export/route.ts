import {
  exportResponse,
  guardRole,
  parseFormat,
  type Cell,
} from "@/lib/export-response";
import { getInvoiceAttribution } from "@/lib/invoice-attribution";

export async function GET(request: Request) {
  const guard = await guardRole(["finance", "admin"]);
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const format = parseFormat(new URL(request.url).searchParams.get("format"));

  const { data } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, period_start, period_end, status, subtotal, total, issued_date, due_date, client:clients(name, payment_terms_days)"
    )
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as {
    id: string;
    invoice_number: string;
    period_start: string | null;
    period_end: string | null;
    status: string;
    subtotal: number;
    total: number;
    issued_date: string | null;
    due_date: string | null;
    client: { name: string; payment_terms_days: number | null } | null;
  }[];

  const invoiceIds = rows.map((r) => r.id);
  const attribution = await getInvoiceAttribution(invoiceIds);

  // Adjustment totals per invoice (deductions subtract, reimbursements add).
  const deductionsByInvoice = new Map<string, number>();
  const reimbursementsByInvoice = new Map<string, number>();
  if (invoiceIds.length) {
    const { data: adj } = await supabase
      .from("invoice_adjustments")
      .select("invoice_id, kind, amount")
      .in("invoice_id", invoiceIds);
    for (const a of adj ?? []) {
      const map =
        a.kind === "deduction" ? deductionsByInvoice : reimbursementsByInvoice;
      map.set(a.invoice_id, (map.get(a.invoice_id) ?? 0) + Number(a.amount));
    }
  }

  const headers = [
    "invoice_number",
    "client",
    "period_start",
    "period_end",
    "status",
    "subtotal",
    "total",
    "issued_date",
    "due_date",
    "payment_terms_days",
    "deductions",
    "reimbursements",
    "net_amount",
    "generated_by",
    "reviewed_approved_by",
    "accounted_by",
  ];
  const dataRows: Cell[][] = rows.map((r) => {
    const a = attribution.get(r.id);
    const ded = deductionsByInvoice.get(r.id) ?? 0;
    const reimb = reimbursementsByInvoice.get(r.id) ?? 0;
    const net = Number(r.total) - ded + reimb;
    return [
      r.invoice_number,
      r.client?.name ?? "",
      r.period_start ?? "",
      r.period_end ?? "",
      r.status,
      Number(r.subtotal).toFixed(2),
      Number(r.total).toFixed(2),
      r.issued_date ?? "",
      r.due_date ?? "",
      r.client?.payment_terms_days ?? "",
      ded.toFixed(2),
      reimb.toFixed(2),
      net.toFixed(2),
      a?.generatedBy ?? "",
      a?.reviewedBy ?? "",
      a?.accountedBy ?? "",
    ];
  });

  return exportResponse("invoices", headers, dataRows, format);
}
