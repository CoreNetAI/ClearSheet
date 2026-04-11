// Domain types shared across server and client. Kept in sync with the SQL
// schema (supabase/migrations). The Supabase client is used untyped and rows
// are treated as these interfaces at the call sites.

export type Role =
  | "employee"
  | "reviewer"
  | "finance"
  | "account_manager"
  | "admin";

export const ROLES: Role[] = [
  "employee",
  "reviewer",
  "finance",
  "account_manager",
  "admin",
];

export const ROLE_LABELS: Record<Role, string> = {
  employee: "Employee",
  reviewer: "Reviewer",
  finance: "Finance",
  account_manager: "Account Manager",
  admin: "Admin",
};

export type BillingPeriod = "weekly" | "biweekly" | "semimonthly" | "monthly";

export const BILLING_PERIODS: BillingPeriod[] = [
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
];

export type EmploymentType = "W2" | "1099";

export type TimesheetStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "invoiced"
  | "paid";

export type EntryType = "regular" | "overtime" | "holiday" | "pto";

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded";

export type AttachmentType = "approved_timesheet" | "approval_screenshot";

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  // Auto-generated, human-readable employee code (EMP-0001). Only populated
  // for role='employee'; null for everyone else.
  emp_code: string | null;
  role: Role;
  status: "active" | "inactive";
  invite_status: "pending" | "accepted";
  // Hidden builder-only super-capability. An operator is an admin with this set;
  // never exposed as a selectable role, never shown to the customer.
  is_operator: boolean;
  auth_provider: "email" | "google" | "microsoft" | null;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  billing_period: BillingPeriod | null;
  // Net days used to compute an invoice's due date at generation time.
  payment_terms_days: number;
  account_manager_id: string | null;
  billing_address: string | null;
  quickbooks_customer_id: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

export interface Assignment {
  id: string;
  employee_id: string;
  client_id: string;
  title: string | null;
  bill_rate: number;
  pay_rate: number;
  currency: string;
  employment_type: EmploymentType | null;
  overtime_multiplier: number;
  billing_period: BillingPeriod | null;
  // Third party the worker is sourced through (paid via), blank if hired direct.
  vendor: string | null;
  // Free-text remark that flows into the payroll export.
  notes: string | null;
  start_date: string;
  end_date: string | null;
  status: "active" | "ended";
  created_at: string;
  updated_at: string;
}

// One entry in an assignment's rate timeline. The rate applied to a period is
// the row with the latest effective_from on-or-before that period's start.
export interface AssignmentRate {
  id: string;
  assignment_id: string;
  bill_rate: number;
  pay_rate: number;
  overtime_multiplier: number;
  effective_from: string;
  created_by: string | null;
  created_at: string;
}

export interface Timesheet {
  id: string;
  assignment_id: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  status: TimesheetStatus;
  total_regular_hours: number;
  total_ot_hours: number;
  bill_amount: number;
  pay_amount: number;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimesheetEntry {
  id: string;
  timesheet_id: string;
  work_date: string;
  hours: number;
  entry_type: EntryType;
  note: string | null;
  created_at: string;
}

export interface TimesheetAttachment {
  id: string;
  timesheet_id: string;
  r2_object_key: string;
  file_name: string | null;
  attachment_type: AttachmentType;
  uploaded_at: string;
  created_at: string;
}

export interface Invoice {
  id: string;
  client_id: string;
  invoice_number: string;
  period_start: string | null;
  period_end: string | null;
  status: InvoiceStatus;
  subtotal: number;
  total: number;
  issued_date: string | null;
  due_date: string | null;
  sent_at: string | null;
  paid_at: string | null;
  stripe_payment_link: string | null;
  stripe_payment_intent_id: string | null;
  quickbooks_invoice_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type AdjustmentKind = "deduction" | "reimbursement";

export interface InvoiceAdjustment {
  id: string;
  invoice_id: string;
  employee_id: string | null;
  kind: AdjustmentKind;
  label: string;
  amount: number;
  created_by: string | null;
  created_at: string;
}

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  timesheet_id: string | null;
  employee_name: string | null;
  assignment_title: string | null;
  hours: number;
  bill_rate: number;
  amount: number;
  created_at: string;
}

export interface IntegrationConnection {
  id: string;
  provider: "quickbooks";
  access_token: string | null;
  refresh_token: string | null;
  realm_id: string | null;
  expires_at: string | null;
  connected_by: string | null;
  status: "connected" | "disconnected" | "error";
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  invoice_id: string | null;
  provider: "stripe";
  provider_payment_id: string | null;
  amount: number;
  status: PaymentStatus;
  raw: unknown;
  created_at: string;
}
