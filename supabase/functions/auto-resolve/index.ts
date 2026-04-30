// Scheduled auto-resolver: settles markets whose resolution_at has passed,
// using the most recent market_data_points value as the final value.
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { data: due, error } = await supabase
      .from("markets")
      .select("id, data_source_id")
      .eq("status", "open")
      .lte("resolution_at", new Date().toISOString());
    if (error) throw error;

    const results: any[] = [];
    for (const m of due || []) {
      // Only auto-resolve markets backed by a data source
      if (!m.data_source_id) continue;
      const { data: latest } = await supabase
        .from("market_data_points")
        .select("value")
        .eq("market_id", m.id)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latest) {
        results.push({ id: m.id, ok: false, reason: "no data points" });
        continue;
      }
      const { error: rpcErr } = await supabase.rpc("resolve_market_system", {
        _market_id: m.id,
        _final_value: Number(latest.value),
      });
      if (rpcErr) {
        results.push({ id: m.id, ok: false, error: rpcErr.message });
      } else {
        results.push({ id: m.id, ok: true, final_value: Number(latest.value) });
      }
    }

    return new Response(JSON.stringify({ scanned: due?.length || 0, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
