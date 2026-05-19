import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import {
  ReviewQueue,
  type ReviewQueueItem,
} from "@/components/reviewer/review-queue";

export default async function ReviewerQueuePage() {
  await requireRole("reviewer", "admin");
  const supabase = await createClient();

  const { data } = await supabase
    .from("timesheets")
    .select(
      "id, period_start, period_end, total_regular_hours, total_ot_hours, submitted_at, employee:profiles!employee_id(full_name), assignment:assignments(title, client:clients(name))"
    )
    .eq("status", "submitted")
    .order("submitted_at", { ascending: true });

  const initial = (data ?? []) as unknown as ReviewQueueItem[];

  return (
    <div>
      <PageHeader
        title="Review queue"
        description="Submitted timesheets awaiting verification, oldest first."
      />
      <ReviewQueue initial={initial} />
    </div>
  );
}
