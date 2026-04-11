import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <AuthCard
      title="Set a new password"
      description="Choose a strong password you don't use elsewhere."
    >
      <ResetPasswordForm />
    </AuthCard>
  );
}
