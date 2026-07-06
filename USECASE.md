# ClearSheet — How It Works (Use-Case Walkthrough)

ClearSheet is the system of record for **operations**: hours → approval → invoice → payroll.
QuickBooks/Stripe/email are downstream destinations it pushes *to*. One deployment = one firm.

---

## 1. Setup order — who creates whom

| Step | Who | Action |
|------|-----|--------|
| 1 | **Operator** (you, the builder) | Created out-of-band in the Supabase dashboard (`role=employee`, `is_operator=true`). Hidden from the customer. Owns **Integrations** (connect QuickBooks, test email, see Stripe/email status) + **Storage** (DB/R2 usage). Sees no customer business data. |
| 2 | **Admin** (the firm's manager) | First admin created in Supabase; afterward admins are invited in-app. Runs the firm: users, clients, assignments — and can do everything Reviewer + Finance do. |
| 3 | **Employees / Reviewers / Finance** | Admin → **Users → New user** (email + name + role). An **invite email** goes out; the person clicks it, **sets their own password**, and logs in. (No admin-set passwords.) To retire someone, set them **Inactive** — never delete (history is preserved). |

**Assignment** is the key object an admin creates: it ties an *employee* to a *client* with a **bill rate**, **pay rate**, **employment type** (W2/1099), **OT multiplier** (default 1.5×), and a **billing period** (weekly / biweekly / semimonthly / monthly). The billing period drives everything downstream — employees never pick dates.

---

## 2. The pipeline (one line)

**Employee** logs hours + uploads client-approved proof → **Reviewer** approves → **Finance** generates the invoice + runs payroll → **Finance** marks it paid.

```
draft ─submit→ submitted ─approve→ approved ─invoice→ invoiced ─mark paid→ paid
  ↑                │                                      ↑
  └─ reject(note)──┘                          void invoice returns here
```

---

## 3. Worked example — Randstad / shriya J / March 2026

1. **Admin** creates client *Randstad* and an **assignment**: shriya J · Software Developer · bill $78/h · monthly.
2. **shriya (employee)** opens the March draft, enters **176h regular** (22 weekdays × 8h), uploads the client-signed timesheet (PDF), and **Submits**.
3. **Reviewer** opens it, sees the hours + the attached proof, clicks **Approve**.
4. **Finance → Approved Hours** shows a *Randstad · Mar 1–31 · $13,728* card → **Generate invoice** → `INV-2026-0001`.
5. **Finance** opens the invoice → **Email invoice** to Randstad → later **Mark paid**. Done.

*(That's why Approved Hours can show several cards — e.g. Mar/Apr/May — one per month, not duplicates.)*

---

## 4. Filling a timesheet (employee) — every way

- **The period is fixed by the assignment** — no date-range picking. The current period's draft is ready on the dashboard; missed past periods show as **"Overdue"**.
- **Four hour buckets per day:** Regular, Overtime, Holiday, PTO. OT is billed/paid at the multiplier; Holiday/PTO are **paid but not billed**.
- **Ways to fill:**
  1. **Type per day** into the grid.
  2. **Fill weekdays** — one click puts N hours of Regular on Mon–Fri.
  3. **Import Excel/CSV** — upload a sheet; preview matched days; Apply.
- **Upload the client-approved file** (PDF/PNG/JPG/XLSX ≤10 MB) — **required to submit**.
- **Save draft** anytime; **Submit for review** needs ≥1 hour **and** an approved-file attachment (enforced server-side).
- Employees **never see bill/pay amounts or rates** — only their hours.

---

## 5. Roles & powers

| Capability | Employee | Reviewer | Finance | Admin | Operator |
|---|:--:|:--:|:--:|:--:|:--:|
| Fill/submit own timesheet | ✅ | — | — | ✅ | — |
| See others' timesheets | — | ✅ submitted+ | ✅ approved+ | ✅ | — |
| Approve / reject / edit-&-approve | — | ✅ | — | ✅ | — |
| Generate invoice, PDF, payroll CSV | — | — | ✅ | ✅ | — |
| Mark sent/paid/void · email · sync QB | — | — | ✅ | ✅ | — |
| Users / Clients / Assignments | — | — | — | ✅ | — |
| Integrations · Storage | — | — | — | — | ✅ |

- **Reviewer** is the quality gate: **Approve**, **Reject with note** (→ back to employee as draft), or **Edit & approve** (fix hours + required note, one step). Every change is audit-logged.
- **Finance** turns approved hours into money: invoices, payroll, payments. **Cannot** create users/clients/assignments (admin sets the pipeline up).
- **Admin** = the firm's operator-of-record; superset of Reviewer + Finance + setup.
- **Operator** = you/the builder; only the technical plumbing, **no access to the firm's data**.

---

## 6. Invoice actions — what each is for

| Button | What it does | Why it matters |
|--------|--------------|----------------|
| **Download PDF** | Generates the invoice PDF server-side | Send/print manually if needed |
| **Mark sent** | Status → `sent` (informational) | Tracks that you've delivered it |
| **Mark paid** | Status → `paid` **and cascades all its timesheets to `paid`** | Closes the loop end-to-end; those hours are fully done |
| **Void** | Status → `void` **and returns its timesheets to `approved`** | Cancel a wrong invoice and re-bill those hours cleanly |
| **Email invoice** | Emails the PDF (+ a Stripe pay link if enabled) to the client contact | One-click billing to the client |
| **Sync to QuickBooks** | Creates the QBO customer if missing, pushes the invoice to QuickBooks | Keeps the firm's accounting in sync (no re-keying) |

Invoice lifecycle: **draft → sent → paid**, or **void** from any state. Numbering is sequential and concurrency-safe (`INV-YYYY-NNNN`).

---

## 7. Why this helps the customer

- **One trustworthy trail** from hours → client-approved proof → approval → invoice → payment, with an **audit log** on every status change.
- **No back-dating or gaps** — periods are driven by the assignment, not by users.
- **Roles enforce separation of duties** (who logs, who approves, who bills) at the database level, not just the UI.
- **Downstream automation** (QuickBooks, Stripe, email) without re-entering data — while the firm's data stays private from the builder (operator).
