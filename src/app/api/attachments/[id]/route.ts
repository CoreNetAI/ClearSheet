import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { deleteObject } from "@/lib/r2";

// Delete an attachment (employee, own draft timesheet — enforced by RLS).
export async function DELETE(
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

  // Read the key first (RLS-scoped), then delete the row (RLS enforces that
  // only an own-draft attachment can be removed).
  const { data: attachment } = await supabase
    .from("timesheet_attachments")
    .select("id, r2_object_key")
    .eq("id", id)
    .maybeSingle();

  if (!attachment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error, count } = await supabase
    .from("timesheet_attachments")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error || !count) {
    return NextResponse.json(
      { error: "Cannot delete this attachment." },
      { status: 403 }
    );
  }

  await deleteObject(attachment.r2_object_key).catch(() => {});
  return NextResponse.json({ ok: true });
}
