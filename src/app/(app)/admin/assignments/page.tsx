import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { AssignmentsManager } from "@/components/admin/assignments-manager";
import type { Assignment, AssignmentRate } from "@/lib/types";

export default async function AdminAssignmentsPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const [
    { data: assignments },
    { data: employees },
    { data: clients },
    { data: rateRows },
  ] = await Promise.all([
    supabase
      .from("assignments")
      .select(
        "*, employee:profiles!employee_id(full_name), client:clients(name)"
      )
      .order("created_at", { ascending: false }),
    // Only real employees can be assigned — exclude admins/reviewers/finance
    // and the hidden operator account.
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("status", "active")
      .eq("role", "employee")
      .eq("is_operator", false)
      .order("full_name", { ascending: true }),
    supabase
      .from("clients")
      .select("id, name")
      .eq("status", "active")
      .order("name", { ascending: true }),
    supabase
      .from("assignment_rates")
      .select("*")
      .order("effective_from", { ascending: false }),
  ]);

  // Group rate history by assignment so each row carries its timeline.
  const ratesByAssignment = new Map<string, AssignmentRate[]>();
  for (const rr of (rateRows ?? []) as AssignmentRate[]) {
    const arr = ratesByAssignment.get(rr.assignment_id) ?? [];
    arr.push(rr);
    ratesByAssignment.set(rr.assignment_id, arr);
  }
  const assignmentsWithRates = ((assignments ?? []) as { id: string }[]).map(
    (a) => ({ ...a, rates: ratesByAssignment.get(a.id) ?? [] })
  );

  return (
    <div>
      <PageHeader
        title="Assignments"
        description="Link employees to clients with bill and pay rates."
      />
      <AssignmentsManager
        assignments={
          assignmentsWithRates as unknown as (Assignment & {
            employee: { full_name: string | null } | null;
            client: { name: string } | null;
            rates: AssignmentRate[];
          })[]
        }
        employees={(employees ?? []) as { id: string; full_name: string | null }[]}
        clients={(clients ?? []) as { id: string; name: string }[]}
      />
    </div>
  );
}
