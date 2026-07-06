# ClearSheet — Setup Checklist

Click-by-click steps to get ClearSheet running locally and test it with ~40–50 users.
The app runs fully on free infrastructure; the paid integrations (Stripe, QuickBooks,
email) stay **off** until you add their keys, so you can ignore them for the first test.

Work top to bottom. Boxes are things *you* do; everything else is reference.

---

## 0. Prerequisites

- [ ] **Node.js ≥ 18.18** installed — check with `node -v`.
- [ ] Dependencies installed — from the project folder run `npm install` (once).
- [ ] A free **Supabase** account → https://supabase.com
- [ ] A free **Cloudflare** account → https://dash.cloudflare.com

No credit card is required for either free tier.

---

## 1. Create the Supabase project (~5 min)

- [ ] Supabase dashboard → **New project**. Pick a name, a strong **database password**
      (save it — you need it in step 3), and the region closest to your firm.
- [ ] Wait for it to finish provisioning (green "Project is ready").
- [ ] Go to **Project Settings → API** and copy three values:
      - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
      - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
      - **service_role key** (click "reveal") → `SUPABASE_SERVICE_ROLE_KEY`  ⚠️ secret
- [ ] Go to **Project Settings → Database → Connection string → URI**, copy it,
      and replace `[PASSWORD]` with your DB password → `SUPABASE_DB_URL`

> The **service_role key** bypasses all security rules. Never paste it anywhere public
> and never commit it.

---

## 2. Create the Cloudflare R2 buckets (~5 min)

- [ ] Cloudflare dashboard → **R2** → (enable R2 if first time; free tier, no card).
- [ ] **Create bucket** named `clearsheet-uploads` — keep it **private** (default).
- [ ] **Create bucket** named `clearsheet-backups`.
- [ ] R2 → **Manage R2 API Tokens** → **Create API token**:
      - Permissions: **Object Read & Write**
      - Scope: the two buckets above (or all buckets)
      - Create, then copy **Access Key ID** and **Secret Access Key** (shown once).
- [ ] Note your **Account ID** (R2 overview page, right side) → `R2_ACCOUNT_ID`

Maps to env vars: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`,
`R2_UPLOADS_BUCKET=clearsheet-uploads`, `R2_BACKUPS_BUCKET=clearsheet-backups`.

---

## 3. Fill in `.env.local` (~5 min)

- [ ] Copy the template:  `copy .env.example .env.local`  (PowerShell)
- [ ] Generate the token-encryption key and paste it as `TOKEN_ENCRYPTION_KEY`:
      ```
      node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
      ```
- [ ] Fill the **Core** block with the values from steps 1–2:

| Variable | From |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | step 1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | step 1 |
| `SUPABASE_DB_URL` | step 1 (password substituted) |
| `TOKEN_ENCRYPTION_KEY` | generated above |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | step 2 |
| `R2_UPLOADS_BUCKET` / `R2_BACKUPS_BUCKET` | `clearsheet-uploads` / `clearsheet-backups` |
| `APP_BASE_URL` | `http://localhost:3000` for local testing |
| `DEFAULT_TIMEZONE` | e.g. `America/New_York` |
| `FIRM_NAME` / `FIRM_ADDRESS` / `FIRM_EMAIL` | your firm's details (shown on invoices) |

- [ ] **Leave blank** for now: `RESEND_API_KEY`, `STRIPE_*`, `QBO_*`. Each feature
      auto-disables when blank — that's expected for the first test round.

---

## 4. Apply the database migrations (~3 min)

Run the four SQL files **in order** in Supabase → **SQL Editor** → New query →
paste → **Run**:

- [ ] `supabase/migrations/20250101000000_schema.sql`   (tables, triggers, invoice numbering)
- [ ] `supabase/migrations/20250101000001_rls.sql`       (row-level security policies)
- [ ] `supabase/migrations/20250101000002_realtime.sql`  (live reviewer queue / dashboards)
- [ ] `supabase/migrations/20250101000003_admin.sql`     (storage-size helper)

