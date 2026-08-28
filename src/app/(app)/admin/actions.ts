"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit } from "@/lib/audit";
import {
  assignmentSchema,
  changeRateSchema,
  clientSchema,
  emailTemplateSchema,
  userSchema,
} from "@/lib/validation";
import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { getEmailContent, isEmailEnabled, sendEmail } from "@/lib/email";
import {
  EMAIL_TEMPLATES,
  findUnknownVariables,
  isEmailTemplateKey,
  renderEmail,
} from "@/lib/email-templates";
import { appBaseUrl, firm } from "@/lib/config";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { z } from "zod";

export type InviteResult = { inviteUrl: string; emailed: boolean };

// Returned by updateUser so the UI can react to an email change: surface the
// copy-link fallback when a pending user was re-invited but email is off.
export type UpdateUserResult = {
  emailChanged: boolean;
  invite?: InviteResult;
};

// Generates a passwordless invite/recovery link via the service role and (when
// email is configured) emails it. Always returns the link so the admin UI can
// offer a copyable fallback. Uses the token-hash flow consumed by /auth/confirm
// (verifyOtp) — no Supabase hosted redirect, so no redirect-URL allow-listing.
async function issueInvite(opts: {
  email: string;
  fullName: string;
  role: string;
  linkType: "invite" | "recovery";
}): Promise<
  { ok: true; result: InviteResult; userId: string } | { ok: false; error: string }
> {
  const service = createServiceClient();
  const { data, error } = await service.auth.admin.generateLink(
    opts.linkType === "invite"
      ? {
          type: "invite",
          email: opts.email,
          options: { data: { full_name: opts.fullName } },
        }
      : { type: "recovery", email: opts.email }
  );
  const hashedToken = data?.properties?.hashed_token;
  const userId = data?.user?.id;
  if (error || !hashedToken || !userId) {
    return { ok: false, error: error?.message || "Could not generate invite link." };
  }

  const inviteUrl =
    `${appBaseUrl}/auth/confirm` +
    `?token_hash=${encodeURIComponent(hashedToken)}` +
    `&type=${opts.linkType}` +
    `&redirectTo=${encodeURIComponent("/set-password")}`;

  let emailed = false;
  if (isEmailEnabled()) {
    const email = renderEmail(
      await getEmailContent("user_invite"),
      {
        firmName: firm.name,
        inviteeName: opts.fullName?.trim() || "there",
        roleLabel: ROLE_LABELS[opts.role as Role] ?? opts.role,
      },
      { buttonUrl: inviteUrl }
    );
    const res = await sendEmail({ to: opts.email, ...email });
    emailed = res.ok; // email failure is non-fatal — the link is still returned
  }

  return { ok: true, result: { inviteUrl, emailed }, userId };
}

export async function sendTestEmail(to: string): Promise<ActionResult> {
  if (!isEmailEnabled()) return actionError("Email is not enabled.");
  const parsed = z.string().email().safeParse(to);
  if (!parsed.success) return actionError("Enter a valid email address.");
  const ctx = await operatorContext();
  if (!ctx) return actionError("Not authorized.");

  const res = await sendEmail({
    to: parsed.data,
    subject: "ClearSheet test email",
    html: "<p>This is a test email from ClearSheet. Email is configured correctly.</p>",
  });
  if (!res.ok) return actionError(res.error);
  return actionOk();
}

async function adminContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return null;
  return { supabase, userId: user.id };
}

// Integration setup (test email, QBO) is operator-only, not customer-admin.
async function operatorContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_operator")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_operator) return null;
  return { supabase, userId: user.id };
}

function emptyToNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// Find an auth user by email via the admin API (used to detect orphaned auth
// records — an auth.users row whose profile was deleted). Paginates defensively.
async function findAuthUserByEmail(
  service: ReturnType<typeof createServiceClient>,
  email: string
) {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) break;
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

