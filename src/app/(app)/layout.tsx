import { requireProfile } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { defaultTimezone } from "@/lib/config";
import { getCurrentPeriod, formatPeriodLabel } from "@/lib/periods";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const period = getCurrentPeriod("weekly", defaultTimezone);
  const periodLabel = `Current week: ${formatPeriodLabel(period)}`;

  return (
    <AppShell
      role={profile.role}
      fullName={profile.full_name || profile.email || "User"}
      email={profile.email || ""}
      periodLabel={periodLabel}
      isOperator={profile.is_operator}
    >
      {children}
    </AppShell>
  );
}
