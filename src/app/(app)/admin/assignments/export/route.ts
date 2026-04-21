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
    .from("assignments")
    .select(
      "title, bill_rate, pay_rate, overtime_multiplier, employment_type, billing_period, vendor, notes, start_date, end_date, status, employee:profiles!employee_id(full_name, emp_code), client:clients(name)"
    )
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as unknown as {
    title: string | null;
    bill_rate: number;
    pay_rate: number;
    overtime_multiplier: number;
    employment_type: string | null;
    billing_period: string | null;
    vendor: string | null;
    notes: string | null;
    start_date: string;
    end_date: string | null;
    status: string;
    employee: { full_name: string | null; emp_code: string | null } | null;
    client: { name: string } | null;
  }[];

  const headers = [
    "employee",
    "employee_id",
    "client",
    "title",
    "employment_type",
    "billing_period",
    "vendor",
    "bill_rate",
    "pay_rate",
    "overtime_multiplier",
    "start_date",
    "end_date",
    "status",
    "notes",
  ];
  const dataRows: Cell[][] = rows.map((r) => [
    r.employee?.full_name ?? "",
    r.employee?.emp_code ?? "",
    r.client?.name ?? "",
    r.title ?? "",
    r.employment_type ?? "",
    r.billing_period ?? "",
    r.vendor ?? "",
    r.bill_rate,
    r.pay_rate,
    r.overtime_multiplier,
    r.start_date,
    r.end_date ?? "",
    r.status,
    r.notes ?? "",
  ]);

  return exportResponse("assignments", headers, dataRows, format);
}
