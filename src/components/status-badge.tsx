import { Badge } from "@/components/ui/badge";
import type { InvoiceStatus, TimesheetStatus } from "@/lib/types";

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "warning"
  | "outline";

const TIMESHEET_VARIANT: Record<TimesheetStatus, BadgeVariant> = {
  draft: "secondary",
  submitted: "warning",
  approved: "success",
  invoiced: "default",
  paid: "success",
};

const TIMESHEET_LABEL: Record<TimesheetStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  invoiced: "Invoiced",
  paid: "Paid",
};

const INVOICE_VARIANT: Record<InvoiceStatus, BadgeVariant> = {
  draft: "secondary",
  sent: "warning",
  paid: "success",
  void: "destructive",
};

export function TimesheetStatusBadge({ status }: { status: TimesheetStatus }) {
  return (
    <Badge variant={TIMESHEET_VARIANT[status]}>{TIMESHEET_LABEL[status]}</Badge>
  );
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <Badge variant={INVOICE_VARIANT[status]} className="capitalize">
      {status}
    </Badge>
  );
}
