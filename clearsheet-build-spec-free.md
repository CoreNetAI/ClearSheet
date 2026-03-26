# ClearSheet — Production Build Specification (Free-Tier Edition)

**Product name:** ClearSheet
**Version:** 3.0 (production, free-tier only)
**Audience:** AI coding agent (and the human operating it)
**Goal:** Build a production-ready application end to end that runs entirely on **free, commercial-use-permitted** infrastructure. The only outstanding work is supplying credentials and pointing redirect/webhook URLs (Appendix D). No mock logic.

---

## 0. Instructions for the AI builder (read first)

- Build the **entire system** as a production-grade, deployable web application — not a prototype. No dummy/mock logic; all integrations implemented against real SDKs/APIs and functional in the providers' test/sandbox modes.
- **Every piece of infrastructure must be a free tier that permits commercial use.** Use only the tools in Section 3. Do not introduce any tool requiring a paid subscription. (Two features — Stripe payments and QuickBooks — have inherent costs explained in Appendix E; both are optional and the app must run fully without them.)
- The app must **run without seed data**; seed data (Section 13) only speeds testing.
- The **only** remaining work after the build is **Appendix D — Configuration checklist**. Everything else is code-complete.
- **Write runtime-agnostic code**: standard Web/Node APIs, `fetch`-based calls to Stripe/QuickBooks, and a **pure-JavaScript PDF library** (e.g. `@react-pdf/renderer` or `pdf-lib`). **Do NOT use Puppeteer / headless Chrome** — it isn't available on the free hosting tiers. This keeps the app deployable to both Cloudflare and Render.
- Implement the free-tier mitigations in Section 3.1 (backups + keep-alive).
- Deliverables: runnable repo, DB migrations + RLS, seed script, `.env.example`, `README.md` (= Appendix A), `DECISIONS.md`, `INTEGRATIONS.md`, and the GitHub Actions workflows for backup + keep-alive.

---

## 1. Product overview

ClearSheet is the internal operations app for a staffing / consulting firm (an LLC) of ~85–100 people. Employees work for external client companies, log their hours, and upload the client-approved timesheet as proof (clients approve **outside** ClearSheet; they do not log in). An internal reviewer verifies each submission. Verified hours drive **client invoices** and a **payroll export**. Optionally, invoices can be emailed, paid online, and synced to QuickBooks.

**Money model:** each *assignment* carries a `bill_rate` (charged to client) and `pay_rate` (paid to employee); the difference is the firm's margin.

---

## 2. Goals and success criteria

1. Production-ready: real auth, real integrations, secure by default.
2. Employees submit hours + a mandatory approved-timesheet upload in under 2 minutes, desktop or phone.
3. Reviewer sees all submissions in one **realtime** queue and approves/rejects quickly.
4. Finance generates invoices and a payroll export from verified timesheets with no manual hour-copying.
5. (Optional) invoices can be emailed, paid online via Stripe, and pushed to QuickBooks Online.
6. SSO login via the firm's Google / Microsoft accounts.
7. **Runs entirely on free tiers that permit commercial use**, with free backups and keep-alive so reliability is acceptable for an internal app.

---

## 3. Tech stack (mandatory — all free, commercial-use permitted)

