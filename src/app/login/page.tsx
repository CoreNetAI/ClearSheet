import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { EmailPasswordForm } from "@/components/auth/email-password-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { Separator } from "@/components/ui/separator";

const ERROR_MESSAGES: Record<string, string> = {
  auth: "Sign-in could not be completed. Please try again.",
  inactive: "Your account is inactive. Contact an administrator.",
  forbidden: "You don't have access to that page.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const error = sp.error ? ERROR_MESSAGES[sp.error] : undefined;

  return (
    <AuthCard
      title="Sign in"
      description="Access your ClearSheet workspace"
      footer={
        <>
          Need an account?{" "}
          <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign up
          </Link>
        </>
      }
    >
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      <OAuthButtons redirectTo={sp.redirectTo} />
      <div className="relative">
        <Separator />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs uppercase text-muted-foreground">
          or
        </span>
      </div>
      <EmailPasswordForm mode="signin" redirectTo={sp.redirectTo} />
    </AuthCard>
  );
}
