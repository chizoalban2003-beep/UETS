// assessment-sim: runs a scripted 3-market scenario, asks an AI to act as both
// the player's reference policy and the grader, and returns score + feedback.
// Persists an attempt and updates eligibility on pass.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SIM_PASS = 75;

const SCENARIO = `Driftworks scripted scenario: 5 ticks, 3 markets.

Markets:
  A) BTC-USD — trend $60,000, band ±5%. Series: 60000, 61500, 64200 (BREACH up), 63800, 61200 (back inside)
  B) NVDA — trend $900, band ±8%. Series: 900, 920, 950, 1010 (BREACH), 1080 (further BREACH)
  C) NYC-TEMP — trend 22°C, band ±4°C absolute. Series: 22, 23, 21, 22, 22 (always inside)

Starting balance §5,000. The candidate makes one decision per tick across the markets:
  - For each market: one of {hold, buy_snapback_yes (10), buy_snapback_no (10), buy_distortion_yes (10), buy_distortion_no (10)}.
  - 1% fee applies. AMM seeded 1000/1000 each contract.

Optimal-policy reference (what a skilled trader would do, scored against):
  - A: at tick 3 BREACH, BUY snapback_yes (mean-reversion play; price drops, reverts) and AT tick 5 take profit.
  - B: trending breach away from band, BUY distortion_yes (or snapback_no); momentum continues.
  - C: stays inside; hold or take small distortion_no positions to collect (1 - small distortion) at resolution.

Pitfalls graded harshly:
  - Buying both snapback YES and NO on same market (no edge, just fees).
  - Doubling correlated positions (A and B are both risk-on; long snapback on both = correlated bet).
  - Ignoring fees by overtrading (>2 trades per market).
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "auth required" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "invalid jwt" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // For now: AI plays as the candidate at a configurable skill level (default = good but imperfect),
  // then grades itself against the reference. This keeps the UX one-click while exercising the
  // full grading pipeline. A future iteration will let the user enter their own decisions.
  const messages = [
    { role: "system", content: "You are the Caretaker for Driftworks. You roleplay a candidate making trading decisions in a scripted scenario, then grade those decisions against an optimal reference. Be strict but fair." },
    { role: "user", content: `${SCENARIO}\n\nGenerate a plausible candidate trade log (a real user attempting the scenario), then grade it.\n\nReturn STRICT JSON with this shape:\n{\n  "candidate_log": "<markdown table or list of decisions per tick>",\n  "total_score": <integer 0-100>,\n  "decisions": [\n    {\n      "index": <number>,\n      "user_action": "<string: what the candidate did>",\n      "optimal_action": "<string: what was ideal>",\n      "points_awarded": <number>,\n      "points_possible": <number>,\n      "explanation": "<1 sentence: why optimal was better or same>"\n    }\n  ],\n  "summary": "<2 sentences: what they did well, what to improve>",\n  "pass": <boolean: total_score >= 75>\n}\n\nNo prose outside the JSON.` },
  ];

  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages,
      response_format: { type: "json_object" },
    }),
  });

  if (aiResp.status === 429) return json({ error: "AI rate limit, try again in a moment" }, 429);
  if (aiResp.status === 402) return json({ error: "AI credits exhausted" }, 402);
  if (!aiResp.ok) {
    const t = await aiResp.text().catch(() => "");
    return json({ error: `AI error: ${t.slice(0, 200)}` }, 500);
  }
  const aiJson = await aiResp.json();
  const raw = aiJson?.choices?.[0]?.message?.content || "{}";
  let parsed: any = {};
  try { parsed = JSON.parse(raw); } catch { parsed = { total_score: 0, summary: "Could not parse AI response.", candidate_log: raw, decisions: [] }; }

  const score = Math.max(0, Math.min(100, Number(parsed.total_score ?? parsed.score) || 0));
  const passed = score >= SIM_PASS;
  const summary = String(parsed.summary || parsed.feedback || "");
  const decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];

  await sb.from("assessment_attempts").insert({
    user_id: user.id, stage: "sim", score, passed,
    details: { summary, decisions, candidate_log: parsed.candidate_log || null },
  });

  if (passed) {
    const { data: existing } = await sb.from("user_capital_eligibility").select("*").eq("user_id", user.id).maybeSingle();
    const now = new Date().toISOString();
    if (existing) {
      await sb.from("user_capital_eligibility").update({
        sim_passed_at: existing.sim_passed_at || now,
        eligible: !!existing.quiz_passed_at,
      }).eq("user_id", user.id);
    } else {
      await sb.from("user_capital_eligibility").insert({
        user_id: user.id, sim_passed_at: now, eligible: false,
      });
    }
  }

  return json({ ok: true, score, passed, summary, decisions, candidate_log: parsed.candidate_log });
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