| Layer | Choice | Free-tier note |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | Open-source. |
| Styling / UI | **Tailwind CSS + shadcn/ui** | Open-source; mobile-first. |
| Hosting (preferred) | **Cloudflare Workers/Pages** | Free, commercial-use OK, always-on, unlimited bandwidth, 100k req/day. No headless Chrome (use JS PDF lib). |
| Hosting (fallback) | **Render free web service** | Free, commercial OK, full Node runtime; spins down after 15 min (30–60s cold start). Do **not** use Render's DB (it expires in 30 days). |
| Database + Auth + Realtime | **Supabase free** | Commercial use allowed; includes Postgres, Auth, Realtime. 500 MB DB, 50k MAU. |
| SSO / Auth methods | **Supabase Auth**: email/password + **Google OAuth** + **Microsoft (Entra) OAuth** | All free on Supabase free tier. (SAML is Pro-only → out of scope; OAuth work-account login is the SSO.) |
| Authorization | **Postgres Row Level Security (RLS)** | Per-role access at the DB. |
| File storage | **Cloudflare R2** (S3-compatible) | Free 10 GB, no egress fees, commercial OK. Used for timesheet uploads; access via presigned URLs. |
| Email (optional feature) | **Resend free** (3,000/mo) — or **Brevo** (300/day) | Transactional invoice emails. |
| Payments (optional feature) | **Stripe** (hosted Checkout / Payment Links + webhooks) | No subscription; per-transaction fee applies (Appendix E). |
| Accounting (optional feature) | **QuickBooks Online API** (OAuth 2.0) | Free to integrate; requires the firm's existing QBO subscription (Appendix E). |
| PDF generation | **`@react-pdf/renderer`** or **`pdf-lib`** (pure JS) | Works on free hosting; no Puppeteer. |
| Cron / backups / keep-alive | **GitHub Actions** (free) or **Cloudflare Cron Triggers** (free) | See 3.1. |

### 3.1 Operating on free tiers — required mitigations (build these)

1. **Automated backups (free).** Add a GitHub Actions workflow that runs nightly: `pg_dump` the Supabase database and upload the dump to Cloudflare R2 (separate bucket). Keep the last 14 dumps. This replaces the paid backups the free tier lacks. Document restore steps in `INTEGRATIONS.md`.
2. **Keep-alive (free).** Add a GitHub Actions workflow that runs daily and makes one lightweight authenticated query against Supabase, so the project never hits the ~7-day inactivity auto-pause. (Normal weekly timesheet activity also helps, but the daily ping guarantees it.)
3. **Capacity guards.** Stay within 500 MB DB / 10 GB R2: store only file metadata in Postgres (files live in R2), and add an admin "storage usage" readout. Compress nothing destructively, but reject uploads over 10 MB.
4. **No secrets in the client.** Service keys and R2/Stripe/QBO secrets are server-only.

---

## 4. User roles and permissions

| Role | Purpose |
|---|---|
| `employee` | Records/submits own timesheets; uploads proof. (~85 users) |
| `reviewer` | Internal approval gate; approves/rejects submissions. |
| `finance` | Generates invoices, (optional) emails them, manages payments, exports payroll, owns the QuickBooks connection. |
| `account_manager` | Owns client relationships; monitors their clients' submissions. |
| `admin` | Full access; manages users, clients, assignments, integration settings, storage readout. |

### Permission matrix

| Capability | employee | reviewer | finance | account_manager | admin |
|---|:--:|:--:|:--:|:--:|:--:|
| Create/edit/submit own timesheet | ✅ | — | — | — | ✅ |
| View own timesheets | ✅ | ✅ | ✅ | own clients | ✅ |
| View all submitted timesheets | — | ✅ | ✅ (verified) | own clients | ✅ |
| Approve/reject/edit timesheet | — | ✅ | — | — | ✅ |
| Generate / email invoices | — | — | ✅ | — | ✅ |
| Manage payments | — | — | ✅ | — | ✅ |
| Export payroll | — | — | ✅ | — | ✅ |
| Connect/manage QuickBooks | — | — | ✅ | — | ✅ |
| Manage users / clients / assignments | — | — | — | view | ✅ |
| Manage integration settings | — | — | partial | — | ✅ |

---

## 5. Glossary

- **Assignment** — links one employee to one client; carries `bill_rate`, `pay_rate`, billing period, dates. One employee may have multiple active assignments.
- **Bill rate / Pay rate** — charged to client / paid to employee, per hour.
- **Billing period** — weekly, biweekly, semimonthly, or monthly.
- **Timesheet** — one employee's hours for one assignment for one period, with status + attachments.
- **Verification** — the reviewer's internal approval (replaces the client logging in).

---

## 6. Data model

Use these exact names. All tables have `created_at timestamptz default now()`; edited tables have `updated_at`. PKs are `uuid default gen_random_uuid()` unless noted.

### `profiles`
PK `id uuid` = `auth.users.id`. `full_name text`, `email text`, `role text` (employee|reviewer|finance|account_manager|admin), `status text` (active|inactive, default active), `auth_provider text` (email|google|microsoft).

