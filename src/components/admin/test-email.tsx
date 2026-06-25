"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { sendTestEmail } from "@/app/(app)/admin/actions";

export function TestEmail() {
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    const res = await sendTestEmail(to);
    setBusy(false);
    if (res.ok) {
      toast({ title: "Test email sent", description: `Sent to ${to}` });
    } else {
      toast({ variant: "destructive", title: res.error });
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        type="email"
        placeholder="you@example.com"
        value={to}
        onChange={(e) => setTo(e.target.value)}
      />
      <Button onClick={send} disabled={busy || !to} variant="outline">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        Send test
      </Button>
    </div>
  );
}
