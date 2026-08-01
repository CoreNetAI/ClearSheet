// Definitions and rendering for the emails admins can customize. Used on the
// server to send and in the browser to preview, so it must stay free of secrets
// and server-only imports. Stored text is plain text with {{variables}}; layout,
// links, and data blocks stay in code so an edit can't break an email.

export type EmailTemplateKey =
  | "user_invite"
  | "email_changed"
  | "timesheet_reminder"
  | "timesheet_submitted"
  | "timesheet_approved"
  | "timesheet_approved_with_changes"
  | "timesheet_returned"
  | "invoice";

export interface EmailContent {
  subject: string;
  heading: string;
  body: string;
  buttonLabel: string;
  footer: string;
}

// Data blocks added around the editable text. Not editable by admins.
export interface EmailBlocks {
  details?: { label: string; value: string }[];
  periods?: { client: string; title: string; period: string }[];
  note?: string | null;
  buttonUrl?: string | null;
}

export interface EmailTemplateDefinition {
  key: EmailTemplateKey;
  name: string;
  sentTo: string;
  sentWhen: string;
  fixedContent: string;
  variables: { name: string; description: string; sample: string }[];
  defaults: EmailContent;
  sampleBlocks: EmailBlocks;
}

const FIRM_VARIABLE = {
  name: "firmName",
  description: "Your firm's name",
  sample: "Your Firm LLC",
};

const TIMESHEET_VARIABLES = [
  { name: "employeeName", description: "Employee's first name", sample: "Priya" },
  { name: "client", description: "Client name", sample: "Acme Corp" },
  { name: "title", description: "Assignment title", sample: "Software Engineer" },
  { name: "period", description: "Timesheet period", sample: "Nov 2 – Nov 8, 2026" },
  { name: "hours", description: "Total hours", sample: "40" },
  FIRM_VARIABLE,
];

const TIMESHEET_DETAILS = [
  { label: "Client", value: "Acme Corp" },
  { label: "Assignment", value: "Software Engineer" },
  { label: "Period", value: "Nov 2 – Nov 8, 2026" },
  { label: "Hours", value: "40" },
];

const TIMESHEET_FIXED = "Client, assignment, period, and hours table; link to the timesheet.";

