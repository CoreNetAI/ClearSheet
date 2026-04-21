import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { toCsv } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

/**
 * Route-handler role guard. Returns the Supabase client + user id, or a ready
 * 401/403 NextResponse to return directly. (Pages use requireRole(); routes
 * can't redirect, so they need a JSON/HTTP response instead.)
 */
export async function guardRole(
  roles: Role[]
): Promise<
  | { ok: true; supabase: SupabaseClient; userId: string }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !roles.includes(profile.role as Role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, supabase, userId: user.id };
}

export type ExportFormat = "csv" | "xlsx";

/** Reads ?format= from a request URL, defaulting to CSV. */
export function parseFormat(value: string | null): ExportFormat {
  return value === "xlsx" ? "xlsx" : "csv";
}

export type Cell = string | number | null | undefined;

/**
 * Build a downloadable CSV or Excel file response from a header row + data rows.
 * `xlsx` is imported lazily so it only loads when an Excel export is requested.
 */
export async function exportResponse(
  filenameBase: string,
  headers: string[],
  rows: Cell[][],
  format: ExportFormat
): Promise<NextResponse> {
  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Export");
    const buffer = XLSX.write(book, {
      type: "array",
      bookType: "xlsx",
    }) as ArrayBuffer;
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filenameBase}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const csv = toCsv(
    headers,
    rows.map((r) => r.map((c) => (c === undefined ? "" : c)))
  );
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
