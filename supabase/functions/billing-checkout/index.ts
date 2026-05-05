// Creates a Stripe Checkout session for subscription tiers or one-time credit purchases.
import { type StripeEnv, createStripeClient } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DWC_CREDITS_RE = /^dwc_(\d+)_credits$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const { priceId, customerEmail, userId, returnUrl, environment } = await req.json();
    if (!priceId || !/^[a-zA-Z0-9_-]+$/.test(priceId)) throw new Error("Invalid priceId");
    if (!returnUrl) throw new Error("returnUrl required");
    const env: StripeEnv = environment === "live" ? "live" : "sandbox";

    const stripe = createStripeClient(env);

    // ── DWC Credits — one-time hosted checkout ─────────────────────────────
    const creditsMatch = DWC_CREDITS_RE.exec(priceId);
    if (creditsMatch) {
      const amount = parseInt(creditsMatch[1], 10);
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        ui_mode: "hosted",
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount * 100,
              product_data: {
                name: `§${amount} Driftworks Credits`,
                description: "1 Credit = $1 USD. Trade on any market.",
              },
            },
            quantity: 1,
          },
        ],
        metadata: { userId: userId ?? "", type: "credit_purchase", credits: String(amount) },
        success_url: returnUrl + `?purchased=true&credits=${amount}`,
        cancel_url: returnUrl + "?cancelled=true",
        ...(customerEmail && { customer_email: customerEmail }),
      });
      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Subscription tiers — embedded checkout ─────────────────────────────
    const prices = await stripe.prices.list({ lookup_keys: [priceId] });
    if (!prices.data.length) throw new Error("Price not found");
    const stripePrice = prices.data[0];
    const isRecurring = stripePrice.type === "recurring";

    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: stripePrice.id, quantity: 1 }],
      mode: isRecurring ? "subscription" : "payment",
      ui_mode: "embedded_page",
      return_url: returnUrl,
      ...(customerEmail && { customer_email: customerEmail }),
      ...(userId && {
        metadata: { userId, priceId },
        ...(isRecurring && { subscription_data: { metadata: { userId, priceId } } }),
      }),
    });

    return new Response(JSON.stringify({ clientSecret: session.client_secret }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("billing-checkout error:", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
