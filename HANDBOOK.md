# ClearSheet — Application Handbook

## 1. What ClearSheet is (capabilities at a glance)

A self-hosted, free-tier operations app for staffing/consulting firms. One internal team uses it; their employees, reviewers, finance, and account managers each get a dashboard tuned to what they do.

**Core capabilities (always on, no extra config):**
- Per-employee timesheet entry with four hour buckets (Regular, Overtime, Holiday, PTO)
- Helpers: fill Mon–Fri at one click, import hours from Excel/CSV with a preview/confirm
- Client-approved file upload (PDF/PNG/JPG/XLSX, ≤10 MB), stored privately in Cloudflare R2
- Live (Realtime) reviewer queue and admin dashboard — no refresh needed
- Reviewer approve / reject-with-note / edit-and-approve
- Audit log on every status transition (who, when, what)
- Automatic invoice generation grouped by client + period, with sequential `INV-YYYY-NNNN` numbering
- PDF invoices generated on the fly (no Puppeteer)
- Payroll CSV export for any date range
- Five separate role dashboards with per-role permissions enforced at the database level (not just hidden in the UI)
- Multi-billing-period support per assignment (weekly / biweekly / semimonthly / monthly)
- OAuth tokens (QuickBooks) encrypted with AES-256-GCM at rest

**Optional capabilities (auto-disabled until you provide credentials):**
- Google + Microsoft single sign-on
- Invoice emailing via Resend
- Online card payment via Stripe (hosted checkout + webhook)
- QuickBooks Online sync (customer + invoice push) — sandbox or production

**What runs the app:** Next.js 15 on Cloudflare Workers, Supabase (Postgres + Auth + Realtime), Cloudflare R2 for files, GitHub Actions for nightly backups and keep-alive.

---

## 2. How time periods work (clearing up the "do I pick a date range?" question)

**Employees never pick a date range.** The period is driven by the **assignment**, not by the user.

When an admin creates an assignment, they pick a `billing_period`:
- **Weekly** — Monday to Sunday of the week containing today
- **Biweekly** — a 14-day window anchored to the assignment's `start_date`
- **Semimonthly** — 1st–15th and 16th–end of month
- **Monthly** — the calendar month containing today

ClearSheet computes "the current period for this assignment" from today's date + the assignment. When the employee logs in, they see exactly that period's draft, ready to fill.

Past periods are visible in **My Timesheets** as a list, but only drafts can be edited; submitted/approved ones are read-only.

There is **no "create timesheet for any range I want"** button — by design, to prevent gaps, duplicates, or back-dating.

---

## 3. Roles — what each one can actually do

| Capability | Employee | Reviewer | Finance | Account Mgr | Admin |
|---|---|---|---|---|---|
| Fill / submit own timesheet | ✅ | — | — | — | ✅ |
| See others' timesheets | — | ✅ submitted+ | ✅ approved+ | own clients only | ✅ |
| Approve / reject timesheets | — | ✅ | — | — | ✅ |
| Generate invoices, PDFs, payroll CSV | — | — | ✅ | — | ✅ |
| Sync invoice to QuickBooks | — | — | ✅ | — | ✅ |
| Create/edit clients | — | — | — | — | ✅ |
| Create/edit users | — | — | — | — | ✅ |
| Create/edit assignments | — | — | — | — | ✅ |
| Manage integrations & storage | — | — | — | — | ✅ |

### 3.1 Employee
**Login:** any time. The first thing they see is `/employee`.

**Dashboard:**
- A row for each of their **active assignments**, showing the current period's draft.
- Click into the open draft.

**In the editor they can:**
- Type hours per day across **Regular / Overtime / Holiday / PTO** columns (live total per day, live totals across the period).
- Use **Fill weekdays** (enter a number, fills Mon–Fri Regular).
- Use **Import from Excel/CSV** (parses the file, shows a preview of matched days, click Apply).
- **Clear** the grid.
- **Upload the client-approved timesheet** (auto-uploads the moment they pick a file; can preview or delete and re-upload).
- **Save draft** any time.
- **Fill in Challenges/Learnings** — one free-text box per timesheet, saved with the draft and shown to reviewers.
- **Submit for review** — server-side enforced: at least one hour, Challenges/Learnings, AND at least one approved-file attachment, or submission is blocked.
- **My Timesheets** — see every past period with its status; can re-open drafts; can read the reviewer's note if returned.

