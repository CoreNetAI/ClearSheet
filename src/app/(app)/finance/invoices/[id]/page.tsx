import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronDown } from "lucide-react";

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { formatDate, formatDateTime, formatHours, formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InvoiceStatusBadge } from "@/components/status-badge";
import { InvoiceActions } from "@/components/finance/invoice-actions";
import { InvoiceIntegrationActions } from "@/components/finance/invoice-integration-actions";
import { InvoiceAdjustments } from "@/components/finance/invoice-adjustments";
import { getPublicFeatureFlags } from "@/lib/config";
import type {
  Client,
  Invoice,
  InvoiceAdjustment,
  InvoiceLineItem,
  Payment,
} from "@/lib/types";

// Friendly labels for the invoice lifecycle events recorded in audit_log.
// "accounted" is the customer's term for marking an invoice paid.
const AUDIT_LABELS: Record<string, string> = {
  generate: "Generated",
  mark_sent: "Sent",
  mark_paid: "Marked paid (accounted)",
  mark_void: "Voided",
};

function auditLabel(action: string): string {
  return AUDIT_LABELS[action] ?? action.replace(/_/g, " ");
}

type AuditEntry = {
  id: string;
  action: string;
  created_at: string;
  actor: { full_name: string | null; email: string | null } | null;
};

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireRole("finance", "admin");
  const supabase = await createClient();

  const { data } = await supabase
    .from("invoices")
    .select(
      "*, client:clients(*), line_items:invoice_line_items(*), payments:payments(*), adjustments:invoice_adjustments(*)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  const invoice = data as Invoice & {
    client: Client | null;
    line_items: InvoiceLineItem[];
    payments: Payment[];
    adjustments: InvoiceAdjustment[];
  };

  const lineItems = invoice.line_items ?? [];
  const payments = invoice.payments ?? [];
  const adjustments = invoice.adjustments ?? [];

  // Employees on this invoice (from its timesheets) — for tagging an adjustment
  // to a specific person so payroll can apply it correctly.
  const tsIds = lineItems
    .map((li) => li.timesheet_id)
    .filter((x): x is string => Boolean(x));
  const employeeOptions: { id: string; name: string }[] = [];
  if (tsIds.length) {
    const { data: tsEmp } = await supabase
      .from("timesheets")
      .select("employee_id, employee:profiles!employee_id(full_name)")
      .in("id", tsIds);
    const seen = new Set<string>();
    for (const t of (tsEmp ?? []) as unknown as {
      employee_id: string;
      employee: { full_name: string | null } | null;
    }[]) {
      if (t.employee_id && !seen.has(t.employee_id)) {
        seen.add(t.employee_id);
        employeeOptions.push({
          id: t.employee_id,
          name: t.employee?.full_name ?? "—",
        });
      }
    }
  }

  const features = getPublicFeatureFlags();
  const { data: qboConn } = await supabase
    .from("integration_connections")
    .select("status")
    .eq("provider", "quickbooks")
    .maybeSingle();
  const qboConnected = qboConn?.status === "connected";

  // Invoice audit trail (who generated/sent/accounted it). audit_log is
  // admin-only under RLS, so read it with the service client to also show
  // finance users the trail for this invoice they can already view.
  const { data: auditData } = await createServiceClient()
    .from("audit_log")
    .select("id, action, created_at, actor:profiles!actor_id(full_name, email)")
    .eq("entity_type", "invoice")
    .eq("entity_id", id)
    .order("created_at", { ascending: true });
  const auditTrail = (auditData ?? []) as unknown as AuditEntry[];

  return (
    <div>
      <PageHeader
        title={invoice.invoice_number}
        description={`${invoice.client?.name ?? "Client"} · ${formatDate(
          invoice.period_start
        )} – ${formatDate(invoice.period_end)}`}
        actions={
          <div className="flex items-center gap-2">
            <InvoiceStatusBadge status={invoice.status} />
            <Button variant="outline" size="sm" asChild>
              <Link href="/finance/invoices">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Link>
            </Button>
          </div>
        }
      />

      <div className="mb-6 flex flex-col gap-3">
        <InvoiceActions invoiceId={invoice.id} status={invoice.status} />
        <InvoiceIntegrationActions
          invoiceId={invoice.id}
          features={features}
          qboConnected={qboConnected}
          hasClientEmail={Boolean(invoice.client?.contact_email)}
          payLink={invoice.stripe_payment_link}
          qboInvoiceId={invoice.quickbooks_invoice_id}
        />
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Line items</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Assignment</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineItems.map((li) => (
                  <TableRow key={li.id}>
                    <TableCell className="font-medium">
                      {li.employee_name ?? "—"}
                    </TableCell>
                    <TableCell>{li.assignment_title ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {formatHours(li.hours)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(li.bill_rate)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(li.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end border-t p-4">
              <div className="grid w-56 gap-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatMoney(invoice.subtotal)}</span>
                </div>
                <div className="flex justify-between text-base font-bold">
                  <span>Total</span>
                  <span>{formatMoney(invoice.total)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <InvoiceAdjustments
          invoiceId={invoice.id}
          invoiceTotal={Number(invoice.total)}
          adjustments={adjustments}
          employees={employeeOptions}
          editable={invoice.status !== "void"}
        />

        {payments.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="capitalize">{p.provider}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.provider_payment_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoney(p.amount)}
                      </TableCell>
                      <TableCell className="capitalize">{p.status}</TableCell>
                      <TableCell>{formatDateTime(p.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {auditTrail.length > 0 && (
          <Card>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between p-6 font-semibold [&::-webkit-details-marker]:hidden">
                <span>Audit trail</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>By</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditTrail.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="capitalize">
                          {auditLabel(a.action)}
                        </TableCell>
                        <TableCell>
                          {a.actor?.full_name ?? a.actor?.email ?? "System"}
                        </TableCell>
                        <TableCell>{formatDateTime(a.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          </Card>
        )}
      </div>
    </div>
  );
}
