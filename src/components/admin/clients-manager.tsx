"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useToast } from "@/components/ui/use-toast";
import { InfoTip, Tip } from "@/components/ui/tooltip";
import { BILLING_PERIODS, type BillingPeriod, type Client } from "@/lib/types";
import { upsertClient } from "@/app/(app)/admin/actions";

type ClientRow = Client & { account_manager: { full_name: string | null } | null };

const NONE = "__none__";

export function ClientsManager({
  clients,
}: {
  clients: ClientRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">(
    "all"
  );

  const visibleClients = clients.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [c.name, c.contact_name, c.contact_email]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("weekly");
  const [paymentTermsDays, setPaymentTermsDays] = useState(30);
  const [amId, setAmId] = useState<string>(NONE);
  const [billingAddress, setBillingAddress] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");

  function openNew() {
    setEditing(null);
    setName("");
    setContactName("");
    setContactEmail("");
    setBillingPeriod("weekly");
    setPaymentTermsDays(30);
    setAmId(NONE);
    setBillingAddress("");
    setStatus("active");
    setOpen(true);
  }

  function openEdit(c: ClientRow) {
    setEditing(c);
    setName(c.name);
    setContactName(c.contact_name ?? "");
    setContactEmail(c.contact_email ?? "");
    setBillingPeriod((c.billing_period ?? "weekly") as BillingPeriod);
    setPaymentTermsDays(c.payment_terms_days ?? 30);
    setAmId(c.account_manager_id ?? NONE);
    setBillingAddress(c.billing_address ?? "");
    setStatus(c.status);
    setOpen(true);
  }

  async function submit() {
    setBusy(true);
    const res = await upsertClient({
      id: editing?.id,
      name,
      contact_name: contactName,
      contact_email: contactEmail,
      billing_period: billingPeriod,
      payment_terms_days: paymentTermsDays,
      account_manager_id: amId === NONE ? null : amId,
      billing_address: billingAddress,
      status,
    });
    setBusy(false);
    if (res.ok) {
      toast({ title: editing ? "Client updated" : "Client created" });
      setOpen(false);
      router.refresh();
    } else {
      toast({ variant: "destructive", title: res.error });
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Tip content="Type to filter the list below by client name, contact name, or email.">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clients…"
                className="w-44 pl-8 sm:w-56"
              />
            </div>
          </Tip>
          <Select
            value={statusFilter}
            onValueChange={(v) =>
              setStatusFilter(v as "all" | "active" | "inactive")
            }
          >
            <Tip content="Show only Active or only Inactive clients (or All).">
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
            </Tip>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Tip content="Download all clients (name, contact, billing period, payment terms, address, status) as an Excel file.">
            <Button variant="outline" asChild>
              <a href="/admin/clients/export?format=xlsx">
                <Download className="h-4 w-4" />
                Export
              </a>
            </Button>
          </Tip>
          <Tip content="Add a new client company you bill for.">
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" />
              New client
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
                <TableHead>Billing</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleClients.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No clients match your filter.
                  </TableCell>
                </TableRow>
              )}
              {visibleClients.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="capitalize">
                    {c.billing_period ?? "—"}
                  </TableCell>
                  <TableCell>{c.contact_email ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="link" size="sm" onClick={() => openEdit(c)}>
                      Edit
                    </Button>
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
            <DialogTitle>{editing ? "Edit client" : "New client"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="c-name">Name</Label>
              <Input
                id="c-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="c-contact">Contact name</Label>
                <Input
                  id="c-contact"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="c-email">Contact email</Label>
                <Input
                  id="c-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="c-period" className="flex items-center gap-1.5">
                  Billing period
                  <InfoTip content={'How often you send this client a bill — the work window each invoice covers. Example: "We send the client a bill every 2 weeks." (frequency / the work window)'} />
                </Label>
                <Select
                  value={billingPeriod}
                  onValueChange={(v) => setBillingPeriod(v as BillingPeriod)}
                >
                  <SelectTrigger id="c-period">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BILLING_PERIODS.map((p) => (
                      <SelectItem key={p} value={p} className="capitalize">
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="c-terms" className="flex items-center gap-1.5">
                  Payment terms (net days)
                  <InfoTip content={'How long the client has to pay after a bill is sent. Example: "…and each bill is due 30 days after we send it." (time to pay). Sets the invoice due date.'} />
                </Label>
                <Input
                  id="c-terms"
                  type="number"
                  min={0}
                  max={365}
                  value={paymentTermsDays}
                  onChange={(e) =>
                    setPaymentTermsDays(Number(e.target.value) || 0)
                  }
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="c-addr">Billing address</Label>
              <Textarea
                id="c-addr"
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="c-status" className="flex items-center gap-1.5">
                Status
                <InfoTip content="Active clients can be assigned and invoiced. Inactive hides them from new assignments but keeps their history." />
              </Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as "active" | "inactive")}
              >
                <SelectTrigger id="c-status">
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
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