### `clients`
`id`, `name text` (req), `contact_name text`, `contact_email text`, `billing_period text`, `account_manager_id uuid FK profiles`, `billing_address text`, `quickbooks_customer_id text` (nullable), `status text`.

### `assignments`
`id`, `employee_id uuid FK profiles` (req), `client_id uuid FK clients` (req), `title text`, `bill_rate numeric(10,2)`, `pay_rate numeric(10,2)`, `currency text` default 'USD', `employment_type text` (W2|1099), `overtime_multiplier numeric(4,2)` default 1.5, `billing_period text`, `start_date date` (req), `end_date date` (null), `status text` (active|ended).

### `timesheets`
`id`, `assignment_id uuid FK`, `employee_id uuid FK`, `period_start date`, `period_end date`, `status text` (Section 7), `total_regular_hours numeric(8,2)`, `total_ot_hours numeric(8,2)`, `bill_amount numeric(12,2)`, `pay_amount numeric(12,2)`, `submitted_at timestamptz`, `reviewed_by uuid FK profiles`, `reviewed_at timestamptz`, `review_note text`. **Unique (assignment_id, period_start).**

### `timesheet_entries`
`id`, `timesheet_id uuid FK` (cascade), `work_date date`, `hours numeric(5,2)`, `entry_type text` (regular|overtime|holiday|pto, default regular), `note text`.

### `timesheet_attachments`
`id`, `timesheet_id uuid FK` (cascade), `r2_object_key text` (object key in the Cloudflare R2 bucket), `file_name text`, `attachment_type text` (approved_timesheet [required] | approval_screenshot [optional]), `uploaded_at timestamptz`.

### `invoices`
`id`, `client_id uuid FK`, `invoice_number text` (unique, `INV-{year}-{seq}`), `period_start date`, `period_end date`, `status text` (draft|sent|paid|void), `subtotal numeric(12,2)`, `total numeric(12,2)`, `issued_date date`, `due_date date` (default issued+30), `sent_at timestamptz`, `paid_at timestamptz`, `stripe_payment_link text`, `stripe_payment_intent_id text`, `quickbooks_invoice_id text`, `created_by uuid FK profiles`.

### `invoice_line_items`
`id`, `invoice_id uuid FK` (cascade), `timesheet_id uuid FK`, `employee_name text` (snapshot), `assignment_title text` (snapshot), `hours numeric(8,2)`, `bill_rate numeric(10,2)` (snapshot), `amount numeric(12,2)`.

### `integration_connections`
`id`, `provider text` (quickbooks), `access_token text` (encrypted), `refresh_token text` (encrypted), `realm_id text`, `expires_at timestamptz`, `connected_by uuid FK profiles`, `status text`.

### `payments`
`id`, `invoice_id uuid FK`, `provider text` (stripe), `provider_payment_id text`, `amount numeric(12,2)`, `status text` (pending|succeeded|failed|refunded), `raw jsonb`, `created_at`.

### `audit_log`
`id`, `actor_id uuid FK profiles`, `entity_type text`, `entity_id uuid`, `action text`, `detail jsonb`, `created_at`.

**Relationships:** client → many assignments; employee → many assignments; assignment → many timesheets; timesheet → many entries/attachments; invoice → many line items (each → one timesheet); invoice → many payments.

---

## 7. Timesheet lifecycle (state machine)

```
draft ─submit→ submitted ─approve→ approved ─add to invoice→ invoiced ─invoice paid→ paid
  ▲                │
  └──── reject ◀────┘   (back to draft + review_note)
```

- Cannot submit without ≥1 entry **and** ≥1 `approved_timesheet` attachment.
- Only reviewer/admin move submitted→approved or submitted→draft(reject).
- Reviewer may edit hours on a submitted timesheet before approving (requires note; writes audit_log).
- Only `approved` timesheets are eligible for invoicing/payroll.
- Adding to an invoice → `invoiced`. Invoice paid (Stripe webhook or manual) → its timesheets → `paid`.
- Every transition writes `audit_log`.

