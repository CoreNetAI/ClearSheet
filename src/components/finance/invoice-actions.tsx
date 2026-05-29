"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, Download, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { markInvoice } from "@/app/(app)/finance/actions";
import type { InvoiceStatus } from "@/lib/types";

export function InvoiceActions({
  invoiceId,
  status,
}: {
  invoiceId: string;
  status: InvoiceStatus;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function mark(next: "paid" | "void" | "sent") {
    setBusy(next);
    const res = await markInvoice(invoiceId, next);
    setBusy(null);
    if (res.ok) {
      toast({ title: `Invoice marked ${next}` });
      router.refresh();
    } else {
      toast({ variant: "destructive", title: res.error });
    }
  }

  const isClosed = status === "paid" || status === "void";

  return (
    <div className="flex flex-wrap gap-2">
      <Tip content="Open/download the client-ready PDF of this invoice.">
        <Button variant="outline" asChild>
          <a href={`/finance/invoices/${invoiceId}/pdf`} target="_blank" rel="noopener noreferrer">
            <Download className="h-4 w-4" />
            Download PDF
          </a>
        </Button>
      </Tip>

      {!isClosed && (
        <>
          {status !== "sent" && (
            <Tip content="Mark the invoice as issued to the client (status → Sent). Does not email it.">
              <Button
                variant="outline"
                onClick={() => mark("sent")}
                disabled={busy !== null}
              >
                {busy === "sent" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Mark sent
              </Button>
            </Tip>
          )}
          <Tip content="Account the invoice as paid (status → Paid). Its timesheets move to paid. Add any deductions/reimbursements first.">
            <Button
              variant="success"
              onClick={() => mark("paid")}
              disabled={busy !== null}
            >
              {busy === "paid" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Mark paid
            </Button>
          </Tip>
          <Tip content="Cancel this invoice (status → Void). Its timesheets return to Approved so they can be re-invoiced.">
            <Button
              variant="destructive"
              onClick={() => mark("void")}
              disabled={busy !== null}
            >
              {busy === "void" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Ban className="h-4 w-4" />
              )}
              Void
            </Button>
          </Tip>
        </>
      )}
    </div>
  );
}
