import type { SupabaseClient } from "@supabase/supabase-js";

// Append an audit_log row. Uses whatever client is passed: the user-scoped
// client records actor_id = the signed-in user; the service client is used by
// webhooks where there is no session.
export async function writeAudit(
  supabase: SupabaseClient,
  entry: {
    actorId: string | null;
    entityType: string;
    entityId: string;
    action: string;
    detail?: Record<string, unknown>;
  }
): Promise<void> {
  await supabase.from("audit_log").insert({
    actor_id: entry.actorId,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    action: entry.action,
    detail: entry.detail ?? null,
  });
}
