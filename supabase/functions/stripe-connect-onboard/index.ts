// Creates or retrieves a Stripe Connect Express account and returns an onboarding URL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { createStripeClient } from "../_shared/stripe.ts";
import { logError } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user }, error: authErr } = await sb.auth.getUser();
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const returnUrl = body.return_url ?? ((Deno.env.get("APP_URL") ?? "") + "/settings");

    const stripe = createStripeClient("sandbox");

    // Get or create Connect Express account
    const { data: profile } = await sb
      .from("profiles")
      .select("stripe_connect_account_id")
      .eq("id", user.id)
      .maybeSingle();

    let accountId: string = (profile as any)?.stripe_connect_account_id ?? "";
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        capabilities: { transfers: { requested: true } },
        metadata: { user_id: user.id },
      });
      accountId = account.id;
      await sb.from("profiles")
        .update({ stripe_connect_account_id: accountId })
        .eq("id", user.id);
    }

    // Check onboarding status
    const account = await stripe.accounts.retrieve(accountId);
    if (account.details_submitted) {
      await sb.from("profiles")
        .update({ stripe_connect_onboarded: true })
        .eq("id", user.id);
    }

    // Create onboarding link
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: returnUrl + "?connect=refresh",
      return_url:  returnUrl + "?connect=success",
      type: "account_onboarding",
    });

    return json({ url: link.url, already_onboarded: account.details_submitted });
  } catch (err) {
    await logError(err, { function_name: "stripe-connect-onboard" });
    return json({ error: "Internal server error" }, 500);
  }
});