**What they CANNOT see/do:**
- Other employees' timesheets, hours, rates, invoices, or clients.
- Bill rates (only their own pay rate is implicit in calculations they don't see).
- Create their own client/assignment.
- Submit for a custom date range.

---

### 3.2 Reviewer
**Login:** lands on `/reviewer`.

**Dashboard — Review Queue:**
- All currently `submitted` timesheets, oldest first, across all employees and clients.
- **Live** — new submissions appear without refreshing.

**Open a timesheet → they see:**
- Employee, assignment, client, period.
- The hours grid (read-only by default).
- The attached approved file rendered inline (PDF iframe / image preview).
- Totals: hours, bill amount, pay amount, OT.

**Actions:**
- **Approve** — flips status to `approved`, records who approved + when.
- **Reject with note** — required note; status returns to `draft` so the employee can edit and resubmit. Employee sees the note in the editor.
- **Edit & approve** — open the hours in editable mode, adjust, **must provide a note** explaining the edit; approves in one step. Edits + note recorded in audit log.

**Other tab:**
- **History** — recently reviewed timesheets.

**What they CANNOT do:** anything around clients, users, invoices, or payroll.

---

### 3.3 Finance
**Login:** lands on `/finance`.

**Approved Hours page:**
- All `approved` (not yet invoiced) hours, grouped by **client + period**.
- Each group shows total billable hours and computed total amount.
- Select group(s) → **Generate invoice** — allocates the next `INV-YYYY-NNNN` (concurrency-safe), creates the invoice + line items, flips selected timesheets to `invoiced`.

**Invoices:**
- List of all invoices with status (`draft / sent / paid / void`) and totals.
- Open an invoice → see line items, client, totals, status, and integration buttons.

**On an invoice:**
- **Download PDF** — generated server-side, no external service.
- **Mark sent** — status flips to `sent` (purely informational).
- **Mark paid** — status flips to `paid` and **cascades** all included timesheets to `paid`.
- **Void** — invoice goes to `void` and the timesheets return to `approved` (re-billable).
- **Create payment link** *(optional, needs Stripe configured)* — generates a hosted Stripe Checkout link the client can pay; webhook marks invoice `paid` automatically.
- **Email invoice** *(optional, needs Resend)* — sends the invoice PDF + a payment link to the client's contact email.
- **Sync to QuickBooks** *(optional, needs QBO configured)* — creates the customer if missing, then pushes the invoice into QuickBooks; stores the returned QBO IDs so you can see what's synced.

**QuickBooks page:**
- **Connect** — kicks off Intuit OAuth, stores encrypted tokens + realm ID.
- **Disconnect** — clears tokens; you can reconnect anytime (use this when switching sandbox ↔ production).

**Payroll page:**
- Pick a date range → **Export CSV** — one row per timesheet, with employee, client, regular hours, OT hours, pay rate, gross pay (OT and PTO already baked in). Hand to your payroll provider.

**What Finance CANNOT do:** create users / clients / assignments. They consume the pipeline; admin sets it up.

---

### 3.4 Account Manager
**Login:** `/account-manager`.

**Overview:**
- Only the **clients assigned to them** (where `clients.account_manager_id = self`).
- For each: current-period status of their assignments — which employees submitted, which are still missing, which are approved.
- **Live** — updates as employees submit and reviewers approve.

**What they can do:** view. That's it — they're a stakeholder, not an operator.

---

### 3.5 Admin
**Login:** `/admin`.

**Dashboard:**
- Live snapshot of the period: counts of submitted / approved / invoiced / paid.

**Users page (`/admin/users`):**
- List all users with role + active/inactive.
- **New user** — email, full name, role (employee/reviewer/finance/account_manager/admin), temporary password (≥8 chars). The account is pre-confirmed so they can sign in immediately.
- **Edit** — change role, full name, status (active/inactive).
- Cannot delete users — to retire someone, mark them `inactive` (they keep their history but can no longer log in).

**Clients page (`/admin/clients`):**
- New/edit client — name, billing_period, contact name/email, billing address, account manager.

**Assignments page (`/admin/assignments`):**
- New/edit assignment — employee, client, title, bill rate, pay rate, employment type (W2/1099), OT multiplier (default 1.5), billing period, start date, optional end date.

**Email Templates page (`/admin/email-templates`):**
- View and edit the subject, heading, message, button text, and footer of each email ClearSheet sends, with a live preview.
- Text is plain text with `{{variables}}`. Layout, links, the invoice PDF, and data tables stay fixed. **Reset to default** restores the built-in text.
- Forgot-password and signup-confirmation emails are sent by Supabase and edited there.

**Integrations page (`/admin/integrations`):**
- Status of email / Stripe / QBO (configured or not).
- Send a test email (if Resend is configured).
- Initiate the QBO connect flow.

**Storage page (`/admin/storage`):**
- Live readout of Supabase DB size and R2 uploads bucket usage (so you know when you're approaching free-tier limits).

Admin also has **everything Reviewer and Finance can do**, since the role checks include admin.

---

## 4. The status lifecycle

Think of a timesheet as a single "ticket" that walks through these states:

```
draft  ─submit→  submitted  ─approve→  approved  ─invoice→  invoiced  ─mark paid→  paid
   ↑                  │
   └──reject (note)───┘                              ↑
                                              void invoice
                                              returns here
```

- **Edit & approve** moves submitted → approved in one step (with audit note).
- **Void** on an invoice returns its timesheets to `approved` so you can re-bill them.

Invoices have their own lifecycle: `draft → sent → paid` (or `void` from any state).

---

## 5. What lives where

| Data | Where | Notes |
|---|---|---|
| Users, clients, assignments, timesheets, hour entries, invoices, line items, audit log | Supabase Postgres | Row-level security per role |
| Uploaded approved-timesheet files | Cloudflare R2 (private bucket) | Browser uploads/downloads via short-lived presigned URLs |
| OAuth tokens (QuickBooks) | Postgres, **encrypted at rest** | AES-256-GCM with a key the DB doesn't hold |
| Nightly DB backup | Cloudflare R2 (backups bucket) | GitHub Actions runs `pg_dump`; keeps newest 14 |
| QuickBooks customers + invoices | Intuit's QBO | Only what's been synced; ClearSheet stores the IDs |

---

## 6. What's deliberately **not** in the app (so you're not surprised)

- **No clock-in/clock-out.** Employees enter hours per day, not timestamps.
- **No automatic overtime detection.** OT is whatever the employee types in the OT column. The 1.5× multiplier is applied to those hours only.
- **No PTO accrual tracking.** PTO hours are paid (not billed) — but the app doesn't track a PTO balance.
- **No expense reports / mileage.** Hours only.
- **No client portal.** Clients sign approved timesheets outside ClearSheet (email/scan); the employee uploads the signed file as evidence.
- **No back-fill UI for missed past periods.** If an employee misses a period, an admin needs to intervene (manual DB edit) — worth knowing for the first month of use.
- **Few notifications on status changes.** Employees get a "Timesheet received" receipt when they submit (with an optional CC list), reviewers are emailed when a timesheet is submitted, and employees are emailed when it is approved, approved with changes, or rejected. Finance and invoice status changes send nothing yet.
- **No 2-factor auth** in the app itself (relies on Supabase's built-in auth).
- **Single-tenant.** One ClearSheet deployment = one firm. Multiple paying customers means multiple deployments (or the multi-tenant refactor).
- **Not yet polished for mobile** (works, but tables are dense).

---

## 7. A typical week (what it feels like in practice)

1. **Mon morning** — employees log in, see the new week's drafts. Fill, upload Friday's approved file, submit.
2. **Tue** — reviewer clears the queue (approve / reject-with-note / edit-and-approve).
3. **Wed–Thu** — finance generates invoices grouped by client+period; PDFs auto-generated; syncs to QuickBooks.
4. **Wed–Thu** — finance exports payroll CSV; hands it to payroll provider.
5. **Anytime** — clients pay (via Stripe link in the email, or wire/check); finance marks paid; timesheets cascade to `paid`.
6. **Nightly** — backup runs to R2.
7. **Daily** — keep-alive ping to Supabase so the free project doesn't pause.

---

**One-line takeaway:** ClearSheet is the system of record for the *operations* (hours → approval → invoice → payroll). QuickBooks, Stripe, and email are downstream destinations it pushes to — never the other way around.
