// Hourly fairness scan — flags markets with concentration or volume spikes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { logError } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: markets } = await supabase
      .from("markets")
      .select("id, name, creator_id")
      .eq("status", "open");

    const events: any[] = [];
    for (const m of markets || []) {
      const { data: risks } = await supabase.rpc("detect_concentration_risk", { _market_id: m.id });
      if (risks && risks.length > 0) {
        const top = risks[0];
        events.push({
          user_id: m.creator_id,
          market_id: m.id,
          kind: "fairness_alert",
          title: `Concentration risk on ${m.name}`,
          body_md: `One wallet holds **${Number(top.share_pct).toFixed(1)}%** of the ${top.side} side. Consider pausing trading or messaging the holder.`,
          metrics: { share_pct: top.share_pct, side: top.side },
        });
      }
    }

    if (events.length) {
      await supabase.from("caretaker_events").insert(events);
    }

    return json({ scanned: markets?.length || 0, alerts: events.length });
  } catch (err: any) {
    await logError(err, { function_name: "caretaker-fairness" });
    return json({ error: err?.message ?? "Internal server error" }, 500);
  }
});
