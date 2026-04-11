import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

/**
 * The signed-in auth user (or null).
 *
 * Reads the user from the session cookie LOCALLY (no auth-server round-trip).
 * This is safe because every protected route passes through `updateSession`
 * in middleware first, which calls `auth.getUser()` against the auth server on
 * each request and redirects to /login if the token is invalid or expired. By
 * the time a server component renders, the session has already been verified
 * and refreshed for this request — so re-verifying here just adds a redundant
 * network call (the main cause of sluggish navigation).
 *
 * Wrapped in React `cache()` so the layout, page, and components share one read
 * within a single server render.
 */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user ?? null;
});

/**
 * The signed-in user's profile row (or null if signed out / missing).
 * Also `cache()`d, so the layout and page don't each re-query it.
 */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  return (data as Profile | null) ?? null;
});

/** Require an active signed-in profile, else redirect to /login. */
export async function requireProfile(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.status === "inactive") redirect("/login?error=inactive");
  return profile;
}

/** Require one of the given roles, else redirect home with a forbidden flag. */
export async function requireRole(...roles: Role[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) redirect("/?error=forbidden");
  return profile;
}

/**
 * Require the hidden builder-only operator capability. Anyone without it —
 * including a normal admin — is bounced, so the operator pages stay concealed
 * (not merely unlinked).
 */
export async function requireOperator(): Promise<Profile> {
  const profile = await requireProfile();
  if (!profile.is_operator) redirect("/?error=forbidden");
  return profile;
}

/** Landing route for a given role. */
export function homePathForRole(role: Role): string {
  switch (role) {
    case "employee":
      return "/employee";
    case "reviewer":
      return "/reviewer";
    case "finance":
      return "/finance";
    case "account_manager":
      return "/account-manager";
    case "admin":
      return "/admin";
    default:
      return "/";
  }
}