// ---------------------------------------------------------- Email templates
export async function saveEmailTemplate(input: {
  key: string;
  subject: string;
  heading: string;
  body: string;
  buttonLabel: string;
  footer: string;
}): Promise<ActionResult> {
  const parsed = emailTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message || "Invalid template.");
  }
  const { key, ...content } = parsed.data;
  if (!isEmailTemplateKey(key)) return actionError("Unknown email template.");
  if (EMAIL_TEMPLATES[key].sampleBlocks.buttonUrl && !content.buttonLabel) {
    return actionError("Button text is required");
  }

  const unknown = findUnknownVariables(EMAIL_TEMPLATES[key], content);
  if (unknown.length > 0) {
    return actionError(
      `Unknown variable: ${unknown.map((v) => `{{${v}}}`).join(", ")}`
    );
  }

  const ctx = await adminContext();
  if (!ctx) return actionError("Not authorized.");

  const { data: row, error } = await ctx.supabase
    .from("email_templates")
    .upsert(
      {
        key,
        subject: content.subject,
        heading: content.heading,
        body: content.body,
        button_label: content.buttonLabel,
        footer: content.footer,
        updated_by: ctx.userId,
      },
      { onConflict: "key" }
    )
    .select("id")
    .single();
  if (error || !row) return actionError("Could not save the template.");

  await writeAudit(ctx.supabase, {
    actorId: ctx.userId,
    entityType: "email_template",
    entityId: row.id,
    action: "update",
    detail: { key },
  });

  revalidatePath("/admin/email-templates");
  return actionOk();
}

export async function resetEmailTemplate(key: string): Promise<ActionResult> {
  if (!isEmailTemplateKey(key)) return actionError("Unknown email template.");

  const ctx = await adminContext();
  if (!ctx) return actionError("Not authorized.");

  const { data: rows, error } = await ctx.supabase
    .from("email_templates")
    .delete()
    .eq("key", key)
    .select("id");
  if (error) return actionError("Could not reset the template.");

  if (rows?.[0]) {
    await writeAudit(ctx.supabase, {
      actorId: ctx.userId,
      entityType: "email_template",
      entityId: rows[0].id,
      action: "reset",
      detail: { key },
    });
  }

  revalidatePath("/admin/email-templates");
  return actionOk();
}

// -------------------------------------------------------------------- Users
export async function createUser(input: {
  email: string;
  full_name: string;
  role: string;
  status?: string;
}): Promise<ActionResult<InviteResult>> {
  const parsed = userSchema.omit({ password: true }).safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message || "Invalid user.");
  }

  const ctx = await adminContext();
  if (!ctx) return actionError("Not authorized.");

  const service = createServiceClient();

  // Create the user (no password) and generate the invite link in one step.
  let invite = await issueInvite({
    email: parsed.data.email,
    fullName: parsed.data.full_name,
    role: parsed.data.role,
    linkType: "invite",
  });

  // "Already registered" can be a genuine duplicate OR an orphaned auth record
  // (its profile was deleted but the auth.users row lingered). If there's no
  // profile for that address, remove the orphan and retry the invite so the
  // admin can re-use the email; if a profile exists, it's a real duplicate.
  if (!invite.ok && /registered|already|exists|in use/i.test(invite.error)) {
    const existing = await findAuthUserByEmail(service, parsed.data.email);
    if (existing) {
      const { data: prof } = await service
        .from("profiles")
        .select("id")
        .eq("id", existing.id)
        .maybeSingle();
      if (!prof) {
        await service.auth.admin.deleteUser(existing.id);
        invite = await issueInvite({
          email: parsed.data.email,
          fullName: parsed.data.full_name,
          role: parsed.data.role,
          linkType: "invite",
        });
      } else {
        return actionError("A user with this email already exists.");
      }
    }
  }
  if (!invite.ok) return actionError(invite.error);

  // The signup trigger created the profile as an employee. This is the only
  // place the chosen role is applied, so match by user id (stored emails may
  // differ in case) and fail loudly. Marked pending here because Supabase sets
  // invited_at after the trigger runs, so the trigger sees every user as accepted.
  const { data: row, error: profileError } = await service
    .from("profiles")
    .update({
      full_name: parsed.data.full_name,
      role: parsed.data.role,
      status: parsed.data.status ?? "active",
      email: parsed.data.email,
      invite_status: "pending",
    })
    .eq("id", invite.userId)
    .select("id, emp_code")
    .maybeSingle();
  if (profileError || !row) {
    return actionError(
      "The user was created, but their role could not be set. Check it on the Users page."
    );
  }

  // Safety net for environments where the trigger hasn't been updated yet: if an
  // employee somehow still has no code, allocate one. Only when missing, so it
  // never double-consumes the sequence (no gaps).
  if (parsed.data.role === "employee" && row?.id && !row.emp_code) {
    const { data: code } = await service.rpc("next_emp_code");
    if (code) {
      await service
        .from("profiles")
        .update({ emp_code: code as string })
        .eq("id", row.id);
    }
  }

  await writeAudit(ctx.supabase, {
    actorId: ctx.userId,
    entityType: "user",
    entityId: row?.id ?? parsed.data.email,
    action: "create",
    detail: { email: parsed.data.email, role: parsed.data.role },
  });

  revalidatePath("/admin/users");
  return actionOk(invite.result);
}

