// Generates a structured performance report for a user across a period.
// Triggered on-demand via caretaker, or by cron for daily/weekly/monthly.
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const PERIOD_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30, on_demand: 7 };

async function buildOne(supabase: any, userId: string, kind: string, days: number) {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - days * 86400000);

  const [{ data: wallet }, { data: ledger }, { data: trades }, { data: positions }, { data: goals }] = await Promise.all([
    supabase.from("wallets").select("balance").eq("user_id", userId).maybeSingle(),
    supabase.from("ledger_entries").select("*").eq("user_id", userId).gte("created_at", periodStart.toISOString()).order("created_at"),
    supabase.from("trades").select("*, contracts(kind, markets(name))").eq("user_id", userId).gte("created_at", periodStart.toISOString()).order("created_at"),
    supabase.from("positions").select("*, contracts(kind, markets(name, status))").eq("user_id", userId),
    supabase.from("user_goals").select("*").eq("user_id", userId).eq("status", "active"),
  ]);

  const cashflow = (ledger || []).reduce((a: number, l: any) => a + Number(l.amount), 0);
  const tradeCount = (trades || []).length;
  const botTrades = (trades || []).filter((t: any) => t.by_bot).length;
  const fees = (trades || []).reduce((a: number, t: any) => a + Number(t.fee || 0), 0);

  const metrics = {
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    balance_now: Number(wallet?.balance || 0),
    cashflow_period: cashflow,
    trades: tradeCount,
    bot_trades: botTrades,
    fees_paid: fees,
    open_positions: (positions || []).length,
    active_goals: (goals || []).length,
  };

  // Compose a narrative with the AI gateway
  const prompt = `Write a ${kind} performance report in markdown for an Elastic Trend Markets paper-trading user.

Metrics: ${JSON.stringify(metrics)}
Recent trades (last ${tradeCount}): ${JSON.stringify((trades || []).slice(-10).map((t: any) => ({ market: t.contracts?.markets?.name, kind: t.contracts?.kind, side: t.side, shares: Number(t.shares), price: Number(t.price), by_bot: t.by_bot })))}
Open positions: ${JSON.stringify((positions || []).map((p: any) => ({ market: p.contracts?.markets?.name, kind: p.contracts?.kind, yes: Number(p.yes_shares), no: Number(p.no_shares) })))}
Active goals: ${JSON.stringify(goals || [])}

Structure:
1. **Headline** — one sentence summary
2. **Performance** — cashflow, trades, fees, hit rate
3. **Positions** — what's open and why it matters
4. **Bot activity** — what the trading bot did
5. **Goals progress** — for each active goal
6. **Recommendations** — 2-3 specific next actions

Be concrete and concise. No emojis. Use markdown tables where helpful.`;

  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: "You are a precise financial reporting assistant." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!aiResp.ok) {
    const t = await aiResp.text();
    throw new Error(`ai error ${aiResp.status}: ${t.slice(0, 200)}`);
  }
  const aiJson = await aiResp.json();
  const content = aiJson.choices?.[0]?.message?.content || "(no content)";

  const title = `${kind[0].toUpperCase() + kind.slice(1)} report — ${periodEnd.toISOString().slice(0, 10)}`;
  const { data: report, error } = await supabase.from("reports").insert({
    user_id: userId, kind, period_start: periodStart.toISOString(), period_end: periodEnd.toISOString(),
    title, content_md: content, metrics,
  }).select().single();
  if (error) throw error;
  return report;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const kind = body.kind || "on_demand";
    const days = body.days || PERIOD_DAYS[kind] || 7;

    if (body.user_id) {
      const r = await buildOne(supabase, body.user_id, kind, days);
      return new Response(JSON.stringify({ ok: true, report_id: r.id, title: r.title }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Cron path: generate for every user with at least one trade or open position
    const { data: users } = await supabase.from("wallets").select("user_id");
    const results: any[] = [];
    for (const u of users || []) {
      try {
        const r = await buildOne(supabase, u.user_id, kind, days);
        results.push({ user_id: u.user_id, ok: true, id: r.id });
      } catch (e: any) {
        results.push({ user_id: u.user_id, ok: false, error: String(e?.message || e) });
      }
    }
    return new Response(JSON.stringify({ generated: results.length, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
