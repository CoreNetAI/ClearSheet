// Centralized server-side configuration and optional-feature detection.
// Optional integrations are considered "enabled" only when their credentials
// are present; otherwise the UI cleanly disables them (spec §3, §8 Admin).

export const appBaseUrl =
  process.env.APP_BASE_URL?.replace(/\/$/, "") || "http://localhost:3000";

export const defaultTimezone =
  process.env.DEFAULT_TIMEZONE || "America/New_York";

export const firm = {
  name: process.env.FIRM_NAME || "Your Firm LLC",
  address: process.env.FIRM_ADDRESS || "",
  email: process.env.FIRM_EMAIL || "",
  logoUrl: process.env.FIRM_LOGO_URL || "",
};

/**
 * Comma-separated addresses copied on the "Timesheet received" email sent to
 * an employee after they submit. Blank means no CC. Entries that aren't email
 * addresses are reported in `invalid` and never sent to.
 */
export function timesheetReceivedCc(): { valid: string[]; invalid: string[] } {
  const entries = (process.env.TIMESHEET_RECEIVED_CC ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const isEmail = (e: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e);
  return {
    valid: entries.filter(isEmail),
    invalid: entries.filter((e) => !isEmail(e)),
  };
}

/** Optional-feature flags, derived from presence of credentials. */
export const features = {
  email: Boolean(process.env.RESEND_API_KEY),
  stripe: Boolean(process.env.STRIPE_SECRET_KEY),
  quickbooks: Boolean(
    process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET
  ),
} as const;

export type FeatureFlags = typeof features;

export function getPublicFeatureFlags(): FeatureFlags {
  // Safe to expose to the client (booleans only, no secrets).
  return {
    email: features.email,
    stripe: features.stripe,
    quickbooks: features.quickbooks,
  };
}
