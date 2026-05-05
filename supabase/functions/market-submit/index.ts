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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );

    const { market_id, stake } = await req.json();
    if (!market_id || typeof stake !== "number" || stake < 400) {
      return json({ error: "market_id and stake (>=400) required" }, 400);
    }

    const { data, error } = await supabase.rpc("submit_market", {
      _market_id: market_id,
      _stake: stake,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ market: data });
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
