"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/use-toast";

export function EmailPasswordForm({
  mode,
  redirectTo,
}: {
  mode: "signin" | "signup";
  redirectTo?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setLoading(false);
        toast({
          variant: "destructive",
          title: "Sign-in failed",
          description: error.message,
        });
        return;
      }
      router.push(redirectTo || "/");
      router.refresh();
      return;
    }

    // signup
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);
    if (error) {
      toast({
        variant: "destructive",
        title: "Sign-up failed",
        description: error.message,
      });
      return;
    }
    if (data.session) {
      router.push("/");
      router.refresh();
    } else {
      toast({
        title: "Check your email",
        description: "Confirm your address to finish creating your account.",
      });
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      {mode === "signup" && (
        <div className="grid gap-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            required
          />
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          {mode === "signin" && (
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          )}
        </div>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          minLength={8}
          required
        />
      </div>
      <Button type="submit" disabled={loading} className="w-full">
        {loading
          ? "Please wait…"
          : mode === "signin"
            ? "Sign in"
            : "Create account"}
      </Button>
    </form>
  );
}
