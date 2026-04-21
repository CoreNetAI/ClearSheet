"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, Loader2, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InfoTip, Tip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { ROLES, ROLE_LABELS, type Profile, type Role } from "@/lib/types";

// Role tabs for filtering the list. Account manager is a hidden/legacy role,
// so it isn't offered as its own tab (those users still appear under "All").
const FILTER_ROLES: Role[] = ROLES.filter((r) => r !== "account_manager");
import {
  createUser,
  deleteUser,
  resendInvite,
  updateUser,
} from "@/app/(app)/admin/actions";

export function UsersManager({
  users,
  currentUserId,
}: {
  users: Profile[];
  currentUserId: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [search, setSearch] = useState("");

  // Per-employee history export (date-range dialog → download route).
  const [exportUser, setExportUser] = useState<Profile | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [exportStart, setExportStart] = useState(`${today.slice(0, 4)}-01-01`);
  const [exportEnd, setExportEnd] = useState(today);

  const visibleUsers = users.filter((u) => {
    if (roleFilter !== "all" && u.role !== roleFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [u.full_name, u.email, u.emp_code]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  function openExport(u: Profile) {
    setExportStart(`${today.slice(0, 4)}-01-01`);
    setExportEnd(today);
    setExportUser(u);
  }

  function downloadHistory(format: "csv" | "xlsx") {
    if (!exportUser) return;
    const url =
      `/finance/payroll/employee-export?employeeId=${exportUser.id}` +
      `&start=${exportStart}&end=${exportEnd}&format=${format}`;
    window.location.assign(url);
  }

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [status, setStatus] = useState<"active" | "inactive">("active");

  // Copyable invite-link fallback, shown when email delivery isn't available.
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setEmail("");
    setFullName("");
    setRole("employee");
    setStatus("active");
    setOpen(true);
  }

  function openEdit(u: Profile) {
    setEditing(u);
    setEmail(u.email ?? "");
    setFullName(u.full_name ?? "");
    setRole(u.role);
    setStatus(u.status);
    setOpen(true);
  }

  async function submit() {
    setBusy(true);
    if (editing) {
      const res = await updateUser({
        id: editing.id,
        email,
        full_name: fullName,
        role,
        status,
      });
      setBusy(false);
      if (!res.ok) {
        toast({ variant: "destructive", title: res.error });
        return;
      }
      setOpen(false);
      if (res.data?.invite && !res.data.invite.emailed) {
        // Pending user re-invited, but email delivery is off — share the link.
        toast({
          title: "User updated",
          description: "Email changed — copy the new sign-in link to share.",
        });
        setInviteLink(res.data.invite.inviteUrl);
      } else if (res.data?.emailChanged) {
        toast({
          title: "User updated",
          description: "They've been notified of the new sign-in email.",
        });
      } else {
        toast({ title: "User updated" });
      }
      router.refresh();
      return;
    }

    const res = await createUser({ email, full_name: fullName, role, status });
    setBusy(false);
    if (!res.ok) {
      toast({ variant: "destructive", title: res.error });
      return;
    }
    setOpen(false);
    if (res.data?.emailed) {
      toast({ title: "Invite sent", description: `Emailed to ${email}.` });
    } else if (res.data?.inviteUrl) {
      // Email not configured/delivered — surface the link to share manually.
      toast({ title: "User invited", description: "Copy the invite link to share." });
      setInviteLink(res.data.inviteUrl);
    }
    router.refresh();
  }

  async function onResend(u: Profile) {
    if (!u.email) return;
    setResendingId(u.id);
    const res = await resendInvite({ userId: u.id, email: u.email });
    setResendingId(null);
    if (!res.ok) {
      toast({ variant: "destructive", title: res.error });
      return;
    }
    if (res.data?.emailed) {
      toast({ title: "Invite re-sent", description: `Emailed to ${u.email}.` });
    } else if (res.data?.inviteUrl) {
      toast({ title: "Invite link ready", description: "Copy the link to share." });
      setInviteLink(res.data.inviteUrl);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    const res = await deleteUser({ id: deleting.id });
    setDeleteBusy(false);
    if (!res.ok) {
      toast({ variant: "destructive", title: res.error });
      return;
    }
    toast({ title: "User deleted" });
    setDeleting(null);
    router.refresh();
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ variant: "destructive", title: "Could not copy — select and copy manually." });
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={roleFilter}
          onValueChange={(v) => setRoleFilter(v as "all" | Role)}
        >
          <TabsList className="flex-wrap">
            <TabsTrigger value="all">All ({users.length})</TabsTrigger>
            {FILTER_ROLES.map((r) => (
              <TabsTrigger key={r} value={r}>
                {ROLE_LABELS[r]} ({users.filter((u) => u.role === r).length})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-3">
          <Tip content="Type to filter the list by name, email, or Employee ID. Combines with the role tabs.">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, ID…"
                className="w-48 pl-8 sm:w-56"
              />
            </div>
          </Tip>
          <Tip content="Download the full user list (name, Employee ID, email, role, status) as an Excel file.">
            <Button variant="outline" asChild>
              <a href="/admin/users/export?format=xlsx">
                <Download className="h-4 w-4" />
                Export
              </a>
            </Button>
          </Tip>
          <Tip content="Create an account and email them an invite link to set their own password.">
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" />
              New user
            </Button>
          </Tip>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Employee ID</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleUsers.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No {roleFilter === "all" ? "" : `${ROLE_LABELS[roleFilter]} `}
                    users.
                  </TableCell>
                </TableRow>
              )}
              {visibleUsers.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.full_name ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {u.emp_code ?? "—"}
                  </TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>{ROLE_LABELS[u.role]}</TableCell>
                  <TableCell>
                    {u.invite_status === "pending" ? (
                      <Badge variant="secondary">Pending invite</Badge>
                    ) : (
                      <Badge
                        variant={u.status === "active" ? "success" : "secondary"}
                      >
                        {u.status}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {u.invite_status === "pending" && (
                      <Tip content="Re-send a fresh set-password invite link to this user (their previous link may have expired).">
                        <Button
                          variant="link"
                          size="sm"
                          disabled={resendingId === u.id}
                          onClick={() => onResend(u)}
                        >
                          {resendingId === u.id && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                          Resend invite
                        </Button>
                      </Tip>
                    )}
                    {u.role === "employee" && (
                      <Tip content="Download THIS employee's full timesheet history (and their invoice adjustments) for a date range as CSV/Excel.">
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => openExport(u)}
                        >
                          Export
                        </Button>
                      </Tip>
                    )}
                    <Button variant="link" size="sm" onClick={() => openEdit(u)}>
                      Edit
                    </Button>
                    {u.id !== currentUserId && (
                      <Tip content="Permanently delete this user. Only works if they have no timesheets, assignments, or invoices — otherwise set them inactive instead.">
                        <Button
                          variant="link"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setDeleting(u)}
                        >
                          Delete
                        </Button>
                      </Tip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit user" : "New user"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the user's email, name, role, or status. Changing the email also changes the address they sign in with."
                : "We'll email an invite link so they can set their own password."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="u-name">Full name</Label>
              <Input
                id="u-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="u-email" className="flex items-center gap-1.5">
                Email
                <InfoTip content="The address this person signs in with. Changing it here updates their login and notifies them." />
              </Label>
              <Input
                id="u-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {editing?.emp_code && (
              <div className="grid gap-2">
                <Label htmlFor="u-emp" className="flex items-center gap-1.5">
                  Employee ID
                  <InfoTip content="Auto-generated code (EMP-####) for employees. Read-only; used to match this person across projects and exports." />
                </Label>
                <Input
                  id="u-emp"
                  value={editing.emp_code}
                  disabled
                  readOnly
                  className="font-mono"
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="u-role" className="flex items-center gap-1.5">
                Role
                <InfoTip content="What they can do: Employee submits timesheets; Reviewer approves them; Finance invoices & runs payroll; Admin does everything." />
              </Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger id="u-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.filter((r) => r !== "account_manager").map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="u-status" className="flex items-center gap-1.5">
                Status
                <InfoTip content="Inactive users can't sign in but their history is kept. Use this instead of Delete for anyone with records." />
              </Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as "active" | "inactive")}
              >
                <SelectTrigger id="u-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save" : "Send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!exportUser} onOpenChange={(o) => !o && setExportUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export timesheet history</DialogTitle>
            <DialogDescription>
              Download all of{" "}
              <span className="font-medium">
                {exportUser?.full_name ?? exportUser?.email}
              </span>
              &apos;s timesheets in a date range.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="x-start">Start</Label>
              <Input
                id="x-start"
                type="date"
                value={exportStart}
                onChange={(e) => setExportStart(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="x-end">End</Label>
              <Input
                id="x-end"
                type="date"
                value={exportEnd}
                onChange={(e) => setExportEnd(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => downloadHistory("csv")}>
              <Download className="h-4 w-4" />
              CSV
            </Button>
            <Button onClick={() => downloadHistory("xlsx")}>
              <Download className="h-4 w-4" />
              Excel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user?</DialogTitle>
            <DialogDescription>
              This permanently deletes{" "}
              <span className="font-medium">
                {deleting?.full_name ?? deleting?.email}
              </span>{" "}
              and their login — this can&apos;t be undone. Users with
              timesheets, assignments, or invoice history can&apos;t be deleted;
              deactivate them instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteBusy}
            >
              {deleteBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!inviteLink} onOpenChange={(o) => !o && setInviteLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite link</DialogTitle>
            <DialogDescription>
              Email isn&apos;t configured for delivery yet. Copy this link and
              send it to the user — it lets them set their password and sign in.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={inviteLink ?? ""} onFocus={(e) => e.target.select()} />
            <Button variant="outline" size="icon" onClick={copyInviteLink} aria-label="Copy link">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setInviteLink(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
