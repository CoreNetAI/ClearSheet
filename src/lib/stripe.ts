import "server-only";
import Stripe from "stripe";

export function isStripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

let cached: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!isStripeEnabled()) return null;
  if (!cached) {
    cached = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      // Pin a recent API version; httpClient uses fetch (edge-compatible).
      apiVersion: "2024-09-30.acacia" as Stripe.LatestApiVersion,
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return cached;
}

/**
 * Hosted Checkout session for an invoice (PCI SAQ-A). Returns the payable URL.
 * metadata.invoice_id lets the webhook reconcile the payment.
 */
export async function createInvoiceCheckout(opts: {
  invoiceId: string;
  invoiceNumber: string;
  amount: number; // major units
  currency: string;
  baseUrl: string;
  customerEmail?: string | null;
}): Promise<{ url: string; id: string } | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: opts.customerEmail || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: opts.currency.toLowerCase(),
          unit_amount: Math.round(opts.amount * 100),
          product_data: { name: `Invoice ${opts.invoiceNumber}` },
        },
      },
    ],
    metadata: { invoice_id: opts.invoiceId },
    success_url: `${opts.baseUrl}/finance/invoices/${opts.invoiceId}?paid=1`,
    cancel_url: `${opts.baseUrl}/finance/invoices/${opts.invoiceId}`,
  });

  return session.url ? { url: session.url, id: session.id } : null;
}
