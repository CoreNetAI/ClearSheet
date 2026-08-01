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
function isTestAddress(address: string): boolean {
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

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isEmailEnabled()) return { ok: false, error: "Email is not configured." };
  if (isTestAddress(opts.to)) {
    return { ok: false, error: `Not sent: ${opts.to} is a test address.` };
  }
  const resend = new Resend(process.env.RESEND_API_KEY!);
  const { error } = await resend.emails.send({
    from: fromAddress(),
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    attachments: opts.attachments?.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content),
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
