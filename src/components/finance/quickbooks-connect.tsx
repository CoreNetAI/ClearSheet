"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { disconnectQuickBooks } from "@/app/(app)/finance/integration-actions";

export function QuickBooksDisconnect() {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    const res = await disconnectQuickBooks();
    setBusy(false);
    if (res.ok) {
      toast({ title: "QuickBooks disconnected" });
      router.refresh();
    } else {
      toast({ variant: "destructive", title: res.error });
    }
  }

  return (
    <Button variant="outline" onClick={disconnect} disabled={busy}>
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Unplug className="h-4 w-4" />
      )}
      Disconnect
    </Button>
  );
}
