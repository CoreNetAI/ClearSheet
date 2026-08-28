const { app } = require("@azure/functions");

// ClearSheet scheduler. Each job is a timer that POSTs to a secured endpoint in
// the main app with `Authorization: Bearer <CRON_SECRET>`. All the real work
// (who to email, what to send) lives in the app; this only rings the bell.
//
// Schedules are NCRONTAB with seconds: "sec min hour day month weekday", in UTC.
//
// Required app settings on the Function App:
//   APP_BASE_URL  e.g. https://clearsheet-corenetai.azurewebsites.net
//   CRON_SECRET   must equal CRON_SECRET on the main App Service

const JOBS = [
  {
    name: "timesheetReminders",
    schedule: "0 0 13 * * 1", // Mondays 13:00 UTC (~8-9am US Eastern)
    path: "/api/cron/reminders",
  },
  {
    // Generates each new meeting cycle and sends each meeting's email when its
    // notice time (24h before) arrives. Deploy the app with /api/cron/meetings first.
    name: "meetings",
    schedule: "0 * * * * *", // every minute
    path: "/api/cron/meetings",
  },
];

async function callApp(path, context) {
  const base = (process.env.APP_BASE_URL || "").replace(/\/+$/, "");
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    throw new Error("APP_BASE_URL and CRON_SECRET must be set on the Function App");
  }

  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.text();
  context.log(`POST ${path} -> HTTP ${res.status} ${body.slice(0, 2000)}`);

  // Throwing marks the run as failed in the Monitor tab.
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
}

for (const job of JOBS) {
  app.timer(job.name, {
    schedule: job.schedule,
    runOnStartup: false,
    handler: async (timer, context) => {
      if (timer.isPastDue) context.log("Timer is running late (past due).");
      await callApp(job.path, context);
    },
  });
}
