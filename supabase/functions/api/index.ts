// Public REST API — authenticated via X-API-Key header.
// Rate limits: free=100/day, pro=1000/day, elite=10000/day
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { logError } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RATE_LIMITS: Record<string, number> = { free: 100, pro: 1000, elite: 10000 };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // 1. Authenticate via API key
    const rawKey = req.headers.get("X-API-Key");
    if (!rawKey) return json({ error: "X-API-Key header required" }, 401);

    const keyHash = await sha256(rawKey);
    const { data: key } = await sb
      .from("api_keys")
      .select("id, user_id, tier, requests_today, last_reset_at")
      .eq("key_hash", keyHash)
      .maybeSingle();
    if (!key) return json({ error: "Invalid API key" }, 401);

    // 2. Rate limiting
    const today = new Date().toISOString().slice(0, 10);
    const requestsToday = (key as any).last_reset_at === today ? (key as any).requests_today : 0;
    const limit = RATE_LIMITS[(key as any).tier] ?? 100;
    if (requestsToday >= limit) {
      return json({ error: "rate_limit_exceeded", limit, reset: "midnight UTC" }, 429);
    }

    // 3. Increment usage (non-blocking — log failures but don't block the request)
    sb.from("api_keys").update({
      requests_today: requestsToday + 1,
      last_reset_at: today,
      last_used_at: new Date().toISOString(),
    }).eq("id", (key as any).id).then(({ error }) => {
      if (error) console.error("api_keys usage update failed:", error.message);
    });

    // 4. Route request
    const url = new URL(req.url);
    const path = url.pathname
      .replace(/\/functions\/v1\/api\/?/, "")
      .replace(/^\//, "");
    const segments = path.split("/").filter(Boolean);
    const [resource, id, sub] = segments;
    const params = Object.fromEntries(url.searchParams);
    const userId = (key as any).user_id;

    // GET /markets
    if (resource === "markets" && !id && req.method === "GET") {
      const limit = Math.min(parseInt(params.limit ?? "20"), 100);
      let q = sb
        .from("markets")
        .select("id, name, category, status, band_width, band_is_pct, unit, trend_model, resolution_at, fees_accrued, live_data_feed")
        .order("fees_accrued", { ascending: false })
        .limit(limit);
      if (params.category) q = q.eq("category", params.category);
      if (params.status)   q = q.eq("status", params.status);
      else                 q = q.in("status", ["open", "pending_resolution"]);
      const { data, error } = await q;
      if (error) throw error;
      return json({ ok: true, markets: data, count: data?.length ?? 0 });
    }

    // GET /markets/:id
    if (resource === "markets" && id && !sub && req.method === "GET") {
      const { data, error } = await sb
        .from("markets")
        .select("*, contracts(id, kind, reserve_yes, reserve_no, fee_bps, lp_total_shares)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "market not found" }, 404);
      return json({ ok: true, market: data });
    }

    // GET /markets/:id/data
    if (resource === "markets" && id && sub === "data" && req.method === "GET") {
      let q = sb
        .from("market_data_points")
        .select("ts, value")
        .eq("market_id", id)
        .order("ts", { ascending: false })
        .limit(200);
      if (params.from) q = q.gte("ts", parseInt(params.from));
      if (params.to)   q = q.lte("ts", parseInt(params.to));
      const { data, error } = await q;
      if (error) throw error;
      return json({ ok: true, points: (data ?? []).reverse() });
    }

    // GET /markets/:id/contracts
    if (resource === "markets" && id && sub === "contracts" && req.method === "GET") {
      const { data, error } = await sb
        .from("contracts")
        .select("id, kind, reserve_yes, reserve_no, fee_bps, lp_total_shares")
        .eq("market_id", id);
      if (error) throw error;
      return json({ ok: true, contracts: data });
    }

    // GET /portfolio
    if (resource === "portfolio" && req.method === "GET") {
      const [walletRes, positionsRes] = await Promise.all([
        sb.from("wallets").select("balance, mode").eq("user_id", userId).maybeSingle(),
        sb.from("positions")
          .select("contract_id, yes_shares, no_shares, contracts(kind, markets(id, name))")
          .eq("user_id", userId)
          .gt("yes_shares", 0),
      ]);
      return json({ ok: true, wallet: walletRes.data, positions: positionsRes.data ?? [] });
    }

    // POST /trades — execute a trade on behalf of the API key owner via _actor_id
    if (resource === "trades" && req.method === "POST") {
      const body = await req.json();
      if (!body.contract_id || !body.side || !body.shares) {
        return json({ error: "contract_id, side, shares required" }, 400);
      }
      const validSides = ["buy_yes", "buy_no", "sell_yes", "sell_no"];
      if (!validSides.includes(body.side)) {
        return json({ error: `side must be one of: ${validSides.join(", ")}` }, 400);
      }
      const shares = Number(body.shares);
      if (!Number.isFinite(shares) || shares <= 0) {
        return json({ error: "shares must be a positive number" }, 400);
      }
      const { data, error } = await sb.rpc("execute_trade", {
        _contract_id: body.contract_id,
        _side: body.side,
        _shares: shares,
        _by_bot: true,
        _actor_id: (key as any).user_id,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, trade: data });
    }

    return json({ error: `Unknown endpoint: /${path || ""}` }, 404);

  } catch (err) {
    await logError(err, { function_name: "api" });
    return json({ error: "Internal server error" }, 500);
  }
});
