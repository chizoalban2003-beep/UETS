// assessment-grade-quiz: persists a quiz attempt and updates eligibility.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "auth required" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "invalid jwt" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const score = Number(body.score);
  const total = Number(body.total) || 10;
  const passed = !!body.passed;
  if (!Number.isFinite(score) || score < 0 || score > total) return json({ error: "bad score" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  await sb.from("assessment_attempts").insert({
    user_id: user.id, stage: "quiz", score, passed,
    details: { total, answers: Array.isArray(body.answers) ? body.answers : null },
  });

  if (passed) {
    const { data: existing } = await sb.from("user_capital_eligibility").select("*").eq("user_id", user.id).maybeSingle();
    const now = new Date().toISOString();
    if (existing) {
      const sim_passed_at = existing.sim_passed_at;
      await sb.from("user_capital_eligibility").update({
        quiz_passed_at: existing.quiz_passed_at || now,
        eligible: !!sim_passed_at,
      }).eq("user_id", user.id);
    } else {
      await sb.from("user_capital_eligibility").insert({
        user_id: user.id, quiz_passed_at: now, eligible: false,
      });
    }
  }

  return json({ ok: true, passed });
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
