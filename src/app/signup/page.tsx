import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { EmailPasswordForm } from "@/components/auth/email-password-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { Separator } from "@/components/ui/separator";

export default function SignupPage() {
  return (
    <AuthCard
      title="Create account"
      description="New accounts start as Employee. An admin can adjust your role."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <OAuthButtons />
      <div className="relative">
        <Separator />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs uppercase text-muted-foreground">
          or
        </span>
      </div>
      <EmailPasswordForm mode="signup" />
    </AuthCard>
  );
}
