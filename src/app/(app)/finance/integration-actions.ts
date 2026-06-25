"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { appBaseUrl, firm } from "@/lib/config";
import { formatMoney, formatDate } from "@/lib/format";
import { renderInvoicePdf } from "@/lib/pdf/invoice-render";
import {
  isEmailEnabled,
  sendEmail,
  invoiceEmailHtml,
} from "@/lib/email";
import { createInvoiceCheckout, isStripeEnabled } from "@/lib/stripe";
import {
  createCustomer,
  createInvoice as qboCreateInvoice,
  isQuickBooksEnabled,
  refreshAccessToken,
} from "@/lib/quickbooks";
import { decryptToken, encryptToken } from "@/lib/crypto";

async function financeContext() {
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
  if (!profile || !["finance", "admin"].includes(profile.role)) return null;
  return { supabase, userId: user.id };
}

// Integration setup (connect/disconnect) is operator-only, not finance/admin.
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

// ----------------------------------------------------------------- Stripe
export async function createPaymentLink(
  invoiceId: string
): Promise<ActionResult<{ url: string }>> {
  if (!isStripeEnabled()) return actionError("Payments are not enabled.");
  const ctx = await financeContext();
  if (!ctx) return actionError("Not authorized.");
  const { supabase, userId } = ctx;

  const { data: inv } = await supabase
    .from("invoices")
    .select("id, invoice_number, total, client:clients(contact_email)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return actionError("Invoice not found.");

  const client = Array.isArray(inv.client) ? inv.client[0] : inv.client;
  const checkout = await createInvoiceCheckout({
    invoiceId,
    invoiceNumber: inv.invoice_number,
    amount: Number(inv.total),
    currency: "USD",
    baseUrl: appBaseUrl,
    customerEmail: client?.contact_email ?? null,
  });
  if (!checkout) return actionError("Could not create payment link.");

  await supabase
    .from("invoices")
    .update({ stripe_payment_link: checkout.url })
    .eq("id", invoiceId);

  await writeAudit(supabase, {
    actorId: userId,
    entityType: "invoice",
    entityId: invoiceId,
    action: "create_payment_link",
  });

  revalidatePath(`/finance/invoices/${invoiceId}`);
  return actionOk({ url: checkout.url });
}

// ------------------------------------------------------------------ Email
export async function emailInvoice(invoiceId: string): Promise<ActionResult> {
  if (!isEmailEnabled()) return actionError("Email is not enabled.");
  const ctx = await financeContext();
  if (!ctx) return actionError("Not authorized.");
  const { supabase, userId } = ctx;

  const { data: inv } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, total, due_date, status, stripe_payment_link, client:clients(name, contact_email)"
    )
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return actionError("Invoice not found.");

  const client = Array.isArray(inv.client) ? inv.client[0] : inv.client;
  if (!client?.contact_email) {
    return actionError("Client has no contact email.");
  }

  const rendered = await renderInvoicePdf(supabase, invoiceId);
  if (!rendered) return actionError("Could not render invoice PDF.");

  // Attach a pay link if Stripe is enabled.
  let payLink = inv.stripe_payment_link as string | null;
  if (!payLink && isStripeEnabled()) {
    const checkout = await createInvoiceCheckout({
      invoiceId,
      invoiceNumber: inv.invoice_number,
      amount: Number(inv.total),
      currency: "USD",
      baseUrl: appBaseUrl,
      customerEmail: client.contact_email,
    });
    if (checkout) {
      payLink = checkout.url;
      await supabase
        .from("invoices")
        .update({ stripe_payment_link: payLink })
        .eq("id", invoiceId);
    }
  }

  const html = invoiceEmailHtml({
    firmName: firm.name,
    clientName: client.name ?? "there",
    invoiceNumber: inv.invoice_number,
    total: formatMoney(Number(inv.total)),
    dueDate: formatDate(inv.due_date),
    payLink,
  });

  const sent = await sendEmail({
    to: client.contact_email,
    subject: `Invoice ${inv.invoice_number} from ${firm.name}`,
    html,
    attachments: [
      { filename: `${inv.invoice_number}.pdf`, content: rendered.bytes },
    ],
  });
  if (!sent.ok) return actionError(sent.error);

  await supabase
    .from("invoices")
    .update({
      status: inv.status === "draft" ? "sent" : inv.status,
      sent_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);

  await writeAudit(supabase, {
    actorId: userId,
    entityType: "invoice",
    entityId: invoiceId,
    action: "email",
    detail: { to: client.contact_email },
  });

  revalidatePath(`/finance/invoices/${invoiceId}`);
  return actionOk();
}

// ------------------------------------------------------------- QuickBooks
async function getQboAccess(
  supabase: SupabaseClient
): Promise<{ accessToken: string; realmId: string } | null> {
  const { data: conn } = await supabase
    .from("integration_connections")
    .select("*")
    .eq("provider", "quickbooks")
    .maybeSingle();
  if (
    !conn ||
    conn.status !== "connected" ||
    !conn.access_token ||
    !conn.refresh_token ||
    !conn.realm_id
  ) {
    return null;
  }

  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 60_000) {
    return {
      accessToken: decryptToken(conn.access_token),
      realmId: conn.realm_id,
    };
  }

  // Refresh.
  const tokens = await refreshAccessToken(decryptToken(conn.refresh_token));
  await supabase
    .from("integration_connections")
    .update({
      access_token: encryptToken(tokens.access_token),
      refresh_token: encryptToken(tokens.refresh_token),
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    })
    .eq("id", conn.id);

  return { accessToken: tokens.access_token, realmId: conn.realm_id };
}

