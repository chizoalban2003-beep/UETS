import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
    const { market_id, reason } = await req.json();
    if (!market_id || typeof reason !== "string" || reason.length < 10) {
      return json({ error: "market_id and reason (>=10 chars) required" }, 400);
    }
    const { data, error } = await supabase.rpc("raise_dispute", {
      _market_id: market_id,
      _reason: reason,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ dispute: data });
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
