import { requireOperator } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isR2Configured, getUploadsUsage } from "@/lib/r2";
import { formatBytes } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

const DB_CAP = 500 * 1024 * 1024; // 500 MB Supabase free tier
const R2_CAP = 10 * 1024 * 1024 * 1024; // 10 GB R2 free tier

function UsageBar({ used, cap }: { used: number; cap: number }) {
  const pct = Math.min(100, Math.round((used / cap) * 100));
  const danger = pct >= 85;
  return (
    <div className="mt-3">
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${danger ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{pct}% of cap</p>
    </div>
  );
}

export default async function StoragePage() {
  await requireOperator();
  const supabase = await createClient();

  const { data: dbBytes } = await supabase.rpc("db_size_bytes");
  const dbUsed = Number(dbBytes ?? 0);

  let r2Used = 0;
  let r2Count = 0;
  let r2Ok = isR2Configured();
  if (r2Ok) {
    try {
      const usage = await getUploadsUsage();
      r2Used = usage.bytes;
      r2Count = usage.count;
    } catch {
      r2Ok = false;
    }
  }

  const [{ count: tsCount }, { count: attCount }, { count: invCount }] =
    await Promise.all([
      supabase.from("timesheets").select("id", { count: "exact", head: true }),
      supabase
        .from("timesheet_attachments")
        .select("id", { count: "exact", head: true }),
      supabase.from("invoices").select("id", { count: "exact", head: true }),
    ]);

  return (
    <div>
      <PageHeader
        title="Storage usage"
        description="Free-tier capacity for the database and file storage."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Database</CardTitle>
            <CardDescription>Supabase Postgres · 500 MB cap</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatBytes(dbUsed)}{" "}
              <span className="text-base font-normal text-muted-foreground">
                / {formatBytes(DB_CAP)}
              </span>
            </p>
            <UsageBar used={dbUsed} cap={DB_CAP} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>File storage (R2)</CardTitle>
            <CardDescription>Cloudflare R2 · 10 GB cap</CardDescription>
          </CardHeader>
          <CardContent>
            {r2Ok ? (
              <>
                <p className="text-2xl font-bold">
                  {formatBytes(r2Used)}{" "}
                  <span className="text-base font-normal text-muted-foreground">
                    / {formatBytes(R2_CAP)}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {r2Count} object{r2Count === 1 ? "" : "s"}
                </p>
                <UsageBar used={r2Used} cap={R2_CAP} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                R2 is not configured. Add R2 credentials to enable uploads and
                this readout.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Timesheets</p>
            <p className="mt-1 text-2xl font-bold">{tsCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Attachments</p>
            <p className="mt-1 text-2xl font-bold">{attCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Invoices</p>
            <p className="mt-1 text-2xl font-bold">{invCount ?? 0}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
