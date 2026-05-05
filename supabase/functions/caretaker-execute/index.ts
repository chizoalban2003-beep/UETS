// Executes a single approved tool call from the caretaker.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return new Response(JSON.stringify({ error: "auth required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "invalid jwt" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { tool_call_id, tool_name, args, approved } = await req.json();
    if (!tool_call_id || !tool_name) {
      return new Response(JSON.stringify({ error: "tool_call_id and tool_name required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!approved) {
      // Mark as rejected
      await supabase.from("caretaker_messages").insert({
        user_id: user.id, role: "tool", tool_call_id, content: "rejected by user",
        result: { rejected: true }, approved: false,
      });
      return new Response(JSON.stringify({ ok: true, rejected: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let result: any;
    if (tool_name === "place_trade") {
      const { data: bot } = await supabase.from("bots").select("max_position_size").eq("user_id", user.id).maybeSingle();
      if (bot?.max_position_size && args.shares > bot.max_position_size) {
        result = { error: `Exceeds max_position_size (${bot.max_position_size})` };
      } else {
        const { data, error } = await userClient.rpc("execute_trade", {
          _contract_id: args.contract_id, _side: args.side, _shares: args.shares, _by_bot: true,
        });
        result = error ? { error: error.message } : { ok: true, trade: data };
      }
    } else if (tool_name === "set_goal") {
      const deadline = args.deadline_days ? new Date(Date.now() + args.deadline_days * 86400000).toISOString() : null;
      const { data, error } = await supabase.from("user_goals").insert({
        user_id: user.id, title: args.title,
        target_return_pct: args.target_return_pct ?? null,
        max_loss: args.max_loss ?? null,
        deadline, notes: args.notes ?? null,
      }).select().single();
      result = error ? { error: error.message } : { ok: true, goal: data };
    } else if (tool_name === "update_bot_config") {
      const update: any = {};
      for (const k of ["mode", "strategy", "max_position_size", "max_daily_loss", "enabled_market_ids"]) {
        if (args[k] !== undefined) update[k] = args[k];
      }
      const { data, error } = await supabase.from("bots").update(update).eq("user_id", user.id).select().single();
      result = error ? { error: error.message } : { ok: true, bot: data };
    } else if (tool_name === "create_market_from_template") {
      // Re-call caretaker-chat tool via inline copy — simpler: dispatch to caretaker-chat exec via POST
      const r = await fetch(`${SUPABASE_URL}/functions/v1/caretaker-chat`, {
        method: "POST", headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: `__execute_create_market:${args.template_id}:${args.resolution_days || 14}:${args.rationale || ""}` }),
      });
      result = { ok: r.ok, status: r.status };
    } else if (tool_name === "schedule_alert") {
      const { data, error } = await supabase.from("caretaker_alerts").insert({
        user_id: user.id, market_id: args.market_id, condition: args.condition, label: args.label || null,
      }).select().single();
      result = error ? { error: error.message } : { ok: true, alert: data };
    } else if (tool_name === "remember") {
      const { error } = await supabase.from("caretaker_memory").upsert({
        user_id: user.id, key: args.key, value: args.value, updated_at: new Date().toISOString(),
      });
      result = error ? { error: error.message } : { ok: true };
    } else if (tool_name === "forget") {
      const { error } = await supabase.from("caretaker_memory").delete().eq("user_id", user.id).eq("key", args.key);
      result = error ? { error: error.message } : { ok: true };
    } else if (tool_name === "pause_bot") {
      const { error } = await supabase.from("bots").update({ mode: "off" }).eq("user_id", user.id);
      result = error ? { error: error.message } : { ok: true };
    } else if (tool_name === "resume_bot") {
      const { error } = await supabase.from("bots").update({ mode: "suggest" }).eq("user_id", user.id);
      result = error ? { error: error.message } : { ok: true };
    } else if (tool_name === "request_payout") {
      const { data, error } = await userClient.rpc("payout_creator", { _market_id: args.market_id });
      result = error ? { error: error.message } : { ok: true, market: data };
    } else if (tool_name === "generate_report") {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-report`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, kind: "on_demand", days: args.days || 7 }),
      });
      result = await r.json();
    } else {
      result = { error: `unsupported tool ${tool_name}` };
    }

    await supabase.from("caretaker_messages").insert({
      user_id: user.id, role: "tool", tool_call_id, result, content: JSON.stringify(result), approved: true,
    });
    return new Response(JSON.stringify({ ok: true, result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
