import { NextResponse } from "next/server";

import { runMeetingCron } from "@/lib/meetings";
import { createServiceClient } from "@/lib/supabase/service";

// Secured endpoint for the bi-weekly 1:1 meetings. Called every minute by the
// Azure Functions timer in azure/cron with `Authorization: Bearer <CRON_SECRET>`.
// Each run: generates the next cycle when it's due, then emails every meeting
// whose notice time (24 hours before by default) has arrived. Safe to call
// more often; a meeting's email is never sent twice.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runMeetingCron(createServiceClient());
    // Incomplete settings return 200 so an unconfigured feature isn't noisy;
    // failed sends return 500 so they show as failures in Azure.
    const status = result.ok || result.skipped ? 200 : 500;
    return NextResponse.json(result, { status });
  } catch (e) {
    console.error("[cron/meetings]", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
