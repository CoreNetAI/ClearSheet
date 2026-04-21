// Display formatting helpers (money, hours, dates).

export function formatMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(Number(amount) || 0);
}

export function formatHours(hours: number): string {
  const n = Number(hours) || 0;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Jan 6, 2025" from a yyyy-MM-dd date string (no timezone shift). */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Human-readable bytes, e.g. "12.4 MB". */
export function formatBytes(bytes: number): string {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let val = b / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

/** "Jan 6, 2025, 3:14 PM" from an ISO timestamp. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
