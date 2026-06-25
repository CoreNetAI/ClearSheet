import "server-only";
import { Resend } from "resend";

export function isEmailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
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

export function timesheetReminderHtml(opts: {
  firmName: string;
  employeeName: string;
  appUrl: string;
  items: { client: string; title: string; periodLabel: string }[];
}): string {
  const rows = opts.items
    .map(
      (i) => `
      <tr>
        <td style="padding:6px 12px 6px 0;border-bottom:1px solid #eef0f3">${i.client}</td>
        <td style="padding:6px 12px 6px 0;border-bottom:1px solid #eef0f3;color:#6b7280">${i.title}</td>
        <td style="padding:6px 0;border-bottom:1px solid #eef0f3;font-weight:600">${i.periodLabel}</td>
      </tr>`
    )
    .join("");
  return `
  <div style="font-family:Arial,sans-serif;color:#1a1f29;max-width:560px">
    <h2 style="margin:0 0 8px">Timesheet reminder</h2>
    <p>Hello ${opts.employeeName},</p>
    <p>The following timesheet ${
      opts.items.length === 1 ? "period is" : "periods are"
    } awaiting your submission:</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;margin:8px 0 16px">
      <thead>
        <tr style="text-align:left;color:#6b7280;font-size:12px">
          <th style="padding:0 12px 6px 0">Client</th>
          <th style="padding:0 12px 6px 0">Assignment</th>
          <th style="padding:0 0 6px 0">Period</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p><a href="${opts.appUrl}/employee" style="display:inline-block;background:#1a1f29;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Open ClearSheet</a></p>
    <p style="color:#6b7280;font-size:13px">Please fill in your hours, attach the client-approved timesheet, and submit. — ${opts.firmName}</p>
  </div>`;
}

export function inviteEmailHtml(opts: {
  firmName: string;
  inviteeName: string;
  inviteUrl: string;
  roleLabel: string;
}): string {
  const greetingName = opts.inviteeName?.trim() || "there";
  return `
  <div style="font-family:Arial,sans-serif;color:#1a1f29;max-width:560px">
    <h2 style="margin:0 0 8px">You've been invited to ClearSheet</h2>
    <p>Hello ${greetingName},</p>
    <p>${opts.firmName} has invited you to ClearSheet as
       <strong>${opts.roleLabel}</strong>. Click below to set your password and
       activate your account.</p>
    <p style="margin:16px 0">
      <a href="${opts.inviteUrl}" style="display:inline-block;background:#1a1f29;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Set your password</a>
    </p>
    <p style="color:#6b7280;font-size:13px">This invite link expires after a short
       time. If it has expired, ask your administrator to resend the invite.</p>
    <p style="color:#6b7280;font-size:13px">— ${opts.firmName}</p>
  </div>`;
}

export function emailChangedHtml(opts: {
  firmName: string;
  userName: string;
  newEmail: string;
  appUrl: string;
}): string {
  const greetingName = opts.userName?.trim() || "there";
  return `
  <div style="font-family:Arial,sans-serif;color:#1a1f29;max-width:560px">
    <h2 style="margin:0 0 8px">Your sign-in email changed</h2>
    <p>Hello ${greetingName},</p>
    <p>An administrator updated your ClearSheet sign-in email to
       <strong>${opts.newEmail}</strong>. From now on, please sign in with this
       address. <strong>Your password has not changed.</strong></p>
    <p style="margin:16px 0">
      <a href="${opts.appUrl}/login" style="display:inline-block;background:#1a1f29;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Sign in</a>
    </p>
    <p style="color:#6b7280;font-size:13px">If you didn't expect this change, contact
       your administrator right away. Forgot your password? Use "Forgot password"
       on the sign-in page.</p>
    <p style="color:#6b7280;font-size:13px">— ${opts.firmName}</p>
  </div>`;
}

export function invoiceEmailHtml(opts: {
  firmName: string;
  clientName: string;
  invoiceNumber: string;
  total: string;
  dueDate: string;
  payLink?: string | null;
}): string {
  return `
  <div style="font-family:Arial,sans-serif;color:#1a1f29;max-width:560px">
    <h2 style="margin:0 0 8px">Invoice ${opts.invoiceNumber}</h2>
    <p>Hello ${opts.clientName},</p>
    <p>Please find attached invoice <strong>${opts.invoiceNumber}</strong> from
       ${opts.firmName} for <strong>${opts.total}</strong>, due ${opts.dueDate}.</p>
    ${
      opts.payLink
        ? `<p><a href="${opts.payLink}" style="display:inline-block;background:#1a1f29;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Pay online</a></p>`
        : ""
    }
    <p style="color:#6b7280;font-size:13px">Thank you for your business.</p>
  </div>`;
}
