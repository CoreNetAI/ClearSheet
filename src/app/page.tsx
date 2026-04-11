import { redirect } from "next/navigation";

import { requireProfile, homePathForRole } from "@/lib/auth";

export default async function HomePage() {
  const profile = await requireProfile();
  // Operators (builder-only) land on an integration page, not their base role's home.
  if (profile.is_operator) redirect("/admin/integrations");
  redirect(homePathForRole(profile.role));
}
