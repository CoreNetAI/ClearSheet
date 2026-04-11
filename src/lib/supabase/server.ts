import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Request-scoped Supabase client bound to the user's auth cookies. RLS applies
// as the signed-in user. `cookies()` is async in Next 15.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component where cookies are read-only.
            // Session refresh is handled by middleware instead — safe to ignore.
          }
        },
      },
    }
  );
}