export async function syncInvoiceToQuickBooks(
  invoiceId: string
): Promise<ActionResult> {
  if (!isQuickBooksEnabled()) return actionError("QuickBooks is not enabled.");
  const ctx = await financeContext();
  if (!ctx) return actionError("Not authorized.");
  const { supabase, userId } = ctx;

  const access = await getQboAccess(supabase);
  if (!access) return actionError("Connect QuickBooks first.");

  const { data: inv } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, client:clients(id, name, contact_email, quickbooks_customer_id), line_items:invoice_line_items(employee_name, assignment_title, amount)"
    )
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return actionError("Invoice not found.");

  const client = Array.isArray(inv.client) ? inv.client[0] : inv.client;
  if (!client) return actionError("Invoice has no client.");

  try {
    let customerId = client.quickbooks_customer_id as string | null;
    if (!customerId) {
      customerId = await createCustomer(access.realmId, access.accessToken, {
        displayName: client.name,
        email: client.contact_email,
      });
      await supabase
        .from("clients")
        .update({ quickbooks_customer_id: customerId })
        .eq("id", client.id);
    }

    const lines = (inv.line_items ?? []).map(
      (li: {
        employee_name: string | null;
        assignment_title: string | null;
        amount: number;
      }) => ({
        amount: Number(li.amount),
        description: `${li.employee_name ?? ""} — ${li.assignment_title ?? ""}`.trim(),
      })
    );

    const qboInvoiceId = await qboCreateInvoice(
      access.realmId,
      access.accessToken,
      { customerId, docNumber: inv.invoice_number, lines }
    );

    await supabase
      .from("invoices")
      .update({ quickbooks_invoice_id: qboInvoiceId })
      .eq("id", invoiceId);

    await writeAudit(supabase, {
      actorId: userId,
      entityType: "invoice",
      entityId: invoiceId,
      action: "quickbooks_sync",
      detail: { qboInvoiceId },
    });

    revalidatePath(`/finance/invoices/${invoiceId}`);
    return actionOk();
  } catch (e) {
    return actionError(
      e instanceof Error ? e.message : "QuickBooks sync failed."
    );
  }
}

export async function disconnectQuickBooks(): Promise<ActionResult> {
  const ctx = await operatorContext();
  if (!ctx) return actionError("Not authorized.");
  const { supabase, userId } = ctx;

  await supabase
    .from("integration_connections")
    .update({
      status: "disconnected",
      access_token: null,
      refresh_token: null,
      expires_at: null,
    })
    .eq("provider", "quickbooks");

  await writeAudit(supabase, {
    actorId: userId,
    entityType: "integration",
    entityId: invoiceSafeId(),
    action: "quickbooks_disconnect",
  });

  revalidatePath("/admin/integrations");
  return actionOk();
}

// audit_log.entity_id is uuid; use a stable nil uuid for integration-wide events.
function invoiceSafeId(): string {
  return "00000000-0000-0000-0000-000000000000";
}
