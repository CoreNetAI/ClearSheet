import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { renderInvoicePdf } from "@/lib/pdf/invoice-render";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS scopes invoice visibility (finance/admin or owning account manager).
  const rendered = await renderInvoicePdf(supabase, id);
  if (!rendered) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(Buffer.from(rendered.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${rendered.invoiceNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
