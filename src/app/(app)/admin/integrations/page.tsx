import { Plug } from "lucide-react";

import { requireOperator } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { features } from "@/lib/config";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TestEmail } from "@/components/admin/test-email";
import { QuickBooksDisconnect } from "@/components/finance/quickbooks-connect";

function StatusBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Badge variant="success">Enabled</Badge>
  ) : (
    <Badge variant="secondary">Disabled</Badge>
  );
}

export default async function AdminIntegrationsPage() {
  await requireOperator();
  const supabase = await createClient();

  const { data: qboConn } = await supabase
    .from("integration_connections")
    .select("status, realm_id")
    .eq("provider", "quickbooks")
    .maybeSingle();
  const qboConnected = qboConn?.status === "connected";

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Optional features activate automatically when their credentials are present."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-2">
              Email (Resend)
              <StatusBadge enabled={features.email} />
            </CardTitle>
            <CardDescription>Transactional invoice emails.</CardDescription>
          </CardHeader>
          <CardContent>
            {features.email ? (
              <TestEmail />
            ) : (
              <p className="text-sm text-muted-foreground">
                Set RESEND_API_KEY and FROM_EMAIL to enable invoice emailing.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-2">
              Payments (Stripe)
              <StatusBadge enabled={features.stripe} />
            </CardTitle>
            <CardDescription>
              Hosted Checkout + webhook (PCI SAQ-A).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {features.stripe
                ? "Stripe is configured. Webhook endpoint: /api/webhooks/stripe"
                : "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to enable card payments."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-2">
              QuickBooks Online
              <div className="flex items-center gap-2">
                <StatusBadge enabled={features.quickbooks} />
                {features.quickbooks && qboConnected && (
                  <Badge variant="success">Connected</Badge>
                )}
              </div>
            </CardTitle>
            <CardDescription>Sync invoices to QuickBooks.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {!features.quickbooks ? (
              <p className="text-sm text-muted-foreground">
                Set QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, and
                QBO_ENVIRONMENT to enable.
              </p>
            ) : qboConnected ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Realm {qboConn?.realm_id}
                </p>
                <QuickBooksDisconnect />
              </>
            ) : (
              <Button asChild>
                <a href="/api/integrations/quickbooks/connect">
                  <Plug className="h-4 w-4" />
                  Connect QuickBooks
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
