import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default function SetPasswordPage() {
  return (
    <AuthCard
      title="Set your password"
      description="Welcome to ClearSheet — choose a strong password to activate your account."
    >
      <ResetPasswordForm markInviteAccepted />
    </AuthCard>
  );
}
