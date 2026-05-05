import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { createStripeClient } from "../_shared/stripe.ts";

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

    // Authenticate user
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user }, error: authErr } = await sb.auth.getUser();
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));

    // Check if already verified
    const { data: existing } = await sb
      .from("kyc_verifications")
      .select("stripe_session_id, status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing?.status === "verified") {
      return json({ error: "already_verified" }, 400);
    }

    // Create Stripe Identity session
    const stripe = createStripeClient("sandbox");
    const session = await stripe.identity.verificationSessions.create({
      type: "document",
      metadata: { user_id: user.id },
      return_url: body.return_url ?? (Deno.env.get("APP_URL") ?? "") + "/credits",
    });

    // Upsert kyc_verifications row
    await sb.from("kyc_verifications").upsert(
      { user_id: user.id, stripe_session_id: session.id, status: "pending" },
      { onConflict: "user_id" },
    );

    return json({ url: session.url });
  } catch (e: any) {
    console.error("kyc-start error:", e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
