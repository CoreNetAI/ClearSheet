"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tip } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatHours, formatMoney } from "@/lib/format";

export interface PayrollRow {
  id: string;
  employeeName: string;
  vendor: string;
  client: string;
  type: string;
  regular: number;
  ot: number;
  payRate: number;
  gross: number;
}

export function PayrollPreview({ rows }: { rows: PayrollRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.employeeName, r.vendor, r.client, r.type]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [rows, query]);

  const grossTotal = filtered.reduce((s, r) => s + r.gross, 0);

  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle>
          Preview · {filtered.length} timesheet{filtered.length === 1 ? "" : "s"}{" "}
          · {formatMoney(grossTotal)} gross
        </CardTitle>
        <Tip content="Narrows the preview below by employee, vendor, client, or type. Note: the CSV/Excel download still covers the whole date range, not this filter.">
          <div className="relative max-w-xs">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by employee, vendor, client…"
              className="pl-8"
            />
          </div>
        </Tip>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-muted-foreground">
            No approved hours in this period.
          </p>
        ) : filtered.length === 0 ? (
          <p className="p-10 text-center text-muted-foreground">
            No rows match your filter.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Regular</TableHead>
                <TableHead className="text-right">OT</TableHead>
                <TableHead className="text-right">Pay rate</TableHead>
                <TableHead className="text-right">Gross</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.employeeName}</TableCell>
                  <TableCell>{r.vendor || "—"}</TableCell>
                  <TableCell>{r.type || "—"}</TableCell>
                  <TableCell>{r.client || "—"}</TableCell>
                  <TableCell className="text-right">
                    {formatHours(r.regular)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatHours(r.ot)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMoney(r.payRate)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMoney(r.gross)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
