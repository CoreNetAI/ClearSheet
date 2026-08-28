# Integrations & operations

How to configure each external service and run the free‑tier operations. The app
works without any optional integration; each turns on automatically once its
credentials are present.

---

## Core (always required)

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `SUPABASE_DB_URL` | Supabase → Project Settings → Database → Connection string (URI) |
| `TOKEN_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_UPLOADS_BUCKET`, `R2_BACKUPS_BUCKET` | Cloudflare → R2 |
| `APP_BASE_URL`, `DEFAULT_TIMEZONE`, `FIRM_NAME`, `FIRM_ADDRESS`, `FIRM_EMAIL` | your values |

### Cloudflare R2

1. Create two buckets (uploads + backups). The uploads bucket must be **private**.
2. Create an R2 API token (Account → R2 → Manage API Tokens) with read/write to
   those buckets. Use its Access Key ID / Secret.
3. The S3 endpoint defaults to `https://<account_id>.r2.cloudflarestorage.com`
   (override with `R2_ENDPOINT` if needed).

---

## SSO — Google & Microsoft (recommended)

Configured in the **Supabase dashboard**, not in app code.

1. Auth → Providers → **Google**: create an OAuth client in Google Cloud, set the
   authorized redirect URI to `https://<your-supabase-project>.supabase.co/auth/v1/callback`,
   paste client id/secret.
2. Auth → Providers → **Azure**: register an app in Entra ID, add the same
   Supabase callback as a redirect URI, paste client id/secret (and tenant).
3. Auth → URL Configuration: add `<APP_BASE_URL>` to the allowed redirect URLs so
   `<APP_BASE_URL>/auth/callback` works.

---

## Email — Resend (optional)

1. Create a Resend account, verify a sending domain (SPF/DKIM), create an API key.
2. Set `RESEND_API_KEY` and `FROM_EMAIL` (on the verified domain). Optionally set
   `TIMESHEET_RECEIVED_CC` to a comma-separated list of addresses copied on the
   "Timesheet received" email employees get after submitting.
3. Test from **Admin → Integrations → Email → Send test**.

For quick testing you may use Resend's onboarding/test domain; production needs a
verified domain.

---

## Payments — Stripe (optional, has per‑transaction cost)

1. Get test keys from the Stripe dashboard. Set `STRIPE_SECRET_KEY` and
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
2. Add a webhook endpoint pointing to `<APP_BASE_URL>/api/webhooks/stripe`,
   subscribe to **`checkout.session.completed`**, and set `STRIPE_WEBHOOK_SECRET`
   to its signing secret.
3. On an invoice (Finance → Invoices → open one) use **Create pay link** /
   **Email invoice**. Pay with test card `4242 4242 4242 4242`. The webhook marks
   the invoice `paid` and cascades its timesheets to `paid` (idempotent).

Local webhook testing: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

---

## Accounting — QuickBooks Online (optional; needs the firm's QBO subscription)

1. Create an app at the Intuit developer portal. Note the **Client ID/Secret**.
2. Add the redirect URI `<APP_BASE_URL>/api/integrations/quickbooks/callback`.
3. Set `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, and
   `QBO_ENVIRONMENT` (`sandbox` or `production`).
4. Connect from **Finance → QuickBooks → Connect** (or Admin → Integrations).
   Tokens are stored **encrypted** and refreshed automatically.
5. On an invoice, **Sync to QuickBooks** upserts the client as a QBO customer and
   creates the QBO invoice (sandbox lines use a default Service item).

---

## 1:1 meetings — Zoom (optional)

Bi‑weekly 1:1 meetings between each employee and the meeting conductors.
Settings are the `MEETING_*` and `ZOOM_*` values in `.env.example`; the admin
screen is **Meetings** (`/admin/meetings`).

- **Zoom app:** Zoom Marketplace → Develop → Build App → **Server‑to‑Server
  OAuth**. Add scopes `meeting:write:meeting:admin`,
  `meeting:update:meeting:admin`, `meeting:delete:meeting:admin`, activate it,
  and copy the Account ID, Client ID and Client Secret.
- **Conductors:** `MEETING_CONDUCTORS`; all attend every meeting, so meetings
  run one after another. The first address is the Zoom host and must be a user
  on that Zoom account.
- **Cycles:** created automatically `MEETING_GENERATE_DAYS_AHEAD` days before
  each cycle starts. Active employees who accepted their invite are shuffled
  into slots (10:00–16:00, 15 min meeting + 15 min gap = 12 a day by default).
  If there are more employees than slots, the rest are listed on the admin
  screen, where they can be added to any free slot; the next cycle reshuffles
  everyone.
- **Email:** one per meeting, `MEETING_NOTICE_HOURS` (24) before it, to the
  employee and every conductor, with the Zoom link and a calendar file. The
  Zoom meeting is created at that moment, which keeps us under Zoom's daily
  meeting‑create limit.
- **Admin changes** (reschedule, cancel, send now, add to a free slot) take
  effect immediately: Zoom is updated and, if the invite already went out,
  everyone gets a rescheduled/canceled email right away.
- **Database:** run `supabase/migrations/20250101000016_meetings.sql`.

## Scheduled jobs — Azure Functions timer (`azure/cron`)

The app's scheduled jobs are secured endpoints called by a small Azure Function
App with `Authorization: Bearer <CRON_SECRET>`:

| Function | Schedule (UTC) | Calls |
|---|---|---|
| `timesheetReminders` | Mondays 13:00 | `POST /api/cron/reminders` |
| `meetings` | every minute | `POST /api/cron/meetings` |

Function App settings: `APP_BASE_URL` (the app's public URL) and `CRON_SECRET`
(same value as the app). Deploy with VS Code → **Azure Functions: Deploy to
Function App…** from the `azure/cron` folder. Run history is under each
function's **Monitor** tab.

## Backups & keep‑alive (GitHub Actions)

Add these **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Used by |
|---|---|
| `SUPABASE_DB_URL` | backup (`pg_dump`) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BACKUPS_BUCKET` | backup upload |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | keep‑alive |

- **`backup.yml`** runs nightly: `pg_dump` (custom format) → uploads to
  `r2://<backups>/backups/clearsheet_<ts>.dump`, keeping the newest 14.
- **`keepalive.yml`** runs daily: one tiny authenticated REST query so the free
  Supabase project never hits the ~7‑day inactivity pause.
- Trigger either manually from the Actions tab (**Run workflow**) to verify.

### Restoring a backup

1. Download the desired dump from the R2 backups bucket.
2. Restore into a Postgres/Supabase database:
   ```bash
   pg_restore --no-owner --no-privileges \
     --dbname "$TARGET_DB_URL" clearsheet_<ts>.dump
   ```
3. For a clean target, add `--clean --if-exists`. Re‑apply RLS/migrations only if
   restoring into a fresh project that hasn't run them.

---

## Deploying to Cloudflare Workers

1. `npm run cf:deploy` (builds with OpenNext, deploys via `wrangler.jsonc`).
2. Set each non‑public env var as a Worker secret:
   `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` (repeat for R2/Stripe/QBO/Resend
   secrets and `TOKEN_ENCRYPTION_KEY`). Public `NEXT_PUBLIC_*` vars are inlined at
   build time.
3. Update `APP_BASE_URL`, the Supabase allowed redirect URLs, and provider redirect
   URIs to the production domain.
