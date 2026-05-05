// agent-scheduler — triggered by pg_cron every 5 minutes.
// Queries agent_schedules where active=true AND next_run_at <= now(),
// resets each plan to draft, calls agent-run, and advances next_run_at.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Parse a simple cron expression and return the next UTC Date after `from`.
 * Supports common patterns; falls back to +5 minutes for unrecognised expressions.
 */
function nextRunAt(cronExpr: string, from: Date): Date {
  const now = from.getTime();
  if (cronExpr === "*/5 * * * *")  return new Date(now + 5 * 60_000);
  if (cronExpr === "*/15 * * * *") return new Date(now + 15 * 60_000);
  if (cronExpr === "*/30 * * * *") return new Date(now + 30 * 60_000);
  if (cronExpr === "0 * * * *")    return new Date(now + 60 * 60_000);

  // "0 H * * *" — daily at H:00 UTC
  const dailyMatch = /^0 (\d+) \* \* \*$/.exec(cronExpr);
  if (dailyMatch) {
    const h = parseInt(dailyMatch[1], 10);
    const next = new Date(from);
    next.setUTCHours(h, 0, 0, 0);
    if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  // "0 H * * 1-5" — weekdays at H:00 UTC
  const weekdayMatch = /^0 (\d+) \* \* 1-5$/.exec(cronExpr);
  if (weekdayMatch) {
    const h = parseInt(weekdayMatch[1], 10);
    const next = new Date(from);
    next.setUTCHours(h, 0, 0, 0);
    if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
    // Skip to next weekday (Mon–Fri)
    while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    return next;
  }

  // Fallback: +5 minutes
  return new Date(now + 5 * 60_000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // This endpoint is called by pg_cron using the service key — verify it.
  const auth = req.headers.get("Authorization") || "";
  if (!auth.includes(SERVICE_KEY.slice(0, 20))) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = new Date();

  // Find all due schedules
  const { data: schedules, error: fetchErr } = await supabase
    .from("agent_schedules")
    .select("id, plan_id, cron_expr, user_id")
    .eq("active", true)
    .lte("next_run_at", now.toISOString());

  if (fetchErr) {
    console.error("agent-scheduler fetch error:", fetchErr);
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const triggered: string[] = [];

  for (const sched of schedules || []) {
    try {
      // Reset plan to draft so it runs fresh
      const { error: resetErr } = await supabase
        .from("agent_plans")
        .update({ status: "draft", current_step: 0, updated_at: now.toISOString() })
        .eq("id", sched.plan_id)
        .eq("user_id", sched.user_id);

      if (resetErr) {
        console.error(`Failed to reset plan ${sched.plan_id}:`, resetErr);
        continue;
      }

      // Invoke agent-run for this plan
      const runResp = await fetch(`${SUPABASE_URL}/functions/v1/agent-run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
        },
        body: JSON.stringify({ plan_id: sched.plan_id, user_id: sched.user_id }),
      });

      if (!runResp.ok) {
        const errText = await runResp.text().catch(() => "");
        console.error(`agent-run failed for plan ${sched.plan_id}: ${errText}`);
      } else {
        triggered.push(sched.plan_id);
      }

      // Advance next_run_at
      const nextRun = nextRunAt(sched.cron_expr, now);
      await supabase
        .from("agent_schedules")
        .update({ last_run_at: now.toISOString(), next_run_at: nextRun.toISOString() })
        .eq("id", sched.id);
    } catch (err) {
      console.error(`agent-scheduler error for schedule ${sched.id}:`, err);
    }
  }

  return new Response(
    JSON.stringify({ triggered: triggered.length, schedules: triggered }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
