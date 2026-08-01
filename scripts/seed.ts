/**
 * ClearSheet seed script (testing only — the app runs without it).
 *
 *  - 5 role users: employee@test.com, reviewer@test.com, finance@test.com,
 *    am@test.com, admin@test.com (password: Test1234!)
 *  - ~45 extra employees (configurable via SEED_EMPLOYEE_COUNT) → ~50 users
 *  - 2 clients (one weekly, one monthly) + assignments with bill/pay rates
 *  - 1 draft timesheet for the current period + a few submitted ones so the
 *    reviewer queue and dashboards have data to test against.
 *
 * Usage: npm run seed   (reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *                        from .env.local)
 *
 * Idempotent: re-running reuses existing users/clients/assignments.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TZ = process.env.DEFAULT_TIMEZONE || "America/New_York";
const PASSWORD = "Test1234!";
const EMPLOYEE_COUNT = Number(process.env.SEED_EMPLOYEE_COUNT || 45);

if (!URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
  );
  process.exit(1);
}

const db = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---- date helpers (timezone-safe, self-contained) -------------------------
function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
const toUTC = (s: string) => new Date(`${s}T00:00:00.000Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) =>
  fmt(new Date(toUTC(s).getTime() + n * 86_400_000));

function weeklyPeriod(dateStr: string) {
  const dow = toUTC(dateStr).getUTCDay();
  const start = addDays(dateStr, -((dow + 6) % 7));
  return { start, end: addDays(start, 6) };
}
function monthlyPeriod(dateStr: string) {
  const d = toUTC(dateStr);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const mm = String(m + 1).padStart(2, "0");
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${last}` };
}

// ---- user helpers ---------------------------------------------------------
type Role = "employee" | "reviewer" | "finance" | "account_manager" | "admin";

async function listAllUsers(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let page = 1;
  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    for (const u of data.users) if (u.email) map.set(u.email.toLowerCase(), u.id);
    if (data.users.length < 1000) break;
    page++;
  }
  return map;
}

async function ensureUser(
  existing: Map<string, string>,
  email: string,
  fullName: string,
  role: Role
): Promise<string> {
  let id = existing.get(email.toLowerCase());
  if (!id) {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user) throw error ?? new Error(`createUser ${email}`);
    id = data.user.id;
    existing.set(email.toLowerCase(), id);
  }
  // Ensure profile matches (trigger creates it; we enforce exact fields).
  await db
    .from("profiles")
    .update({ full_name: fullName, role, status: "active", email })
    .eq("id", id);
  return id;
}

async function ensureClient(input: {
  name: string;
  billing_period: string;
  account_manager_id: string;
  contact_email: string;
}): Promise<string> {
  const { data: found } = await db
    .from("clients")
    .select("id")
    .eq("name", input.name)
    .maybeSingle();
  if (found) return found.id;
  const { data, error } = await db
    .from("clients")
    .insert({
      name: input.name,
      billing_period: input.billing_period,
      account_manager_id: input.account_manager_id,
      contact_name: "AP Department",
      contact_email: input.contact_email,
      billing_address: "100 Market St\nSuite 200\nNew York, NY 10001",
      status: "active",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function ensureAssignment(input: {
  employee_id: string;
  client_id: string;
  title: string;
  bill_rate: number;
  pay_rate: number;
  billing_period: string;
  start_date: string;
}): Promise<string> {
  const { data: found } = await db
    .from("assignments")
    .select("id")
    .eq("employee_id", input.employee_id)
    .eq("client_id", input.client_id)
    .maybeSingle();
  if (found) {
    await ensureInitialRate(found.id);
    return found.id;
  }
  const { data, error } = await db
    .from("assignments")
    .insert({
      employee_id: input.employee_id,
      client_id: input.client_id,
      title: input.title,
      bill_rate: input.bill_rate,
      pay_rate: input.pay_rate,
      currency: "USD",
      employment_type: "W2",
      overtime_multiplier: 1.5,
      billing_period: input.billing_period,
      start_date: input.start_date,
      status: "active",
    })
    .select("id")
    .single();
  if (error) throw error;
  await ensureInitialRate(data.id);
  return data.id;
}

// Timesheets are priced from assignment_rates, so an assignment without a row
// there would price every saved timesheet at $0. Copies the assignment's rate.
async function ensureInitialRate(assignmentId: string): Promise<void> {
  const { count, error: countError } = await db
    .from("assignment_rates")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);
  if (countError) throw countError;
  if (count) return;

  const { data: assignment, error: readError } = await db
    .from("assignments")
    .select("bill_rate, pay_rate, overtime_multiplier, start_date")
    .eq("id", assignmentId)
    .single();
  if (readError) throw readError;

  const { error } = await db.from("assignment_rates").insert({
    assignment_id: assignmentId,
    bill_rate: assignment.bill_rate,
    pay_rate: assignment.pay_rate,
    overtime_multiplier: assignment.overtime_multiplier,
    effective_from: assignment.start_date,
  });
  if (error) throw error;
}

async function ensureTimesheet(input: {
  assignment_id: string;
  employee_id: string;
  period: { start: string; end: string };
  status: "draft" | "submitted";
  billRate: number;
  payRate: number;
}): Promise<void> {
  const { data: found } = await db
    .from("timesheets")
    .select("id")
    .eq("assignment_id", input.assignment_id)
    .eq("period_start", input.period.start)
    .maybeSingle();
  if (found) return;

  // 8h regular Mon–Fri (the first five days of the weekly period).
  const days = [0, 1, 2, 3, 4].map((i) => addDays(input.period.start, i));
  const regularHours = 40;
  const totals = {
    total_regular_hours: regularHours,
    total_ot_hours: 0,
    bill_amount: regularHours * input.billRate,
    pay_amount: regularHours * input.payRate,
  };

  const { data: ts, error } = await db
    .from("timesheets")
    .insert({
      assignment_id: input.assignment_id,
      employee_id: input.employee_id,
      period_start: input.period.start,
      period_end: input.period.end,
      status: input.status,
      submitted_at: input.status === "submitted" ? new Date().toISOString() : null,
      ...(input.status === "submitted" ? totals : {}),
    })
    .select("id")
    .single();
  if (error) throw error;

  if (input.status === "submitted") {
    await db.from("timesheet_entries").insert(
      days.map((d) => ({
        timesheet_id: ts.id,
        work_date: d,
        hours: 8,
        entry_type: "regular",
      }))
    );
  }
}

async function main() {
  console.log("Seeding ClearSheet…");
  const existing = await listAllUsers();

  const adminId = await ensureUser(existing, "admin@test.com", "Avery Admin", "admin");
  const reviewerId = await ensureUser(existing, "reviewer@test.com", "Riley Reviewer", "reviewer");
  const financeId = await ensureUser(existing, "finance@test.com", "Quinn Finance", "finance");
  const amId = await ensureUser(existing, "am@test.com", "Morgan Manager", "account_manager");
  const employeeId = await ensureUser(existing, "employee@test.com", "Sam Employee", "employee");
  void adminId;
  void reviewerId;
  void financeId;
  console.log("Role users ready.");

  const bulkIds: string[] = [];
  for (let i = 1; i <= EMPLOYEE_COUNT; i++) {
    const id = await ensureUser(
      existing,
      `employee${i}@test.com`,
      `Employee ${i}`,
      "employee"
    );
    bulkIds.push(id);
  }
  console.log(`${EMPLOYEE_COUNT} bulk employees ready.`);

  const today = todayInTz(TZ);
  const week = weeklyPeriod(today);
  const month = monthlyPeriod(today);

  const clientA = await ensureClient({
    name: "Acme Corp",
    billing_period: "weekly",
    account_manager_id: amId,
    contact_email: "ap@acme.test",
  });
  const clientB = await ensureClient({
    name: "Globex LLC",
    billing_period: "monthly",
    account_manager_id: amId,
    contact_email: "billing@globex.test",
  });
  console.log("Clients ready.");

  // Main employee: weekly (90/60) on Acme, monthly (110/75) on Globex.
  const empAsgA = await ensureAssignment({
    employee_id: employeeId,
    client_id: clientA,
    title: "Software Engineer",
    bill_rate: 90,
    pay_rate: 60,
    billing_period: "weekly",
    start_date: addDays(week.start, -56),
  });
  await ensureAssignment({
    employee_id: employeeId,
    client_id: clientB,
    title: "Consultant",
    bill_rate: 110,
    pay_rate: 75,
    billing_period: "monthly",
    start_date: month.start,
  });

  // Bulk employees → Acme weekly so dashboards/queues have volume.
  const bulkAssignments: string[] = [];
  for (const id of bulkIds) {
    const a = await ensureAssignment({
      employee_id: id,
      client_id: clientA,
      title: "Software Engineer",
      bill_rate: 90,
      pay_rate: 60,
      billing_period: "weekly",
      start_date: addDays(week.start, -56),
    });
    bulkAssignments.push(a);
  }
  console.log("Assignments ready.");

  // Main employee's current-week draft (empty — tester fills it in).
  await ensureTimesheet({
    assignment_id: empAsgA,
    employee_id: employeeId,
    period: week,
    status: "draft",
    billRate: 90,
    payRate: 60,
  });

  // A handful of submitted timesheets to populate the reviewer queue.
  const submitCount = Math.min(6, bulkAssignments.length);
  for (let i = 0; i < submitCount; i++) {
    await ensureTimesheet({
      assignment_id: bulkAssignments[i],
      employee_id: bulkIds[i],
      period: week,
      status: "submitted",
      billRate: 90,
      payRate: 60,
    });
  }
  console.log(`Seeded 1 draft + ${submitCount} submitted timesheets.`);

  console.log("\nDone. Log in with admin@test.com / Test1234!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
