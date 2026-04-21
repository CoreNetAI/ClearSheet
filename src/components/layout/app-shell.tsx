"use client";

import { useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck, Loader2, LogOut, Menu, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS, type Role } from "@/lib/types";
import {
  NAV_BY_ROLE,
  OPERATOR_NAV,
  type NavItem,
} from "@/components/layout/nav-config";

// Renders the icon + label inside a <Link>, swapping the icon for a spinner
// while that link's navigation is pending. `useLinkStatus` must be called from
// a descendant of the <Link>, so it lives in its own component.
function NavLinkContent({ Icon, label }: { Icon: NavItem["icon"]; label: string }) {
  const { pending } = useLinkStatus();
  return (
    <>
      {pending ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      ) : (
        <Icon className="h-4 w-4 shrink-0" />
      )}
      {label}
    </>
  );
}

function NavLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  // Highlight only the most specific matching item, so a parent link like
  // "/admin" doesn't stay active on "/admin/clients".
  const activeHref = items
    .map((i) => i.href)
    .filter((href) => pathname === href || pathname.startsWith(href + "/"))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <nav className="grid gap-1">
      {items.map((item) => {
        const active = item.href === activeHref;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <NavLinkContent Icon={Icon} label={item.label} />
          </Link>
        );
      })}
    </nav>
  );
}

function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <Button
        type="submit"
        variant="ghost"
        className="w-full justify-start text-muted-foreground"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </Button>
    </form>
  );
}

export function AppShell({
  role,
  fullName,
  email,
  periodLabel,
  isOperator = false,
  children,
}: {
  role: Role;
  fullName: string;
  email: string;
  periodLabel: string;
  isOperator?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Operators are a least-privilege builder role: they see ONLY the
  // integration/infra pages, never the customer's operational pages.
  const items = isOperator ? OPERATOR_NAV : NAV_BY_ROLE[role];
  const roleLabel = isOperator ? "Operator" : ROLE_LABELS[role];

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Desktop sidebar — pinned to the viewport so sign-out stays reachable */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex h-16 shrink-0 items-center gap-2 border-b px-6">
          <ClipboardCheck className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold tracking-tight">ClearSheet</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div className="flex-1 overflow-y-auto">
            <NavLinks items={items} pathname={pathname} />
          </div>
          <div className="grid min-w-0 shrink-0 gap-2 border-t pt-4">
            <div className="min-w-0 px-3">
              <p className="truncate text-sm font-medium">{fullName}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
              <Badge variant="secondary" className="mt-1">
                {roleLabel}
              </Badge>
            </div>
            <SignOutButton />
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="flex h-14 items-center justify-between border-b bg-card px-4 md:hidden">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold tracking-tight">ClearSheet</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </header>

      {mobileOpen && (
        <div className="border-b bg-card p-4 md:hidden">
          <NavLinks
            items={items}
            pathname={pathname}
            onNavigate={() => setMobileOpen(false)}
          />
          <div className="mt-4 grid min-w-0 gap-2 border-t pt-4">
            <div className="min-w-0 px-3">
              <p className="truncate text-sm font-medium">{fullName}</p>
              <Badge variant="secondary" className="mt-1">
                {roleLabel}
              </Badge>
            </div>
            <SignOutButton />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        <div className="hidden h-16 items-center justify-end border-b bg-card px-6 md:flex">
          <span className="text-sm text-muted-foreground">{periodLabel}</span>
        </div>
        <main className="flex-1 bg-muted/30 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
