import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import {
  buildObjectKey,
  isR2Configured,
  presignUpload,
  validateUpload,
} from "@/lib/r2";

const bodySchema = z.object({
  timesheetId: z.string().uuid(),
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(1).max(150),
  size: z.number().int().positive(),
  attachmentType: z.enum(["approved_timesheet", "approval_screenshot"]),
});

export async function POST(request: Request) {
  if (!isR2Configured()) {
    return NextResponse.json(
      { error: "File storage is not configured." },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const valid = validateUpload(body.fileName, body.contentType, body.size);
  if (!valid.ok) {
    return NextResponse.json({ error: valid.error }, { status: 400 });
  }

  // RLS: this returns the timesheet only if the caller may see it. We also
  // require they own it and it is still a draft (uploads only on drafts).
  const { data: ts } = await supabase
    .from("timesheets")
    .select("id, employee_id, status")
    .eq("id", body.timesheetId)
    .maybeSingle();

  const isOwnerDraft =
    ts && ts.employee_id === user.id && ts.status === "draft";
  if (!isOwnerDraft) {
    return NextResponse.json(
      { error: "Cannot upload to this timesheet." },
      { status: 403 }
    );
  }

  const key = buildObjectKey(body.timesheetId, body.fileName);
  const url = await presignUpload(key, body.contentType);

  return NextResponse.json({ url, key });
}
