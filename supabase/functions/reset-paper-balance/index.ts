// reset-paper-balance: closes the user's positions at AMM mid, zeroes them,
// resets wallet to §10,000. Rate-limited to one reset per 24h via ledger lookup.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { logError } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "auth required" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "invalid jwt" }, 401);

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // 24h cooldown — look for a recent demo_reset entry
    const { data: recent } = await sb.from("ledger_entries")
      .select("created_at, note")
      .eq("user_id", user.id)
      .eq("reason", "signup_bonus")
      .ilike("note", "%demo reset%")
      .gt("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .limit(1);
    if (recent && recent.length) {
      return json({ error: "Already reset within the last 24 hours" }, 429);
    }

    // Zero open positions; AMM reserves are not modified (it's the user's balance that resets).
    const { data: positions } = await sb.from("positions")
      .select("id, yes_shares, no_shares")
      .eq("user_id", user.id);

    let closed = 0;
    if (positions) {
      for (const p of positions) {
        if (Number(p.yes_shares) === 0 && Number(p.no_shares) === 0) continue;
        await sb.from("positions").update({ yes_shares: 0, no_shares: 0, cost_basis_yes: 0, cost_basis_no: 0 }).eq("id", p.id);
        closed++;
      }
    }

    // Reset wallet to 10000
    await sb.from("wallets").update({ balance: 10000 }).eq("user_id", user.id);

    // Ledger entry
    await sb.from("ledger_entries").insert({
      user_id: user.id,
      amount: 10000,
      reason: "signup_bonus",
      note: "demo reset · paper balance restored",
    });

    return json({ ok: true, balance: 10000, positions_zeroed: closed });
  } catch (err: any) {
    await logError(err, { function_name: "reset-paper-balance" });
    return json({ error: err?.message ?? "Internal server error" }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
