import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { formatMoney, formatDate, formatHours } from "@/lib/format";

export interface InvoicePdfData {
  firm: { name: string; address: string; email: string; logoUrl?: string };
  invoice: {
    invoice_number: string;
    issued_date: string | null;
    due_date: string | null;
    period_start: string | null;
    period_end: string | null;
    subtotal: number;
    total: number;
    currency: string;
  };
  client: {
    name: string;
    billing_address: string | null;
    contact_name: string | null;
    contact_email: string | null;
  };
  lineItems: {
    employee_name: string | null;
    assignment_title: string | null;
    hours: number;
    bill_rate: number;
    amount: number;
  }[];
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 50;
const DARK = rgb(0.1, 0.12, 0.16);
const GRAY = rgb(0.45, 0.47, 0.5);
const LINE = rgb(0.85, 0.86, 0.88);

// Column x-positions (left edges) for the line-item table.
const COL = {
  employee: MARGIN,
  assignment: 200,
  hours: 360,
  rate: 430,
  amount: PAGE_W - MARGIN, // right edge (amounts are right-aligned)
};

export async function buildInvoicePdf(
  data: InvoicePdfData
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const text = (
    s: string,
    x: number,
    yy: number,
    opts: { size?: number; font?: PDFFont; color?: typeof DARK } = {}
  ) => {
    page.drawText(s ?? "", {
      x,
      y: yy,
      size: opts.size ?? 10,
      font: opts.font ?? font,
      color: opts.color ?? DARK,
    });
  };

  const rightText = (
    s: string,
    rightX: number,
    yy: number,
    opts: { size?: number; font?: PDFFont; color?: typeof DARK } = {}
  ) => {
    const f = opts.font ?? font;
    const size = opts.size ?? 10;
    const w = f.widthOfTextAtSize(s ?? "", size);
    text(s, rightX - w, yy, opts);
  };

  const { currency } = data.invoice;

  // Header: firm + INVOICE
  text(data.firm.name, MARGIN, y, { size: 18, font: bold });
  rightText("INVOICE", PAGE_W - MARGIN, y, { size: 22, font: bold, color: GRAY });
  y -= 18;
  if (data.firm.address) {
    text(data.firm.address, MARGIN, y, { size: 9, color: GRAY });
    y -= 12;
  }
  if (data.firm.email) {
    text(data.firm.email, MARGIN, y, { size: 9, color: GRAY });
  }
  rightText(`# ${data.invoice.invoice_number}`, PAGE_W - MARGIN, y, {
    size: 10,
    color: GRAY,
  });

  y -= 36;

  // Bill-to + meta row
  const billTopY = y;
  text("BILL TO", MARGIN, y, { size: 8, font: bold, color: GRAY });
  y -= 14;
  text(data.client.name, MARGIN, y, { size: 11, font: bold });
  y -= 13;
  if (data.client.contact_name) {
    text(data.client.contact_name, MARGIN, y, { size: 9, color: GRAY });
    y -= 12;
  }
  if (data.client.billing_address) {
    for (const ln of data.client.billing_address.split("\n").slice(0, 3)) {
      text(ln, MARGIN, y, { size: 9, color: GRAY });
      y -= 12;
    }
  }
  if (data.client.contact_email) {
    text(data.client.contact_email, MARGIN, y, { size: 9, color: GRAY });
    y -= 12;
  }

  // Meta (right side)
  let metaY = billTopY;
  const metaLabelX = 380;
  const metaValueRight = PAGE_W - MARGIN;
  const meta = [
    ["Issued", formatDate(data.invoice.issued_date)],
    ["Due", formatDate(data.invoice.due_date)],
    [
      "Period",
      data.invoice.period_start
        ? `${formatDate(data.invoice.period_start)} – ${formatDate(
            data.invoice.period_end
          )}`
        : "—",
    ],
  ];
  for (const [label, value] of meta) {
    text(label, metaLabelX, metaY, { size: 9, color: GRAY });
    rightText(value, metaValueRight, metaY, { size: 9 });
    metaY -= 14;
  }

  y = Math.min(y, metaY) - 18;

  // Table header
  const drawTableHeader = () => {
    text("Employee", COL.employee, y, { size: 8, font: bold, color: GRAY });
    text("Assignment", COL.assignment, y, { size: 8, font: bold, color: GRAY });
    rightText("Hours", COL.hours + 30, y, { size: 8, font: bold, color: GRAY });
    rightText("Rate", COL.rate + 40, y, { size: 8, font: bold, color: GRAY });
    rightText("Amount", COL.amount, y, { size: 8, font: bold, color: GRAY });
    y -= 6;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 1,
      color: LINE,
    });
    y -= 14;
  };
  drawTableHeader();

  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, max - 1) + "…" : s;

  for (const li of data.lineItems) {
    if (y < MARGIN + 90) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      drawTableHeader();
    }
    text(truncate(li.employee_name || "—", 26), COL.employee, y, { size: 9 });
    text(truncate(li.assignment_title || "—", 24), COL.assignment, y, {
      size: 9,
    });
    rightText(formatHours(li.hours), COL.hours + 30, y, { size: 9 });
    rightText(formatMoney(li.bill_rate, currency), COL.rate + 40, y, {
      size: 9,
    });
    rightText(formatMoney(li.amount, currency), COL.amount, y, { size: 9 });
    y -= 16;
  }

  // Totals
  y -= 6;
  page.drawLine({
    start: { x: 360, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 1,
    color: LINE,
  });
  y -= 18;
  text("Subtotal", 380, y, { size: 10, color: GRAY });
  rightText(formatMoney(data.invoice.subtotal, currency), PAGE_W - MARGIN, y, {
    size: 10,
  });
  y -= 20;
  text("Total", 380, y, { size: 12, font: bold });
  rightText(formatMoney(data.invoice.total, currency), PAGE_W - MARGIN, y, {
    size: 12,
    font: bold,
  });

  // Footer
  text(
    "Thank you for your business.",
    MARGIN,
    MARGIN,
    { size: 9, color: GRAY }
  );

  return doc.save();
}