// Re-issues a fresh invite/set-password link for a user who hasn't accepted yet.
export async function resendInvite(input: {
  userId: string;
  email: string;
}): Promise<ActionResult<InviteResult>> {
  const ctx = await adminContext();
  if (!ctx) return actionError("Not authorized.");

  const { data: profile } = await ctx.supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", input.userId)
    .maybeSingle();

  // Existing user → use a recovery link (invite would fail "already registered").
  const invite = await issueInvite({
    email: input.email,
    fullName: profile?.full_name ?? "",
    role: (profile?.role as string) ?? "employee",
    linkType: "recovery",
  });
  if (!invite.ok) return actionError(invite.error);

  await writeAudit(ctx.supabase, {
    actorId: ctx.userId,
    entityType: "user",
    entityId: input.userId,
    action: "invite_resend",
    detail: { email: input.email },
  });

  return actionOk(invite.result);
}

// Called by the set-password page after an invited user sets their password,
// to flip their profile from 'pending' to 'accepted'. Idempotent.
export async function completeInvite(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return actionError("Not signed in.");

  const service = createServiceClient();
  await service
    .from("profiles")
    .update({ invite_status: "accepted" })
    .eq("id", user.id);

  revalidatePath("/admin/users");
  return actionOk();
}

export async function updateUser(input: {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
}): Promise<ActionResult<UpdateUserResult>> {
  const parsed = userSchema
    .pick({ id: true, email: true, full_name: true, role: true, status: true })
    .safeParse(input);
  if (!parsed.success || !parsed.data.id) {
    return actionError("Invalid user data.");
  }

  const ctx = await adminContext();
  if (!ctx) return actionError("Not authorized.");

  // Pull the current email (to detect a change), invite_status (to decide how
  // to notify), and emp_code (to backfill if they become an employee).
  const { data: current } = await ctx.supabase
    .from("profiles")
    .select("email, invite_status, emp_code")
    .eq("id", parsed.data.id)
    .maybeSingle();
  const oldEmail = (current?.email ?? "").trim();

  // Assign a code if this user is an employee and doesn't already have one
  // (covers a role change into 'employee'). Existing codes are never reissued.
  let empCode: string | null = null;
  if (parsed.data.role === "employee" && !current?.emp_code) {
    const { data: code } = await ctx.supabase.rpc("next_emp_code");
    empCode = (code as string | null) ?? null;
  }
  const emailChanged =
    oldEmail.toLowerCase() !== parsed.data.email.trim().toLowerCase();

  // The login email lives in auth.users — only the admin API can change it.
  // Do this first: if it fails (e.g. the address is taken), bail before
  // touching profiles so the two stay in sync.
  if (emailChanged) {
    const service = createServiceClient();
    const { error: authErr } = await service.auth.admin.updateUserById(
      parsed.data.id,
      { email: parsed.data.email, email_confirm: true }
    );
    if (authErr) {
      const msg = authErr.message || "";
      // A new email that belongs to another account → friendly message.
      // Otherwise surface the real Supabase error so it's diagnosable.
      return actionError(
        /registered|already|exists|taken|duplicate|in use/i.test(msg)
          ? "That email is already in use by another account."
          : `Could not update the login email. (${msg})`
      );
    }
  }

  const { error } = await ctx.supabase
    .from("profiles")
    .update({
      email: parsed.data.email,
      full_name: parsed.data.full_name,
      role: parsed.data.role,
      status: parsed.data.status,
      ...(empCode ? { emp_code: empCode } : {}),
    })
    .eq("id", parsed.data.id);
  if (error) return actionError("Could not update user.");

  await writeAudit(ctx.supabase, {
    actorId: ctx.userId,
    entityType: "user",
    entityId: parsed.data.id,
    action: "update",
    detail: {
      role: parsed.data.role,
      status: parsed.data.status,
      ...(emailChanged ? { email: parsed.data.email } : {}),
    },
  });

  const result: UpdateUserResult = { emailChanged };

  // Tell the user their login email moved.
  if (emailChanged) {
    if (current?.invite_status === "pending") {
      // They never set a password and their original invite went to the old
      // inbox — re-issue the set-password link to the new address.
      const invite = await issueInvite({
        email: parsed.data.email,
        fullName: parsed.data.full_name,
        role: parsed.data.role,
        linkType: "recovery",
      });
      if (invite.ok) result.invite = invite.result;
    } else if (isEmailEnabled()) {
      // Accepted user: notify the new AND old address (so the previous inbox
      // owner is alerted if the change was unexpected). Password is unchanged.
      const email = renderEmail(
        await getEmailContent("email_changed"),
        {
          firmName: firm.name,
          userName: parsed.data.full_name?.trim() || "there",
          newEmail: parsed.data.email,
        },
        { buttonUrl: `${appBaseUrl}/login` }
      );
      const recipients = Array.from(
        new Set([parsed.data.email, oldEmail].filter(Boolean))
      );
      for (const to of recipients) {
        await sendEmail({ to, ...email });
      }
    }
  }

  revalidatePath("/admin/users");
  return actionOk(result);
}

