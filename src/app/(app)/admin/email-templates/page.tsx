import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import {
  EmailTemplatesManager,
  type SavedEmailTemplate,
} from "@/components/admin/email-templates-manager";

export default async function AdminEmailTemplatesPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const { data } = await supabase
    .from("email_templates")
    .select(
      "key, subject, heading, body, button_label, footer, updated_at, editor:profiles!updated_by(full_name)"
    );

  return (
    <div>
      <PageHeader
        title="Email Templates"
        description="View and customize the emails ClearSheet sends."
      />
      <EmailTemplatesManager
        saved={(data ?? []) as unknown as SavedEmailTemplate[]}
      />
    </div>
  );
}
