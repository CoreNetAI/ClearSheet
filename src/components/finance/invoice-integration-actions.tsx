"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CreditCard, Loader2, Mail, Plug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import type { FeatureFlags } from "@/lib/config";
import {
  createPaymentLink,
  emailInvoice,
  syncInvoiceToQuickBooks,
} from "@/app/(app)/finance/integration-actions";

export function InvoiceIntegrationActions({
  invoiceId,
  features,
  qboConnected,
  hasClientEmail,
  payLink,
  qboInvoiceId,
}: {
  invoiceId: string;
  features: FeatureFlags;
  qboConnected: boolean;
  hasClientEmail: boolean;
  payLink: string | null;
  qboInvoiceId: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(payLink);

  if (!features.email && !features.stripe && !features.quickbooks) return null;

  async function doEmail() {
    setBusy("email");
    const res = await emailInvoice(invoiceId);
    setBusy(null);
    if (res.ok) {
      toast({ title: "Invoice emailed" });
      router.refresh();
    } else {
      toast({ variant: "destructive", title: res.error });
    }
  }

  async function doPayLink() {
    setBusy("pay");
    const res = await createPaymentLink(invoiceId);
    setBusy(null);
    if (res.ok && res.data) {
      setLink(res.data.url);
      toast({ title: "Payment link created" });
    } else if (!res.ok) {
      toast({ variant: "destructive", title: res.error });
    }
  }

  async function doQbo() {
    setBusy("qbo");
    const res = await syncInvoiceToQuickBooks(invoiceId);
    setBusy(null);
    if (res.ok) {
      toast({ title: "Synced to QuickBooks" });
      router.refresh();
    } else {
      toast({ variant: "destructive", title: res.error });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {features.email && (
        <Button
          variant="outline"
          onClick={doEmail}
          disabled={busy !== null || !hasClientEmail}
          title={hasClientEmail ? undefined : "Client has no contact email"}
        >
          {busy === "email" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Mail className="h-4 w-4" />
          )}
          Email invoice
        </Button>
      )}

      {features.stripe &&
        (link ? (
          <Button variant="outline" asChild>
            <a href={link} target="_blank" rel="noopener noreferrer">
              <CreditCard className="h-4 w-4" />
              Open pay link
            </a>
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={doPayLink}
            disabled={busy !== null}
          >
            {busy === "pay" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CreditCard className="h-4 w-4" />
            )}
            Create pay link
          </Button>
        ))}

      {features.quickbooks &&
        (qboInvoiceId ? (
          <Button variant="outline" disabled>
            <CheckCircle2 className="h-4 w-4 text-success" />
            Synced to QBO
          </Button>
        ) : qboConnected ? (
          <Button variant="outline" onClick={doQbo} disabled={busy !== null}>
            {busy === "qbo" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plug className="h-4 w-4" />
            )}
            Sync to QuickBooks
          </Button>
        ) : null)}
    </div>
  );
}
