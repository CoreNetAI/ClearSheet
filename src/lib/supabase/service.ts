import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — BYPASSES RLS. Use ONLY in trusted server code:
// webhooks, presigned URL generation, admin user provisioning, seeding.
// Never import this into a client component.
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
