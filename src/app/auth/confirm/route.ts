import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { homePathForRole } from "@/lib/auth";
import type { Role } from "@/lib/types";

// Consumes server-generated email links (admin invites + resends) via the
// token-hash flow. Unlike /auth/callback (PKCE exchangeCodeForSession, used by
// browser-initiated flows), this verifies a `token_hash` with verifyOtp, which
// needs no prior browser state — the correct primitive for admin.generateLink.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const redirectTo = searchParams.get("redirectTo");

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });
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