Each should report success with no errors. (Alternative: `supabase db push` if you use
the Supabase CLI.)

---

## 5. Seed test data + run (~3 min)

- [ ] Create ~50 users:
      ```
      $env:SEED_EMPLOYEE_COUNT=45; npm run seed
      ```
      This creates 5 role logins + 45 employees, 2 clients (Acme weekly, Globex monthly),
      assignments, and a few timesheets so the queues aren't empty. **Idempotent** —
      safe to re-run.
- [ ] Start the app:  `npm run dev`
- [ ] Open http://localhost:3000 and sign in.

**Seeded logins** (password `Test1234!` for all):

| Email | Role |
|---|---|
| `admin@test.com` | admin |
| `reviewer@test.com` | reviewer |
| `finance@test.com` | finance |
| `am@test.com` | account manager |
| `employee@test.com` | employee |
| `employee1@test.com` … `employee45@test.com` | employees |

---

## 6. Smoke-test the core loop (the whole product, no paid features)

- [ ] **Employee** (`employee@test.com`): open the current timesheet, enter daily hours,
      upload an approved-timesheet file (PDF/PNG/JPG/XLSX, ≤10 MB), **Submit**.
      → confirms hours grid, R2 upload, and the submit-requires-attachment rule.
- [ ] **Reviewer** (`reviewer@test.com`): the submission appears **live** in the queue;
      open it, preview the attachment, **Approve** (try reject + edit-and-approve too).
- [ ] **Finance** (`finance@test.com`): approved hours group by client+period →
      **Generate invoice** → open it → **Download PDF**; then **Payroll → Export CSV**.
- [ ] **Admin** (`admin@test.com`): check Users / Clients / Assignments, and
      **Storage** (DB + R2 usage). Integrations should show email/Stripe/QBO as *disabled*.

If all four pass, the core product is working end-to-end.

---

## 7. (Later) Turn on the optional integrations

Only after the core flow is validated with your testers. Full per-service steps live in
[INTEGRATIONS.md](INTEGRATIONS.md):

- [ ] **Google / Microsoft SSO** — configured in the Supabase dashboard (Auth → Providers).
- [ ] **Email (Resend)** — set `RESEND_API_KEY` + `FROM_EMAIL`, test from Admin → Integrations.
- [ ] **QuickBooks Online** — the firm already has the subscription; set `QBO_*`, connect
      from Finance → QuickBooks. Start in `sandbox`.
- [ ] **Stripe** — set `STRIPE_*` + webhook; has a per-transaction cost, so enable last.

---

## 8. (Later) Free-tier operations & deploy

- [ ] **Backups + keep-alive** — add the GitHub Actions repo secrets listed in
      [INTEGRATIONS.md](INTEGRATIONS.md) so `backup.yml` (nightly DB dump → R2) and
      `keepalive.yml` (stops the free Supabase project pausing) run.
- [ ] **Deploy to Cloudflare Workers** — `npm run cf:deploy`, set Worker secrets, and
      update `APP_BASE_URL` + redirect URLs to the production domain.

---

## Troubleshooting

- **Build warns "multiple lockfiles … selected `C:\Users\shash\package-lock.json`"** —
  there's a stray `package-lock.json` in your home folder. Harmless, but you can delete
  that one (not the project's) to silence it.
- **`Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`** when seeding —
  `.env.local` isn't filled in or you're running from the wrong folder.
- **Uploads fail** — re-check the R2 keys/bucket names and that the uploads bucket exists
  and is private; the Account ID must match the token.
- **Login works but pages 403 / no data** — migrations weren't all applied in order;
  re-run step 4 (RLS file especially).
- **Slow builds** — the project lives under OneDrive, which syncs `node_modules`. Pausing
  OneDrive sync (or moving the project outside OneDrive) speeds builds up noticeably.
