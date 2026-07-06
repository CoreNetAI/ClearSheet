import { NextResponse } from "next/server";

import { sendTimesheetReminders } from "@/lib/reminders";

// Secured endpoint that emails employees their outstanding timesheet periods.
// Triggered on a schedule by .github/workflows/reminders.yml, which sends
// `Authorization: Bearer <CRON_SECRET>`. Not callable without the secret.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendTimesheetReminders();
  // 200 even when email is unconfigured/skipped so the scheduler isn't noisy;
  // only a genuine send failure returns 500.
  const status = result.ok || result.skipped ? 200 : 500;
  return NextResponse.json(result, { status });
}
