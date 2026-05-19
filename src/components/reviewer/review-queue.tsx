"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { formatDate, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface ReviewQueueItem {
  id: string;
  period_start: string;
  period_end: string;
  total_regular_hours: number;
  total_ot_hours: number;
  submitted_at: string | null;
  employee: { full_name: string | null } | null;
  assignment: {
    title: string | null;
    client: { name: string } | null;
  } | null;
}

const SELECT =
  "id, period_start, period_end, total_regular_hours, total_ot_hours, submitted_at, employee:profiles!employee_id(full_name), assignment:assignments(title, client:clients(name))";

export function ReviewQueue({ initial }: { initial: ReviewQueueItem[] }) {
  const [items, setItems] = useState<ReviewQueueItem[]>(initial);
  const supabaseRef = useRef(createClient());

  const refetch = useCallback(async () => {
    const { data } = await supabaseRef.current
      .from("timesheets")
      .select(SELECT)
      .eq("status", "submitted")
      .order("submitted_at", { ascending: true });
    if (data) setItems(data as unknown as ReviewQueueItem[]);
  }, []);

  useEffect(() => {
    const supabase = supabaseRef.current;
    const channel = supabase
      .channel("review-queue")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "timesheets" },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
        </span>
        <span className="text-sm text-muted-foreground">Live</span>
        <Badge variant={items.length ? "warning" : "secondary"}>
          {items.length} pending
        </Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <p className="p-10 text-center text-muted-foreground">
              Nothing waiting for review. New submissions appear here instantly.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      {t.employee?.full_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      {t.assignment?.client?.name ?? "—"}
                    </TableCell>
                    <TableCell>
                      {formatDate(t.period_start)} – {formatDate(t.period_end)}
                    </TableCell>
                    <TableCell className="text-right">
                      {t.total_regular_hours}
                      {Number(t.total_ot_hours) > 0
                        ? ` + ${t.total_ot_hours} OT`
                        : ""}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(t.submitted_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" asChild>
                        <Link href={`/reviewer/${t.id}`}>
                          Open
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
