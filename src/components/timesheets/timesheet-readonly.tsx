import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatHours, formatMoney, formatDate } from "@/lib/format";
import { formatDayShort, weekdayShort } from "@/lib/periods";
import type {
  EntryType,
  TimesheetAttachment,
} from "@/lib/types";

const TYPE_LABEL: Record<EntryType, string> = {
  regular: "Regular",
  overtime: "Overtime",
  holiday: "Holiday",
  pto: "PTO",
};

export function TimesheetReadOnly({
  entries,
  attachments,
  totals,
  currency,
  showAmounts = true,
}: {
  entries: { work_date: string; hours: number; entry_type: EntryType }[];
  attachments: Pick<
    TimesheetAttachment,
    "id" | "file_name" | "attachment_type" | "uploaded_at"
  >[];
  totals: {
    totalRegularHours: number;
    totalOtHours: number;
    billAmount: number;
    payAmount: number;
  };
  currency: string;
  // Employees don't see bill/pay amounts — only reviewers/finance/admin do.
  showAmounts?: boolean;
}) {
  const sorted = [...entries].sort((a, b) =>
    a.work_date.localeCompare(b.work_date)
  );

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Hours</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sorted.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No hours recorded.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="p-3 font-medium">Day</th>
                    <th className="p-3 font-medium">Type</th>
                    <th className="p-3 text-right font-medium">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((e, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="whitespace-nowrap p-3">
                        <span className="font-medium">
                          {weekdayShort(e.work_date)}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {formatDayShort(e.work_date)}
                        </span>
                      </td>
                      <td className="p-3">{TYPE_LABEL[e.entry_type]}</td>
                      <td className="p-3 text-right">{formatHours(e.hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Totals</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row
              label="Regular hours"
              value={`${formatHours(totals.totalRegularHours)}h`}
            />
            <Row
              label="Overtime hours"
              value={`${formatHours(totals.totalOtHours)}h`}
            />
            {showAmounts && (
              <>
                <Row
                  label="Bill amount"
                  value={formatMoney(totals.billAmount, currency)}
                />
                <Row
                  label="Pay amount"
                  value={formatMoney(totals.payAmount, currency)}
                />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Attachments</CardTitle>
            <CardDescription>Client-approved proof.</CardDescription>
          </CardHeader>
          <CardContent>
            {attachments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No files.</p>
            ) : (
              <ul className="grid gap-2">
                {attachments.map((a) => (
                  <li
                    key={a.id}
                    className="flex min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {a.file_name || "file"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(a.uploaded_at.slice(0, 10))}
                      </span>
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      Approved
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
