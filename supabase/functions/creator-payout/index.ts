import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { createStripeClient } from "../_shared/stripe.ts";
import { logError } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { market_id } = await req.json();
    if (!market_id) return json({ error: "market_id required" }, 400);

    // Run the payout RPC (credits ledger)
    const { data: rpcData, error } = await supabase.rpc("payout_creator", { _market_id: market_id });
    if (error) return json({ error: error.message }, 400);

    // Attempt real Stripe transfer if creator has a linked Connect account
    try {
      const sbService = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      // Get market creator
      const { data: market } = await sbService
        .from("markets")
        .select("creator_id, fees_accrued")
        .eq("id", market_id)
        .maybeSingle();

      if (market && (market as any).creator_id) {
        const creatorId = (market as any).creator_id;
        const payoutAmount: number = (rpcData as any)?.payout_amount ?? (market as any).fees_accrued ?? 0;

        const { data: profile } = await sbService
          .from("profiles")
          .select("stripe_connect_account_id, stripe_connect_onboarded")
          .eq("id", creatorId)
          .maybeSingle();

        const connectAccountId = (profile as any)?.stripe_connect_account_id;
        const isOnboarded = (profile as any)?.stripe_connect_onboarded;

        if (connectAccountId && isOnboarded && payoutAmount >= 1) {
          // Only transfer for credit-mode wallets (real money)
          const { data: wallet } = await sbService
            .from("wallets")
            .select("mode")
            .eq("user_id", creatorId)
            .maybeSingle();

          if ((wallet as any)?.mode === "credit") {
            const stripe = createStripeClient("sandbox");
            const transfer = await stripe.transfers.create({
              amount: Math.floor(payoutAmount * 100), // floor to avoid overpaying by fractional cents
              currency: "usd",
              destination: connectAccountId,
              transfer_group: `market_${market_id}`,
              metadata: { market_id, user_id: creatorId },
            });
            await sbService.from("payout_history").insert({
              user_id: creatorId,
              market_id,
              amount: payoutAmount,
              stripe_transfer_id: transfer.id,
              status: "paid",
            });
          }
        }
      }
    } catch (transferErr) {
      // Transfer failure must not block the ledger payout response
      await logError(transferErr, { function_name: "creator-payout", context: "stripe_transfer" });
    }

    return json({ market: rpcData });
  } catch (e) {
    await logError(e, { function_name: "creator-payout" });
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
