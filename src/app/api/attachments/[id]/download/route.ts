import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { presignDownload } from "@/lib/r2";

// Returns a 302 redirect to a short-lived presigned R2 URL. RLS ensures the
// caller can only fetch attachments on timesheets they're allowed to see.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: attachment } = await supabase
    .from("timesheet_attachments")
    .select("r2_object_key, file_name")
    .eq("id", id)
    .maybeSingle();

  if (!attachment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = await presignDownload(
    attachment.r2_object_key,
    attachment.file_name || undefined
  );
  return NextResponse.redirect(url);
}