---

## 8. Functional requirements by role

### Employee
- Dashboard: current open period per active assignment + status.
- Timesheet editor: per-day hours grid, mark entry_type (regular/OT/holiday/PTO), running totals.
- Upload **required** approved timesheet (PDF/PNG/JPG/XLSX, ≤10 MB) + **optional** screenshot — stored in R2 via a server-generated presigned upload URL.
- Save draft / submit (read-only after submit). See reject notes; edit and resubmit.
- History of own timesheets.

### Reviewer
- **Realtime** review queue of all `submitted` timesheets (oldest first) with a live pending badge.
- Detail view: entered hours next to the uploaded attachment (preview via short-lived R2 presigned URL).
- Approve, reject-with-note, or edit-with-note then approve.

### Finance
- List `approved` timesheets grouped by client + period.
- **Generate invoice**: pick client + period → invoice with one line item per approved timesheet, compute amounts, sequential number, set timesheets `invoiced`.
- **(Optional) Email invoice**: mark `sent` → render PDF (JS lib) and email to the client's `contact_email` via Resend/Brevo, with a Stripe pay link if payments are enabled. Track `sent_at`; allow resend.
- **(Optional) Online payment**: invoice exposes a Stripe Payment Link/Checkout; on webhook success, create `payments` row, set invoice `paid`, cascade timesheets to `paid` (idempotent on event id).
- **(Optional) QuickBooks sync**: connect QBO via OAuth (encrypted tokens); upsert client as QBO customer, create QBO invoice, reflect payment status; handle token refresh.
- **Payroll export**: pick a period → CSV (employee_name, employment_type, client, regular_hours, ot_hours, pay_rate, gross_pay) for approved/invoiced timesheets.
- Invoice list; mark paid/void manually when needed.

### Account manager
- Their clients, employees on them, and current-period submission status (realtime).

### Admin
- CRUD users, clients, assignments.
- **Integration settings**: connection status for Stripe, email, QuickBooks; connect/disconnect QBO; test-email button. Each optional integration cleanly **disabled** if its credentials are absent.
- **Submission status dashboard** for the current period across all employees (realtime).
- **Storage usage** readout (DB + R2).

---

## 9. Business rules and calculations

- Regular hours = sum(regular, holiday, pto); OT hours = sum(overtime).
- Default: holiday/PTO paid but not billed (record in DECISIONS.md).
- `bill_amount` = billable_regular_hours×bill_rate + ot_hours×bill_rate×overtime_multiplier.
- `pay_amount` = regular_hours×pay_rate + ot_hours×pay_rate×overtime_multiplier + holiday/pto_hours×pay_rate.
- Amounts recompute on entry change; persisted at submit.
- Period generation by billing_period (weekly Mon–Sun; biweekly anchored to assignment start; semimonthly 1–15 / 16–end; monthly = calendar month).
- Two assignments → two separate timesheets per period.
- Invoice numbers sequential per year. Money rounded to 2 decimals.

---

## 10. Screens / UI

Auth (email + "Sign in with Google" + "Sign in with Microsoft"; password reset) → role-aware home. Employee dashboard, editor, history. Reviewer queue + detail. Finance: approved list, invoice generator, invoice list, invoice view/PDF, optional email/pay actions, payroll export, QuickBooks connect. Account-manager overview. Admin: users/clients/assignments, integration settings, submission dashboard, storage readout. Global role-aware nav, current-period indicator, sign out. Fully responsive.

---

## 11. Non-functional / security requirements

- Server-side role checks on every page and API route.
- RLS on all tables with policies matching Section 4; ship in migrations.
- Files in a **private R2 bucket**; access only via short-lived presigned URLs after an auth check.
- Secrets server-only; OAuth tokens encrypted at rest (`TOKEN_ENCRYPTION_KEY`).
- Webhooks (Stripe, QBO) verify signatures; payment handling idempotent by event id.
- Stripe uses hosted Checkout/Payment Links (PCI SAQ-A).
- Input validation server-side (hours 0–24/day, rates ≥0, file type/size, required fields).
- Audit log on every status transition, reviewer edit, payment, integration action.
- Timestamps `timestamptz`; work dates `date`; periods in firm's timezone (default America/New_York, configurable).
- Friendly errors; structured logging; no stack traces to users.
- Accessibility: labeled inputs, keyboard nav, contrast. Rate-limit auth and webhook endpoints.

