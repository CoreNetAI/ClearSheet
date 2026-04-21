import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { ClientsManager } from "@/components/admin/clients-manager";
import type { Client } from "@/lib/types";

export default async function AdminClientsPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const { data: clients } = await supabase
    .from("clients")
    .select("*, account_manager:profiles!account_manager_id(full_name)")
    .order("name", { ascending: true });

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Manage client companies and their billing cadence."
      />
      <ClientsManager
        clients={
          (clients ?? []) as unknown as (Client & {
            account_manager: { full_name: string | null } | null;
          })[]
        }
      />
    </div>
  );
}
