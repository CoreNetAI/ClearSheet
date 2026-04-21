import {
  exportResponse,
  guardRole,
  parseFormat,
  type Cell,
} from "@/lib/export-response";

export async function GET(request: Request) {
  const guard = await guardRole(["admin"]);
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const format = parseFormat(new URL(request.url).searchParams.get("format"));

  const { data } = await supabase
    .from("clients")
    .select(
      "name, contact_name, contact_email, billing_period, payment_terms_days, billing_address, status"
    )
    .order("name", { ascending: true });

  const rows = (data ?? []) as {
    name: string;
    contact_name: string | null;
    contact_email: string | null;
    billing_period: string | null;
    payment_terms_days: number | null;
    billing_address: string | null;
    status: string;
  }[];

  const headers = [
    "name",
    "contact_name",
    "contact_email",
    "billing_period",
    "payment_terms_days",
    "billing_address",
    "status",
  ];
  const dataRows: Cell[][] = rows.map((r) => [
    r.name,
    r.contact_name ?? "",
    r.contact_email ?? "",
    r.billing_period ?? "",
    r.payment_terms_days ?? "",
    r.billing_address ?? "",
    r.status,
  ]);

  return exportResponse("clients", headers, dataRows, format);
}