---

## 12. Out of scope for v1 (future phases)

- **SAML / enterprise SSO** (requires a paid Supabase tier — out for the free build; Google/Microsoft OAuth covers SSO).
- Client/external approver login (approval stays outside the app; proof is uploaded).
- Expense reimbursement.
- Direct payroll-provider integration (ADP/Gusto) — payroll stays as CSV export.
- Multi-currency conversion (single currency per assignment).
- Native mobile apps (responsive web only).
- Full HR/PTO accrual tracking and advanced BI dashboards.

---

## 13. Seed / test data (testing only — app must run without it)

5 users, one per role (`employee@test.com`, `reviewer@test.com`, `finance@test.com`, `am@test.com`, `admin@test.com`, password `Test1234!`). 2 clients (one weekly, one monthly). 3 assignments (employee on client A: bill 90 / pay 60 weekly; on client B: bill 110 / pay 75 monthly). 1 draft timesheet for the current period.

---

## 14. Acceptance criteria (done when all pass, in sandbox/test mode)

1. Each role logs in (email/password) and lands on the correct home.
2. "Sign in with Google" and "Sign in with Microsoft" complete OAuth and attach a profile.
3. Employee enters hours, uploads a required PDF (stored in R2), submits; submit blocked without the upload.
4. Submitted timesheet appears in the reviewer queue **in realtime** with correct totals.
5. Reviewer previews the R2 file and approves; reject-with-note returns it to the employee.
6. Finance generates an invoice with correct line items/totals (incl. OT×multiplier); timesheets become `invoiced`; number sequential.
7. (If enabled) emailing the invoice delivers a PDF to a test inbox; paying with Stripe **test card 4242 4242 4242 4242** marks the invoice `paid` and cascades timesheets to `paid`.
8. (If enabled) QuickBooks **sandbox** connects and an invoice appears in the sandbox company with stored ids.
9. Payroll CSV downloads with correct gross_pay.
10. Admin creates a user/client/assignment; realtime submission dashboard and storage readout work.
11. RLS verified: an employee cannot load another employee's timesheet by id.
12. The backup GitHub Action produces a dump in R2; the keep-alive Action runs successfully.
13. Usable on a phone-sized viewport.

---

## 15. Deliverables

Working Next.js repo; `supabase/migrations/` (schema + RLS); R2 wiring; seed script; `.env.example`; `README.md` (= Appendix A); `DECISIONS.md`; `INTEGRATIONS.md`; `.github/workflows/` with `backup.yml` and `keepalive.yml`.

---

# Appendix A — Local setup guide

**Prereqs:** Node.js LTS, Git, free accounts: Supabase, Cloudflare (for R2 + hosting). Optional: Resend, Stripe, QuickBooks developer, plus a GitHub repo for the cron jobs.

1. Create a Supabase project; note Project URL, `anon` key, `service_role` key.
2. Create a Cloudflare R2 bucket (uploads) and a second bucket (backups); create an R2 API token (access key + secret).
3. Clone the repo; `npm install`.
4. Copy `.env.example` → `.env.local`; fill values per **Appendix D**.
5. Apply migrations (`npx supabase db push` or paste SQL in the SQL editor) — tables + RLS.
6. `npm run seed` (test data).
7. `npm run dev` → `http://localhost:3000`; log in as `admin@test.com` / `Test1234!`.
8. Optional integrations use **test/sandbox** credentials (Stripe test mode, QBO sandbox, Resend test domain).

---

# Appendix B — Testing guide and scenarios

Run in order.

