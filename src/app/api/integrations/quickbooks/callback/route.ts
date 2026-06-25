import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exchangeCodeForTokens, isQuickBooksEnabled } from "@/lib/quickbooks";
import { encryptToken } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";

// Completes the QBO OAuth flow: validates state, exchanges the code, and stores
// encrypted tokens + realmId on the integration_connections row.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  if (!isQuickBooksEnabled()) {
    return NextResponse.redirect(`${origin}/admin/integrations?error=disabled`);
  }

  const code = searchParams.get("code");
  const realmId = searchParams.get("realmId");
  const state = searchParams.get("state");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  // CSRF: state must match the cookie set at connect time.
  const cookieState = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("qbo_oauth_state="))
    ?.split("=")[1];

  if (!code || !realmId || !state || state !== cookieState) {
    return NextResponse.redirect(`${origin}/admin/integrations?error=state`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000
    ).toISOString();

    // Upsert the single QuickBooks connection row.
    const { data: existing } = await supabase
      .from("integration_connections")
      .select("id")
      .eq("provider", "quickbooks")
      .maybeSingle();

    const payload = {
      provider: "quickbooks" as const,
      access_token: encryptToken(tokens.access_token),
      refresh_token: encryptToken(tokens.refresh_token),
      realm_id: realmId,
      expires_at: expiresAt,
      connected_by: user.id,
      status: "connected" as const,
    };

    if (existing) {
      await supabase
        .from("integration_connections")
        .update(payload)
        .eq("id", existing.id);
    } else {
      await supabase.from("integration_connections").insert(payload);
    }

    await writeAudit(supabase, {
      actorId: user.id,
      entityType: "integration",
      entityId: "00000000-0000-0000-0000-000000000000",
      action: "quickbooks_connect",
      detail: { realmId },
    });

    const res = NextResponse.redirect(
      `${origin}/admin/integrations?connected=1`
    );
    res.cookies.delete("qbo_oauth_state");
    return res;
  } catch (e) {
    return NextResponse.redirect(
      `${origin}/admin/integrations?error=${encodeURIComponent(
        e instanceof Error ? e.message : "exchange"
      )}`
    );
  }
}
