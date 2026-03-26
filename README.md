# ClearSheet

Internal operations app for a staffing / consulting firm: employees log hours and
upload the client‑approved timesheet, a reviewer verifies each submission, and
finance turns verified hours into **client invoices** and a **payroll CSV**.
Optional add‑ons (auto‑disabled until configured): invoice email, online card
payment, and QuickBooks sync.

Built to run entirely on **free, commercial‑use** infrastructure (Next.js +
Supabase + Cloudflare R2 + GitHub Actions). The only work left after the build is
supplying credentials — see [Appendix D in the spec](./clearsheet-build-spec-free.md)
and [INTEGRATIONS.md](./INTEGRATIONS.md).

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript |
| UI | Tailwind CSS + shadcn‑style components |
| DB / Auth / Realtime | Supabase (Postgres + Auth + Realtime), RLS on every table |
| Files | Cloudflare R2 (private bucket, presigned URLs) |
| PDF | `pdf-lib` (pure JS — no headless Chrome) |
| Email (optional) | Resend |
| Payments (optional) | Stripe hosted Checkout + webhook |
| Accounting (optional) | QuickBooks Online (OAuth 2.0) |
| Hosting | Cloudflare Workers via OpenNext (preferred) / Render (fallback) |
| Cron | GitHub Actions (nightly backup + daily keep‑alive) |

## Local setup (Appendix A)

**Prereqs:** Node.js LTS, Git, and free accounts: Supabase, Cloudflare (R2).
Optional: Resend, Stripe, QuickBooks developer, plus a GitHub repo for cron.

1. **Supabase project** — note the Project URL, `anon` key, and `service_role`
   key (Project Settings → API), plus the database connection string
   (Project Settings → Database).
2. **Cloudflare R2** — create two buckets: one for uploads, one for backups.
   Create an R2 API token (Access Key ID + Secret).
3. `npm install`
4. `cp .env.example .env.local` and fill in the **Core** values
   (Supabase, `TOKEN_ENCRYPTION_KEY`, R2, app/firm). Optional integrations can
   stay blank — they simply disable.
   - Generate `TOKEN_ENCRYPTION_KEY`:
     `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
5. **Apply migrations** (tables + RLS + realtime). Either:
   - Paste each file in `supabase/migrations/*.sql` into the Supabase SQL editor
     in filename order, **or**
   - `supabase link --project-ref <ref>` then `supabase db push`.
6. **Seed test data** (optional): `npm run seed`
   (creates the 5 role users + ~45 employees; set `SEED_EMPLOYEE_COUNT` to change).
7. `npm run dev` → http://localhost:3000 → sign in as `admin@test.com` /
   `Test1234!`.

### Configure SSO (optional but recommended)

In the Supabase dashboard → Authentication → Providers, enable **Google** and
**Azure (Microsoft)** and paste each provider's client id/secret. Set the
redirect URL to `<APP_BASE_URL>/auth/callback`. No app code changes needed.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` / `npm start` | Production build / serve (Node) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run seed` | Seed test data (needs `.env.local`) |
| `npm run cf:deploy` | Build + deploy to Cloudflare Workers (OpenNext) |

## Roles

`employee` · `reviewer` · `finance` · `account_manager` · `admin`.
Permissions are enforced both in the UI and at the database via RLS
(see `supabase/migrations/*_rls.sql`).

## Deploy & operations

- **Cloudflare (preferred):** `npm run cf:deploy` (uses `wrangler.jsonc` +
  `open-next.config.ts`). Set runtime secrets with `wrangler secret put`.
- **Render (fallback):** standard Node web service (`npm run build` /
  `npm start`). Accepts cold starts; the keep‑alive Action mitigates them.
- **Backups & keep‑alive:** enable the two GitHub Actions and add the repo
  secrets listed in [INTEGRATIONS.md](./INTEGRATIONS.md).

See [INTEGRATIONS.md](./INTEGRATIONS.md) for per‑integration setup and backup
restore steps, and [DECISIONS.md](./DECISIONS.md) for design rationale.
