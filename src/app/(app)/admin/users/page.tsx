import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { UsersManager } from "@/components/admin/users-manager";
import type { Profile } from "@/lib/types";

export default async function AdminUsersPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const [{ data }, { data: auth }] = await Promise.all([
    supabase
      .from("profiles")
      .select("*")
      // Operators (builder-only) are concealed from the customer's user list.
      .eq("is_operator", false)
      .order("created_at", { ascending: true }),
    supabase.auth.getUser(),
  ]);

  return (
    <div>
      <PageHeader
        title="Users"
        description="Create accounts and manage roles and status."
      />
      <UsersManager
        users={(data ?? []) as Profile[]}
        currentUserId={auth.user?.id ?? null}
      />
    </div>
  );
}
