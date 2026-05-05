// Polls oracles for event-based markets past their resolution_at and resolves them.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function fetchKalshiOutcome(ticker: string): Promise<boolean | null> {
  const r = await fetch(`https://api.elections.kalshi.com/trade-api/v2/markets/${ticker}`);
  if (!r.ok) return null;
  const j = await r.json();
  const status = j?.market?.status;
  const result = j?.market?.result; // "yes" | "no" | ""
  if (status !== "settled") return null;
  if (result === "yes") return true;
  if (result === "no") return false;
  return null;
}

async function fetchPolymarketOutcome(slug: string): Promise<boolean | null> {
  const r = await fetch(`https://gamma-api.polymarket.com/markets?slug=${slug}`);
  if (!r.ok) return null;
  const j = await r.json();
  const m = Array.isArray(j) ? j[0] : j?.[0];
  if (!m?.closed) return null;
  // outcomePrices is "[\"1\",\"0\"]" stringified
  try {
    const prices = JSON.parse(m.outcomePrices);
    return Number(prices[0]) >= 0.99;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: markets, error } = await supabase
    .from("markets")
    .select("id, event_oracle_kind, event_oracle_ref, resolution_at, status, market_kind")
    .eq("market_kind", "event")
    .in("status", ["open", "pending_resolution", "disputable"])
    .lte("resolution_at", new Date().toISOString());
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const results: any[] = [];
  for (const m of markets || []) {
    let outcome: boolean | null = null;
    try {
      if (m.event_oracle_kind === "kalshi" && m.event_oracle_ref) {
        outcome = await fetchKalshiOutcome(m.event_oracle_ref);
      } else if (m.event_oracle_kind === "polymarket" && m.event_oracle_ref) {
        outcome = await fetchPolymarketOutcome(m.event_oracle_ref);
      }
      // manual & sports_api skipped — manual requires creator action
      if (outcome !== null) {
        const { error: rpcErr } = await supabase.rpc("resolve_event_market", {
          _market_id: m.id,
          _outcome: outcome,
        });
        results.push({ id: m.id, outcome, ok: !rpcErr, err: rpcErr?.message });
      } else {
        results.push({ id: m.id, ok: false, reason: "outcome unavailable" });
      }
    } catch (e: any) {
      results.push({ id: m.id, ok: false, error: String(e?.message || e) });
    }
  }

  return new Response(JSON.stringify({ checked: markets?.length || 0, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
