import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { homePathForRole } from "@/lib/auth";
import type { Role } from "@/lib/types";

// Handles the OAuth (Google/Microsoft) and email-link callbacks. Exchanges the
// auth code for a session, then routes the user to their role-aware home (or an
// explicit redirectTo, e.g. the password-reset page).
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirectTo");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  if (redirectTo) {
    return NextResponse.redirect(`${origin}${redirectTo}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let dest = "/";
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (data?.role) dest = homePathForRole(data.role as Role);
  }

  return NextResponse.redirect(`${origin}${dest}`);
}
