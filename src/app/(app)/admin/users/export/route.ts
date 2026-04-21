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
    .from("profiles")
    .select("full_name, emp_code, email, role, status, invite_status")
    .eq("is_operator", false)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as {
    full_name: string | null;
    emp_code: string | null;
    email: string | null;
    role: string;
    status: string;
    invite_status: string | null;
  }[];

  const headers = [
    "name",
    "employee_id",
    "email",
    "role",
    "status",
    "invite_status",
  ];
  const dataRows: Cell[][] = rows.map((r) => [
    r.full_name ?? "",
    r.emp_code ?? "",
    r.email ?? "",
    r.role,
    r.status,
    r.invite_status ?? "",
  ]);

  return exportResponse("users", headers, dataRows, format);
}
