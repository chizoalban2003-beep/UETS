// caretaker-scout: hourly job that produces top 3 trade ideas per active user
// based on their goals + open markets, written into caretaker_events as kind=trade_idea.
// Pro Trader and Creator Pro tiers only — quietly skips Free users.
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

async function picks(supabase: any) {
  const { data } = await supabase
    .from("markets")
    .select("id,name,category,unit,band_width,band_is_pct,resolution_at")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(20);
  return data || [];
}

async function aiRank(markets: any[], goals: any[]): Promise<{ market_id: string; reason: string }[]> {
  if (!markets.length) return [];
  const prompt = `You are Scout, a market-analyst agent for the Driftworks paper-trading platform.
The user's active goals:
${goals.map((g) => `- ${g.title} (target ${g.target_return_pct ?? "?"}%, max loss ${g.max_loss ?? "?"})`).join("\n") || "(none set)"}

Open markets (id · name · category):
${markets.map((m) => `- ${m.id} · ${m.name} · ${m.category || "general"}`).join("\n")}

Return STRICT JSON: {"picks":[{"market_id":"<uuid>","reason":"<<= 140 chars>"}]} with up to 3 picks.
Pick markets that best match the goals' risk tolerance. Be specific about why.`;

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) {
    console.error("scout ai", r.status, await r.text());
    return [];
  }
  const j = await r.json();
  try {
    const parsed = JSON.parse(j.choices?.[0]?.message?.content || "{}");
    return Array.isArray(parsed.picks) ? parsed.picks.slice(0, 3) : [];
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { data: subs } = await supabase
      .from("subscriptions")
      .select("user_id,tier")
      .in("tier", ["pro_trader", "creator_pro"]);
    const eligible = subs || [];

    const markets = await picks(supabase);
    const results: any[] = [];

    for (const s of eligible) {
      const { data: goals } = await supabase
        .from("user_goals")
        .select("title,target_return_pct,max_loss")
        .eq("user_id", s.user_id)
        .eq("status", "active");

      const ideas = await aiRank(markets, goals || []);
      if (!ideas.length) continue;

      const rows = ideas.map((p) => {
        const m = markets.find((x: any) => x.id === p.market_id);
        return {
          user_id: s.user_id,
          market_id: p.market_id,
          kind: "trade_idea",
          title: m ? `Scout pick: ${m.name}` : "Scout pick",
          body_md: p.reason,
          metrics: { source: "scout", market_id: p.market_id },
        };
      });
      const { error } = await supabase.from("caretaker_events").insert(rows);
      if (error) console.error("insert events", error);
      results.push({ user_id: s.user_id, ideas: ideas.length });
    }

    return new Response(JSON.stringify({ users: eligible.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("scout error", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
