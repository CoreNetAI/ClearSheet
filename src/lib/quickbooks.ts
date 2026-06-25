import "server-only";

// QuickBooks Online OAuth 2.0 + Accounting API (fetch-based, no SDK).
// Enabled only when QBO_CLIENT_ID and QBO_CLIENT_SECRET are present.

const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";

export function isQuickBooksEnabled(): boolean {
  return Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET);
}

function redirectUri(): string {
  return (
    process.env.QBO_REDIRECT_URI ||
    "http://localhost:3000/api/integrations/quickbooks/callback"
  );
}

export function apiBase(): string {
  return process.env.QBO_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export function getAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID!,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: redirectUri(),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

function basicAuthHeader(): string {
  const creds = `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(creds).toString("base64")}`;
}

export interface QboTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
}

export async function exchangeCodeForTokens(code: string): Promise<QboTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
    }),
  });
  if (!res.ok) throw new Error(`QBO token exchange failed (${res.status})`);
  return (await res.json()) as QboTokens;
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<QboTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`QBO token refresh failed (${res.status})`);
  return (await res.json()) as QboTokens;
}

async function qboFetch(
  realmId: string,
  accessToken: string,
  path: string,
  init?: RequestInit
) {
  const res = await fetch(`${apiBase()}/v3/company/${realmId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`QBO API ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

/** Find a usable Service item to attach to invoice lines. */
async function getServiceItemId(
  realmId: string,
  accessToken: string
): Promise<string> {
  const data = await qboFetch(
    realmId,
    accessToken,
    `/query?query=${encodeURIComponent(
      "select Id, Type from Item where Type = 'Service' maxresults 1"
    )}&minorversion=65`
  );
  const item = data?.QueryResponse?.Item?.[0];
  if (!item?.Id) throw new Error("No QuickBooks Service item found.");
  return item.Id as string;
}

/** Create a QBO customer; returns its Id. */
export async function createCustomer(
  realmId: string,
  accessToken: string,
  input: { displayName: string; email?: string | null }
): Promise<string> {
  const body: Record<string, unknown> = { DisplayName: input.displayName };
  if (input.email) {
    body.PrimaryEmailAddr = { Address: input.email };
  }
  const data = await qboFetch(realmId, accessToken, `/customer?minorversion=65`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data?.Customer?.Id as string;
}

export interface QboInvoiceLine {
  amount: number;
  description: string;
}

/** Create a QBO invoice; returns its Id. */
export async function createInvoice(
  realmId: string,
  accessToken: string,
  input: {
    customerId: string;
    docNumber: string;
    lines: QboInvoiceLine[];
  }
): Promise<string> {
  const itemId = await getServiceItemId(realmId, accessToken);
  const body = {
    DocNumber: input.docNumber,
    CustomerRef: { value: input.customerId },
    Line: input.lines.map((l) => ({
      DetailType: "SalesItemLineDetail",
      Amount: Number(l.amount.toFixed(2)),
      Description: l.description,
      SalesItemLineDetail: { ItemRef: { value: itemId } },
    })),
  };
  const data = await qboFetch(realmId, accessToken, `/invoice?minorversion=65`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data?.Invoice?.Id as string;
}
