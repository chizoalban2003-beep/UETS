// Bot reasoning + suggestion engine.
// Pulls open markets the user enabled, computes trend/distortion, asks Lovable AI
// for an action, then either records a suggestion, or (in approve/auto mode) records
// a suggestion that the client can one-click execute. Auto mode also executes immediately.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

type DataPoint = { ts: number; value: number };

function fitLinear(points: DataPoint[]) {
  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  const n = sorted.length;
  if (n === 0) return (_: number) => 0;
  const x0 = sorted[0].ts;
  const xs = sorted.map((p) => (p.ts - x0) / 86400000);
  const ys = sorted.map((p) => p.value);
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxy = xs.reduce((a, _, i) => a + xs[i] * ys[i], 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return (ts: number) => intercept + slope * ((ts - x0) / 86400000);
}

function distortionScore(actual: number, trend: number, bandWidth: number, bandIsPct: boolean) {
  const halfBand = bandIsPct ? Math.abs(trend) * (bandWidth / 100) : bandWidth;
  if (halfBand <= 0) return 0;
  const dev = Math.abs(actual - trend);
  if (dev <= halfBand) return 0;
  return Math.min(1, (dev - halfBand) / (2 * halfBand));
}

function ammPriceYes(rY: number, rN: number) {
  const t = rY + rN;
  return t === 0 ? 0.5 : rN / t;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // user-scoped client → respects RLS, runs everything as the user
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { data: bot } = await supabase
      .from("bots")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (!bot) {
      return new Response(JSON.stringify({ error: "Bot not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (bot.mode === "off") {
      return new Response(JSON.stringify({ ok: true, mode: "off", suggestions: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const enabledIds: string[] = bot.enabled_market_ids ?? [];
    if (enabledIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, suggestions: [], note: "No enabled markets" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: markets } = await supabase
      .from("markets")
      .select("id,name,description,trend_model,band_width,band_is_pct,unit,status")
      .in("id", enabledIds)
      .eq("status", "open");

    const created: any[] = [];

    for (const m of markets ?? []) {
      const { data: pts } = await supabase
        .from("market_data_points")
        .select("ts,value")
        .eq("market_id", m.id)
        .order("ts", { ascending: true });
      if (!pts || pts.length < 2) continue;

      const dp: DataPoint[] = pts.map((p: any) => ({
        ts: new Date(p.ts).getTime(),
        value: Number(p.value),
      }));
      const lastTs = dp[dp.length - 1].ts;
      const lastValue = dp[dp.length - 1].value;
      const fit = fitLinear(dp);
      const trend = fit(lastTs);
      const dist = distortionScore(lastValue, trend, Number(m.band_width), m.band_is_pct);
      const stretchedAbove = lastValue > trend;

      const { data: contracts } = await supabase
        .from("contracts")
        .select("id,kind,reserve_yes,reserve_no")
        .eq("market_id", m.id);
      if (!contracts) continue;

      const summary = contracts.map((c: any) => ({
        kind: c.kind,
        priceYes: ammPriceYes(Number(c.reserve_yes), Number(c.reserve_no)),
      }));

      const systemPrompt =
        `You are an algorithmic trading bot operating on "elastic trend" prediction markets. ` +
        `Each market has a trend line and an elasticity band. Distortion measures how far the latest value ` +
        `is stretched outside that band (0 = inside, 1 = far outside). Two contracts trade per market: ` +
        `"distortion" (YES pays the distortion at resolution, NO pays 1-distortion) and ` +
        `"snapback" (YES pays 1 if value returns inside band, else 0). ` +
        `Strategy: ${bot.strategy}. ` +
        (bot.custom_prompt ? `User custom guidance: ${bot.custom_prompt}. ` : "") +
        `Risk limits: max position size ${bot.max_position_size}. ` +
        `Decide ONE action and call the trade tool. Use side "skip" if no good edge.`;

      const userMsg = {
        market: { name: m.name, unit: m.unit ?? "", description: m.description ?? "" },
        latest_value: lastValue,
        trend_value: trend,
        distortion: dist,
        stretched_above_trend: stretchedAbove,
        contracts: summary,
        max_shares: Number(bot.max_position_size),
      };

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(userMsg) },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "place_trade",
                description: "Decide an action for this market.",
                parameters: {
                  type: "object",
                  properties: {
                    contract_kind: { type: "string", enum: ["distortion", "snapback"] },
                    side: {
                      type: "string",
                      enum: ["buy_yes", "buy_no", "skip"],
                      description: "What to do. 'skip' if no edge.",
                    },
                    shares: { type: "number", description: "Shares to buy. 0 if skip." },
                    confidence: { type: "number", description: "0..1 confidence in this trade." },
                    rationale: { type: "string", description: "1-2 sentence reasoning." },
                  },
                  required: ["contract_kind", "side", "shares", "confidence", "rationale"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "place_trade" } },
        }),
      });

      if (!aiResp.ok) {
        if (aiResp.status === 429 || aiResp.status === 402) {
          return new Response(
            JSON.stringify({
              error: aiResp.status === 429 ? "Rate limit, try again shortly" : "AI credits exhausted",
            }),
            { status: aiResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        console.error("ai error", aiResp.status, await aiResp.text());
        continue;
      }

      const aiJson = await aiResp.json();
      const call = aiJson.choices?.[0]?.message?.tool_calls?.[0];
      if (!call) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(call.function.arguments);
      } catch {
        continue;
      }
      if (parsed.side === "skip" || !parsed.shares || parsed.shares <= 0) {
        // Record an informational suggestion that auto-resolves
        await supabase.from("bot_suggestions").insert({
          user_id: userId,
          market_id: m.id,
          contract_id: contracts.find((c: any) => c.kind === parsed.contract_kind)?.id ?? contracts[0].id,
          side: "buy_yes",
          shares: 0,
          est_cost: 0,
          confidence: Number(parsed.confidence ?? 0.5),
          rationale: `[skip] ${parsed.rationale}`,
          status: "skipped",
          resolved_at: new Date().toISOString(),
        });
        continue;
      }

      const contract = contracts.find((c: any) => c.kind === parsed.contract_kind);
      if (!contract) continue;
      const shares = Math.min(Number(parsed.shares), Number(bot.max_position_size));
      const k = Number(contract.reserve_yes) * Number(contract.reserve_no);
      let estCost = 0;
      if (parsed.side === "buy_yes" && shares < Number(contract.reserve_yes)) {
        const newYes = Number(contract.reserve_yes) - shares;
        estCost = k / newYes - Number(contract.reserve_no);
      } else if (parsed.side === "buy_no" && shares < Number(contract.reserve_no)) {
        const newNo = Number(contract.reserve_no) - shares;
        estCost = k / newNo - Number(contract.reserve_yes);
      }

      const status = bot.mode === "auto" ? "executed" : "pending";

      const { data: sugg, error: sErr } = await supabase
        .from("bot_suggestions")
        .insert({
          user_id: userId,
          market_id: m.id,
          contract_id: contract.id,
          side: parsed.side,
          shares,
          est_cost: estCost,
          confidence: Number(parsed.confidence ?? 0.5),
          rationale: parsed.rationale,
          status,
        })
        .select()
        .single();
      if (sErr) {
        console.error("suggestion insert", sErr);
        continue;
      }

      if (bot.mode === "auto") {
        const { data: trade, error: tErr } = await supabase.rpc("execute_trade", {
          _contract_id: contract.id,
          _side: parsed.side,
          _shares: shares,
          _by_bot: true,
        });
        if (tErr) {
          console.error("auto execute", tErr);
          await supabase
            .from("bot_suggestions")
            .update({ status: "rejected", rationale: `${parsed.rationale} [auto-failed: ${tErr.message}]` })
            .eq("id", sugg.id);
        } else {
          await supabase
            .from("bot_suggestions")
            .update({ trade_id: (trade as any).id, resolved_at: new Date().toISOString() })
            .eq("id", sugg.id);
        }
      }

      created.push(sugg);
    }

    return new Response(JSON.stringify({ ok: true, suggestions: created }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("bot-run error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
