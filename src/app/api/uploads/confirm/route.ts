import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { deleteObject, headObjectSize, MAX_UPLOAD_BYTES } from "@/lib/r2";

const bodySchema = z.object({
  timesheetId: z.string().uuid(),
  key: z.string().min(1).max(500),
  fileName: z.string().min(1).max(200),
  attachmentType: z.enum(["approved_timesheet", "approval_screenshot"]),
});

export async function POST(request: Request) {
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

  // The object key must belong to this timesheet's prefix.
  if (!body.key.startsWith(`timesheets/${body.timesheetId}/`)) {
    return NextResponse.json({ error: "Invalid object key" }, { status: 400 });
  }

  // Verify the uploaded object exists and is within the size cap.
  const size = await headObjectSize(body.key);
  if (size === null) {
    return NextResponse.json(
      { error: "Upload was not found in storage." },
      { status: 400 }
    );
  }
  if (size > MAX_UPLOAD_BYTES) {
    await deleteObject(body.key).catch(() => {});
    return NextResponse.json(
      { error: "File exceeds the 10 MB limit." },
      { status: 400 }
    );
  }

  // Insert metadata under the caller's RLS (own draft timesheet only). If the
  // row insert is rejected, clean up the orphaned object.
  const { data, error } = await supabase
    .from("timesheet_attachments")
    .insert({
      timesheet_id: body.timesheetId,
      r2_object_key: body.key,
      file_name: body.fileName,
      attachment_type: body.attachmentType,
    })
    .select("id, file_name, attachment_type, uploaded_at")
    .single();

  if (error) {
    await deleteObject(body.key).catch(() => {});
    return NextResponse.json(
      { error: "Could not save attachment." },
      { status: 403 }
    );
  }

  return NextResponse.json({ attachment: data });
}
