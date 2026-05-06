// lp-incentive-payout — credit daily LP incentive bonuses to eligible liquidity providers.
// Called by pg_cron daily (or from agent-scheduler).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { logError } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Find all eligible LP positions
    const { data: eligible, error: eligErr } = await sb
      .from("lp_incentive_eligible")
      .select("*");

    if (eligErr) {
      console.error("lp-incentive-payout fetch error:", eligErr.message);
      return json({ error: eligErr.message }, 500);
    }

    if (!eligible?.length) return json({ ok: true, paid: 0 });

    let paid = 0;

    for (const lp of eligible) {
      const poolShare = Number(lp.pool_share_pct);
      if (!poolShare || poolShare <= 0) continue;

      const poolSize = Number(lp.pool_size);
      const dailyRate = Number(lp.lp_incentive_apy) / 100 / 365;
      const dailyBonus = poolSize * poolShare * dailyRate;

      if (dailyBonus < 0.01) continue; // skip dust

      const { error: creditErr } = await sb.rpc("execute_lp_incentive_credit", {
        _user_id: lp.user_id,
        _amount: dailyBonus,
        _market_id: lp.market_id,
      });

      if (creditErr) {
        console.error(`lp-incentive-payout credit error for ${lp.user_id}:`, creditErr.message);
        continue;
      }

      paid++;
    }

    return json({ ok: true, paid });
  } catch (e: any) {
    await logError(e, { function_name: "lp-incentive-payout" });
    return json({ error: "Internal server error" }, 500);
  }
});
