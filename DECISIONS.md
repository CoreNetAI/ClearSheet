# Decisions

Key implementation decisions and the reasoning behind them.

## Platform / stack

- **Next.js 15 + React 19.** The Cloudflare adapter (`@opennextjs/cloudflare`)
  requires Next ≥ 15.5.18; the whole stack (Supabase SSR, Radix, lucide,
  pdf‑lib) supports React 19, so we use the current stable line rather than
  pinning to an older Next.
- **`pdf-lib` for invoice PDFs (not `@react-pdf/renderer`).** Both are pure JS,
  but `pdf-lib` is the lighter, edge‑friendly choice for the Cloudflare Workers
  runtime. No Puppeteer / headless Chrome anywhere (per spec).
- **Supabase clients via `@supabase/ssr`.** Cookie‑based sessions; a request
  scoped server client (RLS as the user), a browser client, and a service‑role
  client used **only** in trusted server code (webhooks, presign, seeding, admin
  user creation).
- **Authorization in two layers.** Server‑side `requireRole()` guards on every
  page/route **and** Postgres RLS on every table. The service‑role key bypasses
  RLS and is never shipped to the client.

## Data / business rules (spec §9)

- **Hour buckets:** `total_regular_hours = regular + holiday + pto`;
  `total_ot_hours = overtime`.
- **Holiday/PTO are paid but not billed** (default). So:
  - `bill_amount = regular×bill_rate + overtime×bill_rate×overtime_multiplier`
  - `pay_amount  = (regular+holiday+pto)×pay_rate + overtime×pay_rate×overtime_multiplier`
- **Invoice line‑item `hours`** is the billable hours (regular + overtime). The
  authoritative figure is `amount` (= the timesheet's `bill_amount`), which
  already includes the OT multiplier, so `hours × bill_rate` may not equal
  `amount` when overtime is present — this is intentional.
- **Invoice numbers** are sequential per calendar year (`INV-{year}-{seq}`),
  allocated by a concurrency‑safe `SECURITY DEFINER` function backed by an
  `invoice_counters` table.
- **Money** is `numeric` in the DB and rounded to 2 decimals in calculations.
- **Periods** are computed timezone‑safely from `yyyy-MM-dd` strings using UTC
  date math; only "today" is resolved in the firm timezone (`DEFAULT_TIMEZONE`,
  default `America/New_York`). Weekly = Mon–Sun; biweekly anchored to the
  assignment start; semimonthly = 1–15 / 16–end; monthly = calendar month.

## Lifecycle

- `draft → submitted → approved → invoiced → paid`; reject returns a submission
  to `draft` with a `review_note`. Voiding an invoice returns its `invoiced`
  timesheets to `approved` so they can be re‑invoiced.
- **Submit is blocked** without ≥1 entry with hours **and** ≥1
  `approved_timesheet` attachment (enforced server‑side).
- Every transition writes `audit_log`.

## Files

- Uploads go straight to a **private R2 bucket** via short‑lived presigned PUT
  URLs; only metadata lives in Postgres. Downloads/previews use short‑lived
  presigned GET URLs behind an auth + RLS check. Max upload 10 MB; allowed types
  PDF/PNG/JPG/XLSX.

## Optional integrations

- Each optional feature (email, Stripe, QuickBooks) is **auto‑disabled** when its
  credentials are absent — detected in `src/lib/config.ts` and reflected in the
  Admin → Integrations UI. The core product (timesheets → verification →
  invoices → payroll CSV) runs fully without any of them.
- **OAuth tokens** (QuickBooks) are encrypted at rest with AES‑256‑GCM using
  `TOKEN_ENCRYPTION_KEY`.
- **Stripe** uses hosted Checkout (PCI SAQ‑A); the webhook verifies signatures
  and is idempotent via a unique index on `payments(provider, provider_payment_id)`.

## Realtime

- The reviewer queue subscribes directly to `timesheets` changes and re‑queries.
  Dashboards (admin, account‑manager) use a small `RealtimeRefresher` that calls
  `router.refresh()` on change, keeping all period/status logic on the server.