export const EMAIL_TEMPLATES: Record<EmailTemplateKey, EmailTemplateDefinition> = {
  user_invite: {
    key: "user_invite",
    name: "User invite",
    sentTo: "New user",
    sentWhen: "An admin creates a user or resends an invite",
    fixedContent: "The personal set-password link.",
    variables: [
      { name: "inviteeName", description: "New user's name", sample: "Priya Sharma" },
      { name: "roleLabel", description: "Their role", sample: "Reviewer" },
      FIRM_VARIABLE,
    ],
    defaults: {
      subject: "You're invited to ClearSheet",
      heading: "You've been invited to ClearSheet",
      body: "Hello {{inviteeName}},\n\n{{firmName}} has invited you to ClearSheet as {{roleLabel}}. Click below to set your password and activate your account.",
      buttonLabel: "Set your password",
      footer:
        "This invite link expires after a short time. If it has expired, ask your administrator to resend the invite.\n\n— {{firmName}}",
    },
    sampleBlocks: { buttonUrl: "#" },
  },
  email_changed: {
    key: "email_changed",
    name: "Sign-in email changed",
    sentTo: "User's new and old addresses",
    sentWhen: "An admin changes the email of a user who has accepted their invite",
    fixedContent: "The link to the sign-in page.",
    variables: [
      { name: "userName", description: "User's name", sample: "Priya Sharma" },
      { name: "newEmail", description: "New sign-in email", sample: "priya@example.com" },
      FIRM_VARIABLE,
    ],
    defaults: {
      subject: "Your ClearSheet sign-in email changed",
      heading: "Your sign-in email changed",
      body: "Hello {{userName}},\n\nAn administrator updated your ClearSheet sign-in email to {{newEmail}}. From now on, please sign in with this address. Your password has not changed.",
      buttonLabel: "Sign in",
      footer:
        'If you didn\'t expect this change, contact your administrator right away. Forgot your password? Use "Forgot password" on the sign-in page.\n\n— {{firmName}}',
    },
    sampleBlocks: { buttonUrl: "#" },
  },
  timesheet_reminder: {
    key: "timesheet_reminder",
    name: "Timesheet reminder",
    sentTo: "Employees with timesheets due",
    sentWhen: "The scheduled reminder job runs",
    fixedContent: "The table of due periods; link to the employee dashboard.",
    variables: [
      { name: "employeeName", description: "Employee's first name", sample: "Priya" },
      { name: "periodCount", description: "Number of periods due", sample: "2 periods" },
      FIRM_VARIABLE,
    ],
    defaults: {
      subject: "Timesheet reminder — {{periodCount}} awaiting submission",
      heading: "Timesheet reminder",
      body: "Hello {{employeeName}},\n\nTimesheet periods awaiting your submission:",
      buttonLabel: "Open ClearSheet",
      footer:
        "Please fill in your hours, attach the client-approved timesheet, and submit.\n\n— {{firmName}}",
    },
    sampleBlocks: {
      periods: [
        { client: "Acme Corp", title: "Software Engineer", period: "Oct 26 – Nov 1, 2026" },
        { client: "Acme Corp", title: "Software Engineer", period: "Nov 2 – Nov 8, 2026" },
      ],
      buttonUrl: "#",
    },
  },
  timesheet_submitted: {
    key: "timesheet_submitted",
    name: "Timesheet ready for review",
    sentTo: "Active reviewers (admins if there are none)",
    sentWhen: "An employee submits a timesheet",
    fixedContent: TIMESHEET_FIXED,
    variables: [
      { ...TIMESHEET_VARIABLES[0], description: "Employee's full name", sample: "Priya Sharma" },
      ...TIMESHEET_VARIABLES.slice(1),
    ],
    defaults: {
      subject: "Timesheet to review: {{employeeName}} ({{period}})",
      heading: "Timesheet ready for review",
      body: "{{employeeName}} submitted a timesheet.",
      buttonLabel: "Review timesheet",
      footer: "— {{firmName}}",
    },
    sampleBlocks: { details: TIMESHEET_DETAILS, buttonUrl: "#" },
  },
  timesheet_approved: {
    key: "timesheet_approved",
    name: "Timesheet approved",
    sentTo: "The employee",
    sentWhen: "A reviewer or admin approves a timesheet",
    fixedContent: TIMESHEET_FIXED,
    variables: TIMESHEET_VARIABLES,
    defaults: {
      subject: "Your timesheet was approved ({{period}})",
      heading: "Timesheet approved",
      body: "Hello {{employeeName}},\n\nYour timesheet has been approved. No action is needed.",
      buttonLabel: "View timesheet",
      footer: "— {{firmName}}",
    },
    sampleBlocks: { details: TIMESHEET_DETAILS, buttonUrl: "#" },
  },
  timesheet_approved_with_changes: {
    key: "timesheet_approved_with_changes",
    name: "Timesheet approved with changes",
    sentTo: "The employee",
    sentWhen: "A reviewer or admin uses Edit & approve",
    fixedContent: `${TIMESHEET_FIXED} The reviewer's note.`,
    variables: TIMESHEET_VARIABLES,
    defaults: {
      subject: "Your timesheet was approved with changes ({{period}})",
      heading: "Timesheet approved with changes",
      body: "Hello {{employeeName}},\n\nA reviewer changed your hours and approved your timesheet. The hours below are the approved hours.",
      buttonLabel: "View timesheet",
      footer: "— {{firmName}}",
    },
    sampleBlocks: {
      details: TIMESHEET_DETAILS,
      note: "Reduced Monday to match the client's signed timesheet.",
      buttonUrl: "#",
    },
  },
  timesheet_returned: {
    key: "timesheet_returned",
    name: "Timesheet returned",
    sentTo: "The employee",
    sentWhen: "A reviewer or admin rejects a timesheet",
    fixedContent: `${TIMESHEET_FIXED} The reviewer's note.`,
    variables: TIMESHEET_VARIABLES,
    defaults: {
      subject: "Action needed: your timesheet was returned ({{period}})",
      heading: "Timesheet returned",
      body: "Hello {{employeeName}},\n\nA reviewer returned your timesheet. Please make the requested changes and submit it again.",
      buttonLabel: "Fix and resubmit",
      footer: "— {{firmName}}",
    },
    sampleBlocks: {
      details: TIMESHEET_DETAILS,
      note: "Please correct Tuesday's hours and attach the signed timesheet.",
      buttonUrl: "#",
    },
  },
  invoice: {
    key: "invoice",
    name: "Invoice",
    sentTo: "The client's contact email",
    sentWhen: "Finance clicks Email invoice",
    fixedContent: "The invoice PDF attachment; the Pay online link, shown only when Stripe is on.",
    variables: [
      { name: "clientName", description: "Client name", sample: "Acme Corp" },
      { name: "invoiceNumber", description: "Invoice number", sample: "INV-2026-0001" },
      { name: "total", description: "Invoice total", sample: "$3,600.00" },
      { name: "dueDate", description: "Due date", sample: "Dec 7, 2026" },
      FIRM_VARIABLE,
    ],
    defaults: {
      subject: "Invoice {{invoiceNumber}} from {{firmName}}",
      heading: "Invoice {{invoiceNumber}}",
      body: "Hello {{clientName}},\n\nPlease find attached invoice {{invoiceNumber}} from {{firmName}} for {{total}}, due {{dueDate}}.",
      buttonLabel: "Pay online",
      footer: "Thank you for your business.",
    },
    sampleBlocks: { buttonUrl: "#" },
  },
};

