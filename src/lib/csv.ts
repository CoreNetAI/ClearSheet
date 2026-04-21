// Minimal RFC-4180-ish CSV serialization (quote fields containing
// commas, quotes, or newlines).

function escapeCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(","));
  }
  // Leading BOM so Excel opens UTF-8 correctly.
  return "﻿" + lines.join("\r\n");
}
