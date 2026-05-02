// Client-side parsing of an uploaded timesheet spreadsheet into per-day hours.
// Best-effort: client timesheets vary, so the result is always shown to the
// user for confirmation before it touches the grid. `xlsx` is dynamically
// imported so it is only loaded when someone actually imports a file.

export interface ImportRow {
  date: string; // yyyy-MM-dd, always one of the period days
  regular: number;
  overtime: number;
  holiday: number;
  pto: number;
}

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function localISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function utcISO(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toNumber(cell: unknown): number {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : 0;
  if (typeof cell === "string") {
    const n = parseFloat(cell.replace(/[^0-9.\-]/g, ""));
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export interface ParseResult {
  rows: ImportRow[];
  matchedDays: number;
}

export async function parseTimesheetWorkbook(
  file: File,
  periodDays: string[]
): Promise<ParseResult> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!sheet) return { rows: [], matchedDays: 0 };

  const grid: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });

  // Lookups from the period days.
  const byIso = new Map<string, string>();
  const byDom = new Map<number, string>();
  const byWeekday = new Map<string, string>();
  const useWeekday = periodDays.length <= 7;
  for (const d of periodDays) {
    byIso.set(d, d);
    const dt = new Date(`${d}T00:00:00Z`);
    byDom.set(dt.getUTCDate(), d);
    if (useWeekday) {
      const wd = WEEKDAYS[dt.getUTCDay()];
      byWeekday.set(wd, d);
      byWeekday.set(wd.slice(0, 3), d);
    }
  }

  function matchDate(cell: unknown, allowWeekday: boolean): string | null {
    if (cell == null) return null;
    if (cell instanceof Date) {
      for (const iso of [localISO(cell), utcISO(cell)]) {
        if (byIso.has(iso)) return byIso.get(iso)!;
      }
      const dom = cell.getDate();
      if (byDom.has(dom)) return byDom.get(dom)!;
      return null;
    }
    if (typeof cell === "number") {
      if (Number.isInteger(cell) && cell >= 1 && cell <= 31 && byDom.has(cell)) {
        return byDom.get(cell)!;
      }
      return null;
    }
    if (typeof cell === "string") {
      const s = cell.trim().toLowerCase();
      if (!s) return null;
      const isoMatch = s.match(/\d{4}-\d{2}-\d{2}/);
      if (isoMatch && byIso.has(isoMatch[0])) return byIso.get(isoMatch[0])!;
      const t = Date.parse(cell);
      if (!Number.isNaN(t)) {
        const d = new Date(t);
        for (const iso of [localISO(d), utcISO(d)]) {
          if (byIso.has(iso)) return byIso.get(iso)!;
        }
        if (byDom.has(d.getDate())) return byDom.get(d.getDate())!;
      }
      if (allowWeekday) {
        if (byWeekday.has(s)) return byWeekday.get(s)!;
        for (const [k, v] of byWeekday) if (s.startsWith(k)) return v;
      }
    }
    return null;
  }

  const colCount = grid.reduce((m, r) => Math.max(m, r?.length ?? 0), 0);

  function countMatches(col: number, allowWeekday: boolean): number {
    let n = 0;
    for (let i = 0; i < grid.length; i++) {
      if (matchDate(grid[i]?.[col], allowWeekday)) n++;
    }
    return n;
  }

  // Pick the date column by which column holds the most real dates for this
  // period; only fall back to weekday-name matching if no real dates are found.
  let dateCol = -1;
  let best = 0;
  let allowWeekday = false;
  for (let c = 0; c < colCount; c++) {
    const n = countMatches(c, false);
    if (n > best) {
      best = n;
      dateCol = c;
    }
  }
  if (best === 0) {
    allowWeekday = true;
    for (let c = 0; c < colCount; c++) {
      const n = countMatches(c, true);
      if (n > best) {
        best = n;
        dateCol = c;
      }
    }
  }
  if (dateCol < 0 || best === 0) return { rows: [], matchedDays: 0 };

  // Detect hour columns by header keyword anywhere in the sheet. Tightened so
  // "Start Time"/"End Time" don't get mistaken for an hours column.
  let regCol = -1;
  let otCol = -1;
  let holCol = -1;
  let ptoCol = -1;
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (c === dateCol) continue;
      const cell = row[c];
      if (typeof cell !== "string") continue;
      const v = cell.toLowerCase();
      if (
        regCol === -1 &&
        /(working|regular|worked|total)[\s\S]*?(hours|hrs)|^\s*(hours|hrs)\s*$/.test(v)
      )
        regCol = c;
      if (otCol === -1 && /overtime|\bo\.?t\.?\b/.test(v)) otCol = c;
      if (holCol === -1 && /holiday/.test(v)) holCol = c;
      if (ptoCol === -1 && /pto|vacation|leave/.test(v)) ptoCol = c;
    }
  }

  const acc = new Map<string, ImportRow>();
  function bump(date: string, field: keyof Omit<ImportRow, "date">, val: number) {
    if (val <= 0) return;
    const cur =
      acc.get(date) ?? { date, regular: 0, overtime: 0, holiday: 0, pto: 0 };
    cur[field] += val;
    acc.set(date, cur);
  }

  for (let i = 0; i < grid.length; i++) {
    const row = grid[i];
    if (!row || row.length === 0) continue;
    const date = matchDate(row[dateCol], allowWeekday);
    if (!date) continue;

    if (regCol !== -1) {
      bump(date, "regular", toNumber(row[regCol]));
    } else {
      // No explicit regular column: use the first numeric cell after the date.
      for (let c = 0; c < row.length; c++) {
        if (c === dateCol) continue;
        const n = toNumber(row[c]);
        if (n > 0) {
          bump(date, "regular", n);
          break;
        }
      }
    }
    if (otCol !== -1) bump(date, "overtime", toNumber(row[otCol]));
    if (holCol !== -1) bump(date, "holiday", toNumber(row[holCol]));
    if (ptoCol !== -1) bump(date, "pto", toNumber(row[ptoCol]));
  }

  const rows = periodDays
    .map((d) => acc.get(d))
    .filter((r): r is ImportRow => !!r);
  return { rows, matchedDays: rows.length };
}
