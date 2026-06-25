import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { getAuthorizeUrl, isQuickBooksEnabled } from "@/lib/quickbooks";

// Starts the QBO OAuth flow. Operator-only (integration setup). A random state is
// stored in an httpOnly cookie and verified on callback (CSRF protection).
export async function GET() {
  if (!isQuickBooksEnabled()) {
    return NextResponse.json({ error: "QuickBooks not configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_operator")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_operator) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(getAuthorizeUrl(state));
  res.cookies.set("qbo_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