export const EMAIL_TEMPLATE_LIST = Object.values(EMAIL_TEMPLATES);

export function isEmailTemplateKey(key: string): key is EmailTemplateKey {
  return Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, key);
}

export function sampleVariables(
  definition: EmailTemplateDefinition
): Record<string, string> {
  return Object.fromEntries(
    definition.variables.map((v) => [v.name, v.sample])
  );
}

const VARIABLE_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;

/** Variables used in the content that this template doesn't provide. */
export function findUnknownVariables(
  definition: EmailTemplateDefinition,
  content: EmailContent
): string[] {
  const known = new Set(definition.variables.map((v) => v.name));
  const text = Object.values(content).join("\n");
  const unknown = new Set<string>();
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    if (!known.has(match[1])) unknown.add(match[1]);
  }
  return Array.from(unknown);
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fill(
  template: string,
  variables: Record<string, string>,
  encode: (value: string) => string
): string {
  return template.replace(VARIABLE_PATTERN, (_, name: string) =>
    encode(variables[name] ?? "")
  );
}

// Escapes the admin's text and each value, so neither can inject HTML.
function htmlText(template: string, variables: Record<string, string>): string {
  return fill(esc(template), variables, esc);
}

function paragraphs(
  template: string,
  variables: Record<string, string>,
  style = ""
): string {
  return template
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const text = htmlText(p, variables).replace(/\n/g, "<br>");
      return `<p${style ? ` style="${style}"` : ""}>${text}</p>`;
    })
    .join("");
}

export function renderEmail(
  content: EmailContent,
  variables: Record<string, string>,
  blocks: EmailBlocks = {}
): { subject: string; html: string } {
  const details = blocks.details?.length
    ? `<table style="border-collapse:collapse;font-size:14px;margin:8px 0 16px">${blocks.details
        .map(
          (d) =>
            `<tr><td style="padding:3px 16px 3px 0;color:#6b7280">${esc(d.label)}</td><td>${esc(d.value)}</td></tr>`
        )
        .join("")}</table>`
    : "";

  const cell = "padding:6px 12px 6px 0;border-bottom:1px solid #eef0f3";
  const periods = blocks.periods?.length
    ? `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:8px 0 16px">
        <thead><tr style="text-align:left;color:#6b7280;font-size:12px">
          <th style="padding:0 12px 6px 0">Client</th>
          <th style="padding:0 12px 6px 0">Assignment</th>
          <th style="padding:0 0 6px 0">Period</th>
        </tr></thead>
        <tbody>${blocks.periods
          .map(
            (p) =>
              `<tr><td style="${cell}">${esc(p.client)}</td><td style="${cell};color:#6b7280">${esc(p.title)}</td><td style="${cell};font-weight:600">${esc(p.period)}</td></tr>`
          )
          .join("")}</tbody></table>`
    : "";

  const note = blocks.note
    ? `<p style="margin:0 0 4px;font-weight:600">Reviewer's note</p>
       <p style="margin:0 0 16px;padding:10px 12px;background:#f5f6f8;border-radius:6px;white-space:pre-wrap">${esc(blocks.note)}</p>`
    : "";

  const button = blocks.buttonUrl
    ? `<p style="margin:16px 0"><a href="${esc(blocks.buttonUrl)}" style="display:inline-block;background:#1a1f29;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${htmlText(content.buttonLabel, variables)}</a></p>`
    : "";

  return {
    // A subject is a plain header, not HTML. Newlines would break the header.
    subject: fill(content.subject, variables, (v) => v)
      .replace(/\s*[\r\n]+\s*/g, " ")
      .trim(),
    html: `<div style="font-family:Arial,sans-serif;color:#1a1f29;max-width:560px">
      <h2 style="margin:0 0 8px">${htmlText(content.heading, variables)}</h2>
      ${paragraphs(content.body, variables)}
      ${details}${periods}${note}${button}
      ${paragraphs(content.footer, variables, "color:#6b7280;font-size:13px")}
    </div>`,
  };
}
