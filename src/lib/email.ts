import "server-only";
import { Resend } from "resend";

import {
  EMAIL_TEMPLATES,
  type EmailContent,
  type EmailTemplateKey,
} from "@/lib/email-templates";
import { createServiceClient } from "@/lib/supabase/service";

export function isEmailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

// Seeded accounts and clients use these domains. Some belong to other people, so
// never deliver to them; a real send would leak data and hurt sender reputation.
export function isTestAddress(address: string): boolean {
  const domain = address.split("@").pop()?.trim().toLowerCase() ?? "";
  return (
    domain === "test.com" || domain === "example.com" || domain.endsWith(".test")
  );
}

function fromAddress(): string {
  return process.env.FROM_EMAIL || "invoices@example.com";
}

export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
}

export interface EmailAttachmentWithType extends EmailAttachment {
  contentType?: string;
}

/**
 * Sends one email. `to` may be one address or several; with several, the first
 * is the main recipient and must be deliverable, while other test addresses
 * are dropped.
 */
export async function sendEmail(opts: {
  to: string | string[];
  cc?: string[];
  subject: string;
  html: string;
  attachments?: EmailAttachmentWithType[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isEmailEnabled()) return { ok: false, error: "Email is not configured." };
  const toList = Array.from(
    new Set(
      (Array.isArray(opts.to) ? opts.to : [opts.to])
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean)
    )
  );
  if (toList.length === 0) return { ok: false, error: "No recipient." };
  if (isTestAddress(toList[0])) {
    return { ok: false, error: `Not sent: ${toList[0]} is a test address.` };
  }
  const to = toList.filter((a) => !isTestAddress(a));
  // Drop test addresses and anyone already in "to" from the CC list, so a bad
  // CC entry never blocks the main email.
  const cc = Array.from(
    new Set((opts.cc ?? []).map((a) => a.trim().toLowerCase()))
  ).filter((a) => a && !to.includes(a) && !isTestAddress(a));
  const resend = new Resend(process.env.RESEND_API_KEY!);
  const { error } = await resend.emails.send({
    from: fromAddress(),
    to,
    ...(cc.length ? { cc } : {}),
    subject: opts.subject,
    html: opts.html,
    attachments: opts.attachments?.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content),
      ...(a.contentType ? { contentType: a.contentType } : {}),
    })),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * The admin's customized text for an email, or the built-in default. Uses the
 * service role because any signed-in role can trigger an email, while only
 * admins can read the table. A failed lookup must not stop the email, so it
 * falls back to the default.
 */
export async function getEmailContent(
  key: EmailTemplateKey
): Promise<EmailContent> {
  const defaults = EMAIL_TEMPLATES[key].defaults;
  try {
    const { data, error } = await createServiceClient()
      .from("email_templates")
      .select("subject, heading, body, button_label, footer")
      .eq("key", key)
      .maybeSingle();
    if (error) {
      console.error(`Could not load email template ${key}: ${error.message}`);
      return defaults;
    }
    if (!data) return defaults;
    return {
      subject: data.subject,
      heading: data.heading,
      body: data.body,
      buttonLabel: data.button_label,
      footer: data.footer,
    };
  } catch (e) {
    console.error(`Could not load email template ${key}`, e);
    return defaults;
  }
}
