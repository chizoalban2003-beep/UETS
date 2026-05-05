import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    // User-scoped client for auth + RPC
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );

    // Service-role client for privileged inserts
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const { market_id, stake } = await req.json();
    if (!market_id || typeof stake !== "number" || stake < 400) {
      return json({ error: "market_id and stake (>=400) required" }, 400);
    }

    // Call the existing RPC which validates and transitions the market
    const { data, error } = await supabase.rpc("submit_market", {
      _market_id: market_id,
      _stake: stake,
    });
    if (error) return json({ error: error.message }, 400);

    const marketId: string = market_id;

    // Override status to pending_review (review gate)
    await sb.from("markets").update({ status: "pending_review" }).eq("id", marketId);

    // Create a market_reviews record
    await sb.from("market_reviews").insert({
      market_id: marketId,
      status: "pending",
      notes: "Awaiting admin review before trading opens",
    });

    // Notify the creator
    await sb.from("notifications").insert({
      user_id: user.id,
      kind: "market_submitted",
      title: "Market under review",
      body: "Your market will open for trading once an admin approves it. Usually within 24 hours.",
      payload: { market_id: marketId },
    });

    return json({
      ok: true,
      market_id: marketId,
      status: "pending_review",
      message: "Market submitted. Trading opens after admin review.",
    });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
