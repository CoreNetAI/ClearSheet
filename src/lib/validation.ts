import { z } from "zod";

import { BILLING_PERIODS, ROLES } from "@/lib/types";

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd date");

export const entryTypeEnum = z.enum([
  "regular",
  "overtime",
  "holiday",
  "pto",
]);

export const entrySchema = z.object({
  work_date: dateString,
  hours: z.coerce.number().min(0, "Hours must be ≥ 0").max(24, "Max 24h/day"),
  entry_type: entryTypeEnum,
  note: z.string().max(500).optional().nullable(),
});

export const CHALLENGES_LEARNINGS_MAX = 2000;

export const challengesLearningsSchema = z
  .string()
  .trim()
  .max(CHALLENGES_LEARNINGS_MAX);

export const saveTimesheetSchema = z.object({
  timesheetId: z.string().uuid().optional(),
  assignmentId: z.string().uuid(),
  periodStart: dateString,
  periodEnd: dateString,
  entries: z.array(entrySchema).max(62),
});

export const reviewEditSchema = z.object({
  timesheetId: z.string().uuid(),
  note: z.string().min(1, "A note is required").max(1000),
  entries: z.array(entrySchema).max(62),
});

export const reviewActionSchema = z.object({
  timesheetId: z.string().uuid(),
  note: z.string().max(1000).optional(),
});

export const clientSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Name is required").max(200),
  contact_name: z.string().max(200).optional().nullable(),
  contact_email: z
    .string()
    .email("Invalid email")
    .max(200)
    .optional()
    .or(z.literal(""))
    .nullable(),
  billing_period: z.enum(BILLING_PERIODS as [string, ...string[]]),
  payment_terms_days: z.coerce.number().int().min(0).max(365).default(30),
  account_manager_id: z.string().uuid().optional().nullable(),
  billing_address: z.string().max(500).optional().nullable(),
  status: z.enum(["active", "inactive"]).default("active"),
});

export const assignmentSchema = z.object({
  id: z.string().uuid().optional(),
  employee_id: z.string().uuid(),
  client_id: z.string().uuid(),
  title: z.string().max(200).optional().nullable(),
  bill_rate: z.coerce.number().min(0),
  pay_rate: z.coerce.number().min(0),
  currency: z.string().min(3).max(3).default("USD"),
  employment_type: z.enum(["W2", "1099"]),
  overtime_multiplier: z.coerce.number().min(1).max(5).default(1.5),
  billing_period: z.enum(BILLING_PERIODS as [string, ...string[]]),
  vendor: z.string().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  start_date: dateString,
  end_date: dateString.optional().nullable().or(z.literal("")),
  status: z.enum(["active", "ended"]).default("active"),
});

export const changeRateSchema = z.object({
  assignmentId: z.string().uuid(),
  bill_rate: z.coerce.number().min(0),
  pay_rate: z.coerce.number().min(0),
  overtime_multiplier: z.coerce.number().min(1).max(5).default(1.5),
  effective_from: dateString,
});

export const userSchema = z.object({
  id: z.string().uuid().optional(),
  email: z.string().email().max(200),
  full_name: z.string().min(1).max(200),
  role: z.enum(ROLES as [string, ...string[]]),
  status: z.enum(["active", "inactive"]).default("active"),
  password: z.string().min(8).max(72).optional(),
});

export const generateInvoiceSchema = z.object({
  clientId: z.string().uuid(),
  periodStart: dateString,
  periodEnd: dateString,
  timesheetIds: z.array(z.string().uuid()).min(1),
});

export const markInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  status: z.enum(["paid", "void", "sent"]),
});

export const invoiceAdjustmentSchema = z.object({
  invoiceId: z.string().uuid(),
  kind: z.enum(["deduction", "reimbursement"]),
  label: z.string().min(1, "Label is required").max(200),
  amount: z.coerce.number().min(0),
  employeeId: z.string().uuid().optional().nullable(),
});

export const emailTemplateSchema = z.object({
  key: z.string().min(1),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  heading: z.string().trim().min(1, "Heading is required").max(200),
  body: z.string().trim().min(1, "Message is required").max(5000),
  // Required only for emails that have a button; checked in the save action.
  buttonLabel: z.string().trim().max(60),
  footer: z.string().trim().max(2000),
});

export type EntryInput = z.infer<typeof entrySchema>;
export type SaveTimesheetInput = z.infer<typeof saveTimesheetSchema>;
