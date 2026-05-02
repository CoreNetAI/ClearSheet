import "server-only";
import { AwsClient } from "aws4fetch";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB (spec §3.1)

// fileType -> allowed. Keyed by lowercased extension and validated against the
// declared content type at presign time.
export const ALLOWED_UPLOAD_TYPES: Record<string, string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
};

function uploadsBucket(): string {
  return process.env.R2_UPLOADS_BUCKET || "clearsheet-uploads";
}

function endpoint(): string {
  return (
    process.env.R2_ENDPOINT ||
    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  );
}

// aws4fetch is a tiny SigV4 signer built on fetch + WebCrypto. Unlike the AWS
// SDK it never touches Node's `fs`, so it works on Cloudflare Workers (the SDK
// failed there with "[unenv] fs.readFile is not implemented yet").
function getAwsClient(): AwsClient {
  return new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    region: "auto",
    service: "s3",
  });
}

/**
 * Path-style object URL: https://<acct>.r2.cloudflarestorage.com/<bucket>/<key>
 * Keys are produced by buildObjectKey() and only contain URL-safe characters
 * (sanitized name + UUIDs), so no extra encoding is needed — and adding our own
 * would risk a signature mismatch against aws4fetch's canonicalization.
 */
function objectUrl(key: string): string {
  return `${endpoint()}/${uploadsBucket()}/${key}`;
}

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY
  );
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

export function extOf(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : "";
}

/** Validate a declared upload against allowed types and the size cap. */
export function validateUpload(
  fileName: string,
  contentType: string,
  size: number
): { ok: true } | { ok: false; error: string } {
  if (size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "File exceeds the 10 MB limit." };
  }
  if (size <= 0) {
    return { ok: false, error: "File is empty." };
  }
  const ext = extOf(fileName);
  const allowed = ALLOWED_UPLOAD_TYPES[ext];
  if (!allowed) {
    return { ok: false, error: "Allowed types: PDF, PNG, JPG, XLSX." };
  }
  if (!allowed.includes(contentType)) {
    return { ok: false, error: "File content type does not match extension." };
  }
  return { ok: true };
}

export function buildObjectKey(timesheetId: string, fileName: string): string {
  const safe = sanitizeFileName(fileName);
  return `timesheets/${timesheetId}/${crypto.randomUUID()}-${safe}`;
}

/** Presigned PUT URL the browser uploads to directly (expires in 5 min). */
export async function presignUpload(
  key: string,
  _contentType: string
): Promise<string> {
  const aws = getAwsClient();
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", "300");
  const signed = await aws.sign(url.toString(), {
    method: "PUT",
    aws: { signQuery: true },
  });
  return signed.url;
}

/** Short-lived presigned GET URL for previewing/downloading a stored file. */
export async function presignDownload(
  key: string,
  downloadName?: string
): Promise<string> {
  const aws = getAwsClient();
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", "300");
  if (downloadName) {
    url.searchParams.set(
      "response-content-disposition",
      `inline; filename="${sanitizeFileName(downloadName)}"`
    );
  }
  const signed = await aws.sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true },
  });
  return signed.url;
}

/** Actual byte size of an uploaded object (for post-upload validation). */
export async function headObjectSize(key: string): Promise<number | null> {
  const aws = getAwsClient();
  try {
    const res = await aws.fetch(objectUrl(key), { method: "HEAD" });
    if (!res.ok) return null;
    const len = res.headers.get("content-length");
    return len ? Number(len) : null;
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  const aws = getAwsClient();
  await aws.fetch(objectUrl(key), { method: "DELETE" });
}

/** Total bytes + object count in the uploads bucket (admin storage readout). */
export async function getUploadsUsage(): Promise<{
  bytes: number;
  count: number;
}> {
  const aws = getAwsClient();
  let bytes = 0;
  let count = 0;
  let token: string | undefined;
  do {
    const u = new URL(`${endpoint()}/${uploadsBucket()}`);
    u.searchParams.set("list-type", "2");
    if (token) u.searchParams.set("continuation-token", token);
    const res = await aws.fetch(u.toString(), { method: "GET" });
    if (!res.ok) break;
    const xml = await res.text();
    for (const m of xml.matchAll(/<Size>(\d+)<\/Size>/g)) {
      bytes += Number(m[1]);
      count += 1;
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const next = xml.match(
      /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/
    );
    token = truncated && next ? decodeXmlEntities(next[1]) : undefined;
  } while (token);
  return { bytes, count };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