1. **Employee submits** — enter 8h × 5 weekdays on client A; upload a PDF; confirm submit blocked without the file, then submit. Expect 40 regular hours, bill 3,600, pay 2,400.
2. **Reviewer (realtime)** — watch the item appear without refresh; open it, preview the R2 file, approve.
3. **Reject** — submit a second timesheet, reject with a note, confirm it returns editable with the note.
4. **Invoice** — as finance, generate an invoice for client A; line item 3,600, sequential number; timesheet → invoiced.
5. **(Optional) Email + pay** — mark sent; confirm a test inbox gets the PDF; pay with Stripe test card `4242 4242 4242 4242`; confirm webhook marks invoice + timesheets `paid`.
6. **(Optional) QuickBooks** — connect QBO sandbox; sync the invoice; confirm it appears in the sandbox company.
7. **Payroll** — export CSV; confirm 40 regular hours, gross_pay 2,400.
8. **SSO** — test Google and Microsoft sign-in.
9. **Admin** — create a client + assignment; check realtime dashboard + storage readout.
10. **Backups/keep-alive** — trigger the two GitHub Actions manually; confirm a dump lands in the R2 backup bucket.
11. **Security** — as employee, try to open another employee's timesheet by id → denied (RLS).
12. **Mobile** — run the employee flow at phone width.

---

# Appendix C — Deployment guide (free only)

1. Push to GitHub.
2. Deploy on **Cloudflare Workers/Pages** (preferred — always-on) using the Next.js adapter; or **Render free web service** (fallback — full Node, accepts cold starts). Both permit commercial use. **Not Vercel Hobby.**
3. Set all env vars (Appendix D) in the host.
4. In Supabase Auth, add the production domain to allowed redirect URLs; configure Google + Microsoft OAuth with production redirect URIs.
5. (If using payments) Stripe: live keys + production webhook endpoint + signing secret.
6. (If using QuickBooks) move from sandbox to a production app; set production redirect URI; reconnect.
7. (If using email) verify the sending domain (SPF/DKIM) with Resend/Brevo.
8. Enable the **backup** and **keep-alive** GitHub Actions (add repo secrets for Supabase + R2). Confirm both run.
9. Smoke-test Appendix B scenarios 1–4, 7, 9 in production.

---

# Appendix D — Configuration checklist (the ONLY work left to the human)

**Core (always required)**
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `TOKEN_ENCRYPTION_KEY` (encrypts stored OAuth tokens)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_UPLOADS_BUCKET`, `R2_BACKUPS_BUCKET`
- `APP_BASE_URL`, `DEFAULT_TIMEZONE`, firm name/address/logo for invoices

**SSO / OAuth (required for SSO logins)**
- Google OAuth client ID + secret + redirect URI(s)
- Microsoft (Entra) OAuth client ID + secret + tenant + redirect URI(s)

**Backups / keep-alive (GitHub Actions secrets)**
- Supabase DB connection string + R2 backup credentials

**Email (only if enabling invoice emailing)**
- `RESEND_API_KEY` (or Brevo key); verified sending domain; `FROM_EMAIL`

**Payments (only if enabling online payments — see Appendix E)**
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`

**Accounting (only if the firm already uses QuickBooks — see Appendix E)**
- `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT`

---

# Appendix E — Honest cost note

**Infrastructure cost: $0.** Hosting (Cloudflare/Render), database + auth + realtime (Supabase), file storage (R2), email (Resend/Brevo), backups + keep-alive (GitHub Actions) all run on free tiers that permit commercial use and do not expire. The core product (timesheets → verification → invoices → payroll CSV) is fully functional at zero cost.

**Two optional features have unavoidable costs — not from our tool choices, but from the nature of the feature:**
- **Online card payments (Stripe):** no subscription, but ~2.9% + 30¢ per successful charge. No provider offers free card processing. If you don't enable payments, the app stays free; clients can still pay by your existing offline methods.
- **QuickBooks sync:** the API is free, but it only works if the firm already pays for QuickBooks Online. We add no new subscription. If the firm doesn't use QuickBooks, leave this disabled.

**Free-tier trade-offs you're accepting** (acceptable for an internal app, mitigated in Section 3.1): 500 MB Postgres and 10 GB file storage caps, no vendor SLA, self-managed backups, and possible cold starts (Render) or edge-runtime limits (Cloudflare). Re-verify each provider's free-tier terms periodically, as they change.

---

*End of specification.*