// Hard-deletes a user, but ONLY when they have no business footprint (no
// assignments, timesheets, reviews, or invoices). Anyone with real history
// must be deactivated instead so attribution stays intact. Deleting the auth
// user cascades the profile row (profiles.id → auth.users on delete cascade).
export async function deleteUser(input: { id: string }): Promise<ActionResult> {
  const id = z.string().uuid().safeParse(input.id);
  if (!id.success) return actionError("Invalid user.");

  const ctx = await adminContext();
  if (!ctx) return actionError("Not authorized.");
  if (id.data === ctx.userId) {
    return actionError("You can't delete your own account.");
  }

  const service = createServiceClient();

  const { data: target } = await service
    .from("profiles")
    .select("is_operator")
    .eq("id", id.data)
    .maybeSingle();
  if (!target) return actionError("User not found.");
  if (target.is_operator) {
    return actionError("Operator accounts can't be deleted here.");
  }

  // Block deletion if the user appears anywhere that carries history.
  const footprint: { table: string; column: string }[] = [
    { table: "assignments", column: "employee_id" },
    { table: "timesheets", column: "employee_id" },
    { table: "timesheets", column: "reviewed_by" },
    { table: "invoices", column: "created_by" },
  ];
  for (const f of footprint) {
    const { count } = await service
      .from(f.table)
      .select("id", { count: "exact", head: true })
      .eq(f.column, id.data);
    if ((count ?? 0) > 0) {
      return actionError(
        "This user has timesheets, assignments, or invoice history. Deactivate them instead to preserve records."
      );
    }
  }

  // Hard-delete the auth user (cascades the profile row). Surface the real
  // error if it fails, so a half-delete (orphaned auth record) is visible.
  const { error } = await service.auth.admin.deleteUser(id.data);
  if (error) return actionError(`Could not delete the user. (${error.message})`);

  await writeAudit(ctx.supabase, {
    actorId: ctx.userId,
    entityType: "user",
    entityId: id.data,
    action: "delete",
  });

  revalidatePath("/admin/users");
  return actionOk();
}

// ------------------------------------------------------------------ Clients
export async function upsertClient(input: {
  id?: string;
  name: string;
  contact_name?: string | null;
  contact_email?: string | null;
  billing_period: string;
  payment_terms_days?: number;
  account_manager_id?: string | null;
  billing_address?: string | null;
  status?: string;
}): Promise<ActionResult> {
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message || "Invalid client.");
  }
  const ctx = await adminContext();
  if (!ctx) return actionError("Not authorized.");

  const payload = {
    name: parsed.data.name,
    contact_name: emptyToNull(parsed.data.contact_name),
    contact_email: emptyToNull(parsed.data.contact_email),
    billing_period: parsed.data.billing_period,
    payment_terms_days: parsed.data.payment_terms_days,
    account_manager_id: emptyToNull(parsed.data.account_manager_id),
    billing_address: emptyToNull(parsed.data.billing_address),
    status: parsed.data.status,
  };

  if (parsed.data.id) {
    const { error } = await ctx.supabase
      .from("clients")
      .update(payload)
      .eq("id", parsed.data.id);
    if (error) return actionError("Could not update client.");
  } else {
    const { error } = await ctx.supabase.from("clients").insert(payload);
    if (error) return actionError("Could not create client.");
  }

  revalidatePath("/admin/clients");
  return actionOk();
}

