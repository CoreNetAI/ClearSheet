import {
  Building2,
  Briefcase,
  CalendarClock,
  CheckCheck,
  ClipboardCheck,
  DollarSign,
  FileText,
  HardDrive,
  LayoutDashboard,
  ListChecks,
  Mail,
  Plug,
  Receipt,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/lib/types";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  employee: [
    { label: "Dashboard", href: "/employee", icon: LayoutDashboard },
    { label: "My Timesheets", href: "/employee/timesheets", icon: FileText },
  ],
  reviewer: [
    { label: "Review Queue", href: "/reviewer", icon: ClipboardCheck },
    { label: "History", href: "/reviewer/history", icon: ListChecks },
  ],
  finance: [
    { label: "Approved Hours", href: "/finance", icon: ClipboardCheck },
    { label: "Invoices", href: "/finance/invoices", icon: Receipt },
    { label: "Payroll", href: "/finance/payroll", icon: DollarSign },
  ],
  account_manager: [
    { label: "Overview", href: "/account-manager", icon: LayoutDashboard },
  ],
  // Admin is the universal superset: its own setup pages PLUS everything a
  // reviewer, finance, and account manager can do.
  admin: [
    { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
    // Reviewer
    { label: "Review Queue", href: "/reviewer", icon: ClipboardCheck },
    { label: "History", href: "/reviewer/history", icon: ListChecks },
    // Finance
    { label: "Approved Hours", href: "/finance", icon: CheckCheck },
    { label: "Invoices", href: "/finance/invoices", icon: Receipt },
    { label: "Payroll", href: "/finance/payroll", icon: DollarSign },
    // Admin setup
    { label: "Users", href: "/admin/users", icon: Users },
    { label: "Clients", href: "/admin/clients", icon: Building2 },
    { label: "Assignments", href: "/admin/assignments", icon: Briefcase },
    { label: "Meetings", href: "/admin/meetings", icon: CalendarClock },
    { label: "Email Templates", href: "/admin/email-templates", icon: Mail },
  ],
};

// Builder-only nav, appended for operators (is_operator). Never shown to a plain
// admin or the customer — these pages own infra + integration setup.
export const OPERATOR_NAV: NavItem[] = [
  { label: "Integrations", href: "/admin/integrations", icon: Plug },
  { label: "Storage", href: "/admin/storage", icon: HardDrive },
];
