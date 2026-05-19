"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

// Subscribes to Postgres changes on a table and refreshes the current route's
// server components when anything changes. Used for live dashboards that keep
// their period/status logic on the server.
export function RealtimeRefresher({
  channel,
  table = "timesheets",
}: {
  channel: string;
  table?: string;
}) {
  const router = useRouter();
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    const supabase = supabaseRef.current;
    const ch = supabase
      .channel(channel)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => router.refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [channel, table, router]);

  return null;
}
