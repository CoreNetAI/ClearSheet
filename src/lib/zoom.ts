import "server-only";

// Minimal Zoom client using a Server-to-Server OAuth app. Needs the scopes
// meeting:write:meeting:admin, meeting:update:meeting:admin and
// meeting:delete:meeting:admin. Meetings are created on the host's account
// (the first meeting conductor).

const API = "https://api.zoom.us/v2";

export function isZoomConfigured(): boolean {
  return Boolean(
    process.env.ZOOM_ACCOUNT_ID &&
      process.env.ZOOM_CLIENT_ID &&
      process.env.ZOOM_CLIENT_SECRET
  );
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.value;
  }
  if (!isZoomConfigured()) throw new Error("Zoom is not configured.");

  const basic = Buffer.from(
    `${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`
  ).toString("base64");
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(
      process.env.ZOOM_ACCOUNT_ID!
    )}`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
      signal: AbortSignal.timeout(15_000),
    }
  );
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    reason?: string;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(
      `Zoom sign-in failed (HTTP ${res.status}): ${body.reason || body.error || "no token"}`
    );
  }
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

export class ZoomError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number
  ) {
    super(message);
  }
  get notFound(): boolean {
    return this.status === 404 || this.code === 3001;
  }
}

async function zoomFetch(path: string, init: RequestInit): Promise<unknown> {
  const token = await accessToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204) return null;
  const body = (await res.json().catch(() => ({}))) as {
    code?: number;
    message?: string;
  };
  if (!res.ok) {
    if (res.status === 401) cachedToken = null;
    const hint = res.status === 429 ? " (Zoom rate limit reached; it will retry)" : "";
    throw new ZoomError(
      `Zoom ${init.method ?? "GET"} failed (HTTP ${res.status}): ${body.message || "unknown error"}${hint}`,
      res.status,
      body.code
    );
  }
  return body;
}

export interface ZoomMeetingInput {
  topic: string;
  startsAt: Date;
  durationMinutes: number;
  timezone: string;
  agenda?: string;
}

function meetingBody(input: ZoomMeetingInput) {
  return {
    topic: input.topic.slice(0, 200),
    type: 2, // scheduled
    // UTC with "Z"; `timezone` only controls how Zoom displays it.
    start_time: input.startsAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    duration: input.durationMinutes,
    timezone: input.timezone,
    agenda: input.agenda?.slice(0, 2000),
  };
}

export async function createZoomMeeting(
  hostEmail: string,
  input: ZoomMeetingInput
): Promise<{ id: string; joinUrl: string }> {
  const body = (await zoomFetch(`/users/${encodeURIComponent(hostEmail)}/meetings`, {
    method: "POST",
    body: JSON.stringify({
      ...meetingBody(input),
      settings: {
        // People wait until the host starts the meeting. No waiting room, so
        // the other conductors don't need to be admitted one by one.
        join_before_host: false,
        waiting_room: false,
        host_video: true,
        participant_video: true,
        approval_type: 2, // no registration
      },
    }),
  })) as { id?: number | string; join_url?: string };
  if (!body?.id || !body.join_url) {
    throw new Error("Zoom created a meeting but returned no join link.");
  }
  return { id: String(body.id), joinUrl: body.join_url };
}

export async function updateZoomMeeting(
  meetingId: string,
  input: ZoomMeetingInput
): Promise<void> {
  await zoomFetch(`/meetings/${encodeURIComponent(meetingId)}`, {
    method: "PATCH",
    body: JSON.stringify(meetingBody(input)),
  });
}

/** Deletes a meeting. A meeting that no longer exists counts as deleted. */
export async function deleteZoomMeeting(meetingId: string): Promise<void> {
  try {
    await zoomFetch(
      `/meetings/${encodeURIComponent(meetingId)}?schedule_for_reminder=false`,
      { method: "DELETE" }
    );
  } catch (e) {
    if (e instanceof ZoomError && e.notFound) return;
    throw e;
  }
}
