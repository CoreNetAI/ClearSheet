import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { getStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAudit } from "@/lib/audit";

// Stripe sends the raw body; we must verify the signature before trusting it.
// Idempotency is enforced by a unique index on payments(provider, provider_payment_id).
export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, sig, secret);
  } catch (e) {
    return NextResponse.json(
      { error: `Invalid signature: ${e instanceof Error ? e.message : ""}` },
      { status: 400 }
    );
  }

  if (event.type !== "checkout.session.completed") {
    // Acknowledge other events without acting on them.
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const invoiceId = session.metadata?.invoice_id;
  if (!invoiceId) return NextResponse.json({ received: true });

  const supabase = createServiceClient();
  const paymentRef =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.id;

  // Idempotent insert — duplicate webhook deliveries hit the unique index.
  const { error: payErr } = await supabase.from("payments").insert({
    invoice_id: invoiceId,
    provider: "stripe",
    provider_payment_id: paymentRef,
    amount: (session.amount_total ?? 0) / 100,
    status: "succeeded",
    raw: event as unknown as Record<string, unknown>,
  });

  // 23505 = unique violation → already processed; stop here.
  if (payErr && (payErr as { code?: string }).code === "23505") {
    return NextResponse.json({ received: true, duplicate: true });
  }
  if (payErr) {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  await supabase
    .from("invoices")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", invoiceId);

  const { data: lis } = await supabase
    .from("invoice_line_items")
    .select("timesheet_id")
    .eq("invoice_id", invoiceId);
  const tsIds = (lis ?? [])
    .map((l) => l.timesheet_id)
    .filter((x): x is string => Boolean(x));
  if (tsIds.length) {
    await supabase
      .from("timesheets")
      .update({ status: "paid" })
      .in("id", tsIds)
      .eq("status", "invoiced");
  }

  await writeAudit(supabase, {
    actorId: null,
    entityType: "invoice",
    entityId: invoiceId,
    action: "payment_succeeded",
    detail: { eventId: event.id, paymentRef },
  });

  return NextResponse.json({ received: true });
}
