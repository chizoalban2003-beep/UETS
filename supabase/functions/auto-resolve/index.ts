// Scheduled lifecycle progressor + auto-resolver.
// Flow:
//   open -> pending_resolution (when resolution_at passed)
//   pending_resolution -> disputable (records final_value from latest data point, sets final_posted_at)
//   disputable -> resolved (after 24h dispute window with no open disputes; settles payouts via RPC)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DISPUTE_WINDOW_MS = 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const results: any[] = [];

  try {
    // 1. open -> pending_resolution
    const { data: dueOpen } = await supabase
      .from("markets")
      .select("id")
      .eq("status", "open")
      .lte("resolution_at", new Date().toISOString());
    for (const m of dueOpen || []) {
      await supabase.from("markets").update({ status: "pending_resolution" }).eq("id", m.id);
      results.push({ id: m.id, step: "open->pending_resolution" });
    }

    // 2. pending_resolution -> disputable (post final value from latest data point)
    const { data: pending } = await supabase
      .from("markets")
      .select("id, data_source_id")
      .eq("status", "pending_resolution");
    for (const m of pending || []) {
      if (!m.data_source_id) continue; // manual markets stay in pending_resolution until creator posts
      const { data: latest } = await supabase
        .from("market_data_points")
        .select("value")
        .eq("market_id", m.id)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latest) {
        results.push({ id: m.id, step: "no data" });
        continue;
      }
      await supabase
        .from("markets")
        .update({
          status: "disputable",
          final_value: Number(latest.value),
          final_posted_at: new Date().toISOString(),
        })
        .eq("id", m.id);
      results.push({ id: m.id, step: "pending_resolution->disputable", final_value: Number(latest.value) });
    }

    // 3. disputable -> resolved (after window, no open disputes)
    const cutoff = new Date(Date.now() - DISPUTE_WINDOW_MS).toISOString();
    const { data: disputable } = await supabase
      .from("markets")
      .select("id, final_value")
      .eq("status", "disputable")
      .lte("final_posted_at", cutoff);
    for (const m of disputable || []) {
      const { count } = await supabase
        .from("market_disputes")
        .select("id", { count: "exact", head: true })
        .eq("market_id", m.id)
        .eq("status", "open");
      if ((count ?? 0) > 0) {
        results.push({ id: m.id, step: "blocked by open disputes" });
        continue;
      }
      const { error } = await supabase.rpc("resolve_market_system", {
        _market_id: m.id,
        _final_value: Number(m.final_value),
      });
      if (error) results.push({ id: m.id, step: "settle failed", error: error.message });
      else results.push({ id: m.id, step: "disputable->resolved" });
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