// -------------------------------------------------------------- Assignments
export async function upsertAssignment(input: {
  id?: string;
  employee_id: string;
  client_id: string;
  title?: string | null;
  bill_rate: number;
  pay_rate: number;
  currency?: string;
  employment_type: string;
  overtime_multiplier?: number;
  billing_period: string;
  vendor?: string | null;
  notes?: string | null;
  start_date: string;
  end_date?: string | null;
  status?: string;
}): Promise<ActionResult> {
  const parsed = assignmentSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(
      parsed.error.issues[0]?.message || "Invalid assignment."
    );
  }
  const ctx = await adminContext();
  if (!ctx) return actionError("Not authorized.");

  // Non-rate fields. Rates are managed separately via the rate timeline, so a
  // plain edit never silently changes them (use changeAssignmentRate for that).
  const base = {
    employee_id: parsed.data.employee_id,
    client_id: parsed.data.client_id,
    title: emptyToNull(parsed.data.title),
    currency: parsed.data.currency || "USD",
    employment_type: parsed.data.employment_type,
    billing_period: parsed.data.billing_period,
    vendor: emptyToNull(parsed.data.vendor),
    notes: emptyToNull(parsed.data.notes),
    start_date: parsed.data.start_date,
    end_date: emptyToNull(parsed.data.end_date),
    status: parsed.data.status,
  };
  const rates = {
    bill_rate: parsed.data.bill_rate,
    pay_rate: parsed.data.pay_rate,
    overtime_multiplier: parsed.data.overtime_multiplier ?? 1.5,
  };

  if (parsed.data.id) {
    const { error } = await ctx.supabase
      .from("assignments")
      .update(base)
      .eq("id", parsed.data.id);
    if (error) return actionError("Could not update assignment.");
  } else {
    // Create the assignment with its initial rate, then seed the rate timeline
    // (effective from the start date).
    const { data: created, error } = await ctx.supabase
      .from("assignments")
      .insert({ ...base, ...rates })
      .select("id")
      .single();
    if (error || !created) return actionError("Could not create assignment.");

    await ctx.supabase.from("assignment_rates").insert({
      assignment_id: created.id,
      ...rates,
      effective_from: parsed.data.start_date,
      created_by: ctx.userId,
    });
  }

  revalidatePath("/admin/assignments");
  return actionOk();
}

// Record a mid-project rate change: add a new rate-history row and update the
// assignment's denormalized "current" rate. Old periods keep their rate; new
// periods (period_start >= effective_from) pick up the new one automatically.
export async function changeAssignmentRate(input: {
  assignmentId: string;
  bill_rate: number;
  pay_rate: number;
  overtime_multiplier?: number;
  effective_from: string;
}): Promise<ActionResult> {
  const parsed = changeRateSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message || "Invalid rate.");
  }
  const ctx = await adminContext();
  if (!ctx) return actionError("Not authorized.");

  const rates = {
    bill_rate: parsed.data.bill_rate,
    pay_rate: parsed.data.pay_rate,
    overtime_multiplier: parsed.data.overtime_multiplier ?? 1.5,
  };

  const { error: insErr } = await ctx.supabase.from("assignment_rates").insert({
    assignment_id: parsed.data.assignmentId,
    ...rates,
    effective_from: parsed.data.effective_from,
    created_by: ctx.userId,
  });
  if (insErr) return actionError("Could not record the rate change.");

  // Keep the assignment's denormalized current rate = the latest effective row.
  const { data: latest } = await ctx.supabase
    .from("assignment_rates")
    .select("bill_rate, pay_rate, overtime_multiplier")
    .eq("assignment_id", parsed.data.assignmentId)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest) {
    await ctx.supabase
      .from("assignments")
      .update({
        bill_rate: latest.bill_rate,
        pay_rate: latest.pay_rate,
        overtime_multiplier: latest.overtime_multiplier,
      })
      .eq("id", parsed.data.assignmentId);
  }

  await writeAudit(ctx.supabase, {
    actorId: ctx.userId,
    entityType: "assignment",
    entityId: parsed.data.assignmentId,
    action: "rate_change",
    detail: { ...rates, effective_from: parsed.data.effective_from },
  });

  revalidatePath("/admin/assignments");
  return actionOk();
}
