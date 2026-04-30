// Caretaker chat — streaming AI co-pilot.
// Uses Lovable AI Gateway with tool calling. Read-only tools run inline.
// Mutating tools either auto-execute (autopilot mode) or return as pending approvals.
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const READ_ONLY_TOOLS = new Set(["get_portfolio", "get_market_snapshot", "list_top_markets", "list_goals", "run_backtest", "suggest_hedges"]);
const MUTATING_TOOLS = new Set(["place_trade", "create_market_from_template", "update_bot_config", "set_goal", "generate_report", "reset_paper_balance"]);

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_portfolio",
      description: "Returns the user's wallet balance, open positions with mark-to-market, recent trades, and realized P&L.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_market_snapshot",
      description: "Snapshot of one market: latest value, trend, distortion, contract prices.",
      parameters: {
        type: "object",
        properties: { market_id: { type: "string" } },
        required: ["market_id"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_top_markets",
      description: "Top live markets ordered by trade activity in the last 7 days.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "default 5" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_goals",
      description: "List the user's active trading goals.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "set_goal",
      description: "Create a new trading goal for the user.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          target_return_pct: { type: "number" },
          max_loss: { type: "number" },
          deadline_days: { type: "number", description: "Days from now until deadline" },
          notes: { type: "string" },
        },
        required: ["title"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "place_trade",
      description: "Buy or sell shares of a contract on a market.",
      parameters: {
        type: "object",
        properties: {
          contract_id: { type: "string" },
          side: { type: "string", enum: ["buy_yes", "buy_no", "sell_yes", "sell_no"] },
          shares: { type: "number" },
          rationale: { type: "string" },
        },
        required: ["contract_id", "side", "shares", "rationale"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_market_from_template",
      description: "Spin up a new live market from a template id (e.g. 'btc-usd', 'eth-usd', 'aapl', 'nvda', 'weather-nyc', 'co2-mlo').",
      parameters: {
        type: "object",
        properties: {
          template_id: { type: "string" },
          resolution_days: { type: "number", description: "Days from now to resolve. Default 14." },
          rationale: { type: "string" },
        },
        required: ["template_id", "rationale"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_bot_config",
      description: "Adjust the trading bot: mode, strategy, risk caps, watchlist.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["off", "suggest", "approve", "auto"] },
          strategy: { type: "string", enum: ["mean_reversion", "momentum", "custom"] },
          max_position_size: { type: "number" },
          max_daily_loss: { type: "number" },
          enabled_market_ids: { type: "array", items: { type: "string" } },
          rationale: { type: "string" },
        },
        required: ["rationale"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_report",
      description: "Generate an on-demand performance report covering a recent period.",
      parameters: {
        type: "object",
        properties: { days: { type: "number", description: "Lookback in days. Default 7." } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_backtest",
      description: "Replay how the bot would have performed against historical data on selected markets. Read-only simulation.",
      parameters: {
        type: "object",
        properties: {
          market_ids: { type: "array", items: { type: "string" } },
          lookback_days: { type: "number", description: "7-90, default 30" },
          strategy: { type: "string", enum: ["mean_reversion", "momentum"] },
        },
        required: ["market_ids"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_hedges",
      description: "Analyze current positions across markets, compute correlations, and propose offsetting trades to reduce correlated exposure. Returns proposals as readable suggestions; the user can ask you to place_trade them after.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "reset_paper_balance",
      description: "Reset the user's paper-trading wallet back to §10,000 and zero out all open positions. Rate-limited to once per 24h.",
      parameters: {
        type: "object",
        properties: { rationale: { type: "string" } },
        required: ["rationale"], additionalProperties: false,
      },
    },
  },
];

async function getUserContext(supabase: any, userId: string) {
  const [{ data: wallet }, { data: positions }, { data: bot }, { data: goals }, { data: recentTrades }] = await Promise.all([
    supabase.from("wallets").select("balance").eq("user_id", userId).maybeSingle(),
    supabase.from("positions").select("*, contracts(market_id, kind, reserve_yes, reserve_no, markets(name, unit, status))").eq("user_id", userId),
    supabase.from("bots").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("user_goals").select("*").eq("user_id", userId).eq("status", "active"),
    supabase.from("trades").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
  ]);
  return { wallet, positions: positions || [], bot, goals: goals || [], recentTrades: recentTrades || [] };
}

async function execTool(supabase: any, userId: string, name: string, args: any) {
  if (name === "get_portfolio") {
    const ctx = await getUserContext(supabase, userId);
    const realized = ctx.recentTrades.reduce((a: number, t: any) => a + (t.side?.startsWith("sell") ? Number(t.cost) : -Number(t.cost) - Number(t.fee || 0)), 0);
    return {
      balance: Number(ctx.wallet?.balance || 0),
      open_positions: ctx.positions.length,
      realized_pnl_recent: realized,
      positions: ctx.positions.map((p: any) => ({
        market: p.contracts?.markets?.name,
        kind: p.contracts?.kind,
        yes_shares: Number(p.yes_shares),
        no_shares: Number(p.no_shares),
        cost_basis: Number(p.cost_basis_yes) + Number(p.cost_basis_no),
      })),
      bot: { mode: ctx.bot?.mode, caretaker_mode: ctx.bot?.caretaker_mode, max_position_size: ctx.bot?.max_position_size },
    };
  }
  if (name === "get_market_snapshot") {
    const { data: m } = await supabase.from("markets").select("*").eq("id", args.market_id).maybeSingle();
    if (!m) return { error: "market not found" };
    const { data: pts } = await supabase.from("market_data_points").select("ts,value").eq("market_id", args.market_id).order("ts", { ascending: false }).limit(50);
    const { data: cts } = await supabase.from("contracts").select("*").eq("market_id", args.market_id);
    return {
      name: m.name, unit: m.unit, status: m.status, trend_model: m.trend_model,
      band_width: Number(m.band_width), band_is_pct: m.band_is_pct,
      latest: pts?.[0] ? { ts: pts[0].ts, value: Number(pts[0].value) } : null,
      contracts: (cts || []).map((c: any) => ({
        id: c.id, kind: c.kind,
        prob_yes: Number(c.reserve_no) / (Number(c.reserve_yes) + Number(c.reserve_no)),
      })),
    };
  }
  if (name === "list_top_markets") {
    const { data } = await supabase.rpc("pick_top_live_markets", { _limit: args.limit || 5 });
    if (!data || !data.length) return { markets: [] };
    const { data: mkts } = await supabase.from("markets").select("id,name,category,unit,status").in("id", data);
    return { markets: mkts || [] };
  }
  if (name === "list_goals") {
    const { data } = await supabase.from("user_goals").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    return { goals: data || [] };
  }
  if (name === "set_goal") {
    const deadline = args.deadline_days ? new Date(Date.now() + args.deadline_days * 86400000).toISOString() : null;
    const { data, error } = await supabase.from("user_goals").insert({
      user_id: userId, title: args.title,
      target_return_pct: args.target_return_pct ?? null,
      max_loss: args.max_loss ?? null,
      deadline, notes: args.notes ?? null,
    }).select().single();
    if (error) return { error: error.message };
    return { ok: true, goal: data };
  }
  if (name === "place_trade") {
    const { data: bot } = await supabase.from("bots").select("max_position_size").eq("user_id", userId).maybeSingle();
    if (bot?.max_position_size && args.shares > bot.max_position_size) {
      return { error: `Trade exceeds bot max_position_size (${bot.max_position_size})` };
    }
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${args._user_jwt}` } },
    });
    const { data, error } = await userClient.rpc("execute_trade", {
      _contract_id: args.contract_id, _side: args.side, _shares: args.shares, _by_bot: true,
    });
    if (error) return { error: error.message };
    return { ok: true, trade: data };
  }
  if (name === "create_market_from_template") {
    const TEMPLATES: Record<string, any> = {
      "btc-usd": { label: "Bitcoin (BTC) price", category: "Crypto", unit: "USD", trend_model: "ewma", band_width: 8, band_is_pct: true, provider: "coingecko", provider_params: { id: "bitcoin", vs: "usd" }, fetch_interval_minutes: 15 },
      "eth-usd": { label: "Ethereum (ETH) price", category: "Crypto", unit: "USD", trend_model: "ewma", band_width: 8, band_is_pct: true, provider: "coingecko", provider_params: { id: "ethereum", vs: "usd" }, fetch_interval_minutes: 15 },
      "sol-usd": { label: "Solana (SOL) price", category: "Crypto", unit: "USD", trend_model: "bollinger", band_width: 0, band_is_pct: false, provider: "coingecko", provider_params: { id: "solana", vs: "usd" }, fetch_interval_minutes: 15 },
      "aapl": { label: "Apple (AAPL) price", category: "Stocks", unit: "USD", trend_model: "linear", band_width: 5, band_is_pct: true, provider: "yahoo", provider_params: { symbol: "AAPL" }, fetch_interval_minutes: 60 },
      "nvda": { label: "Nvidia (NVDA) price", category: "Stocks", unit: "USD", trend_model: "log_linear", band_width: 10, band_is_pct: true, provider: "yahoo", provider_params: { symbol: "NVDA" }, fetch_interval_minutes: 60 },
      "tsla": { label: "Tesla (TSLA) price", category: "Stocks", unit: "USD", trend_model: "ewma", band_width: 12, band_is_pct: true, provider: "yahoo", provider_params: { symbol: "TSLA" }, fetch_interval_minutes: 60 },
      "weather-nyc": { label: "NYC temperature", category: "Weather", unit: "°C", trend_model: "seasonal", band_width: 4, band_is_pct: false, provider: "open-meteo", provider_params: { lat: 40.71, lon: -74.01, variable: "temperature_2m" }, fetch_interval_minutes: 60 },
      "co2-mlo": { label: "Atmospheric CO₂ (Mauna Loa)", category: "Climate", unit: "ppm", trend_model: "log_linear", band_width: 1, band_is_pct: true, provider: "nasa-co2", provider_params: {}, fetch_interval_minutes: 1440 },
    };
    const t = TEMPLATES[args.template_id];
    if (!t) return { error: `unknown template ${args.template_id}` };
    const { data: ds, error: dsErr } = await supabase.from("data_sources").insert({
      creator_id: userId, kind: "provider", provider: t.provider,
      provider_params: t.provider_params, fetch_interval_minutes: t.fetch_interval_minutes,
    }).select().single();
    if (dsErr) return { error: dsErr.message };
    const days = args.resolution_days || 14;
    const { data: m, error: mErr } = await supabase.from("markets").insert({
      creator_id: userId, name: t.label, description: args.rationale,
      category: t.category, unit: t.unit,
      trend_model: t.trend_model, band_width: t.band_width, band_is_pct: t.band_is_pct,
      resolution_at: new Date(Date.now() + days * 86400000).toISOString(),
      data_source_id: ds.id,
    }).select().single();
    if (mErr) return { error: mErr.message };
    return { ok: true, market_id: m.id, name: m.name };
  }
  if (name === "update_bot_config") {
    const update: any = {};
    for (const k of ["mode", "strategy", "max_position_size", "max_daily_loss", "enabled_market_ids"]) {
      if (args[k] !== undefined) update[k] = args[k];
    }
    const { data, error } = await supabase.from("bots").update(update).eq("user_id", userId).select().single();
    if (error) return { error: error.message };
    return { ok: true, bot: data };
  }
  if (name === "generate_report") {
    const days = args.days || 7;
    const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-report`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, kind: "on_demand", days }),
    });
    const j = await r.json();
    return j;
  }
  return { error: `unknown tool ${name}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return new Response(JSON.stringify({ error: "auth required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user } } = await createClient(SUPABASE_URL, Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  }).auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "invalid jwt" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
  const message = body?.message;
  if (!message || typeof message !== "string") {
    return new Response(JSON.stringify({ error: "message required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  await supabase.from("caretaker_messages").insert({ user_id: user.id, role: "user", content: message });

  const ctx = await getUserContext(supabase, user.id);
  const { data: history } = await supabase.from("caretaker_messages")
    .select("role,content,tool_calls,tool_call_id,result")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(40);

  const systemPrompt = `You are the Caretaker — a financial co-pilot for an "Elastic Trend Markets" trading platform.

You can chat, plan, set goals, place trades on the user's behalf (with their permission), spin up new live markets, adjust the trading bot, and generate reports. Be concise, specific, and proactive.

Current user state:
- Cash balance: $${Number(ctx.wallet?.balance || 0).toFixed(2)} (paper trading)
- Open positions: ${ctx.positions.length}
- Bot mode: ${ctx.bot?.mode || "off"}; caretaker mode: ${ctx.bot?.caretaker_mode || "assist"}
- Active goals: ${ctx.goals.length ? ctx.goals.map((g: any) => g.title).join(", ") : "none"}
- Risk caps: max position ${ctx.bot?.max_position_size}, max daily loss ${ctx.bot?.max_daily_loss}

How markets work: each market tracks a real-world series with a "trend" (linear/EWMA/Bollinger/etc.) and an elasticity band. Two contracts per market: DISTORTION (pays out proportional to how far the value ends up outside the band) and SNAPBACK (binary: does it finish inside the band?). Constant-product AMM.

When a tool requires user approval (mode=assist), the system surfaces an approval card automatically — just call the tool and explain what you're trying to do.

Keep messages tight. Use markdown. Lead with insight, then action.`;

  const conv: any[] = [{ role: "system", content: systemPrompt }];
  for (const h of history || []) {
    if (h.role === "assistant" && h.tool_calls) {
      conv.push({ role: "assistant", content: h.content || "", tool_calls: h.tool_calls });
    } else if (h.role === "tool") {
      conv.push({ role: "tool", tool_call_id: h.tool_call_id, content: JSON.stringify(h.result) });
    } else if (h.content) {
      conv.push({ role: h.role, content: h.content });
    }
  }

  const isAutopilot = ctx.bot?.caretaker_mode === "autopilot";
  const isReadOnly = ctx.bot?.caretaker_mode === "chat";

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: any) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch {}
      };

      try {
        for (let step = 0; step < 5; step++) {
          const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: conv,
              tools: isReadOnly ? TOOLS.filter((t) => READ_ONLY_TOOLS.has(t.function.name)) : TOOLS,
              stream: true,
            }),
          });

          if (aiResp.status === 429) { send({ type: "error", error: "Rate limit, please wait a moment." }); break; }
          if (aiResp.status === 402) { send({ type: "error", error: "AI credits exhausted. Add funds in Settings → Workspace → Usage." }); break; }
          if (!aiResp.ok || !aiResp.body) {
            const t = await aiResp.text().catch(() => "");
            send({ type: "error", error: `AI error: ${t.slice(0, 300)}` });
            break;
          }

          const reader = aiResp.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          let assistantContent = "";
          const toolAcc: Record<number, { id?: string; name?: string; args: string }> = {};
          let streamDone = false;

          while (!streamDone) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });

            let nl: number;
            while ((nl = buf.indexOf("\n")) !== -1) {
              let line = buf.slice(0, nl);
              buf = buf.slice(nl + 1);
              if (line.endsWith("\r")) line = line.slice(0, -1);
              if (!line || line.startsWith(":")) continue;
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6).trim();
              if (payload === "[DONE]") { streamDone = true; break; }
              let chunk: any;
              try { chunk = JSON.parse(payload); }
              catch {
                buf = line + "\n" + buf;
                break;
              }
              const delta = chunk?.choices?.[0]?.delta;
              if (!delta) continue;
              if (typeof delta.content === "string" && delta.content.length) {
                assistantContent += delta.content;
                send({ type: "text", delta: delta.content });
              }
              if (Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!toolAcc[idx]) toolAcc[idx] = { args: "" };
                  if (tc.id) toolAcc[idx].id = tc.id;
                  if (tc.function?.name) toolAcc[idx].name = tc.function.name;
                  if (tc.function?.arguments) toolAcc[idx].args += tc.function.arguments;
                }
              }
            }
          }

          const toolCalls = Object.keys(toolAcc)
            .map((k) => Number(k))
            .sort((a, b) => a - b)
            .map((i) => {
              const a = toolAcc[i];
              return { id: a.id || `call_${i}`, type: "function", function: { name: a.name || "", arguments: a.args || "{}" } };
            })
            .filter((tc) => tc.function.name);

          if (toolCalls.length === 0) {
            await supabase.from("caretaker_messages").insert({ user_id: user.id, role: "assistant", content: assistantContent });
            send({ type: "done" });
            break;
          }

          const pendingApprovals: any[] = [];
          const executedResults: any[] = [];
          for (const tc of toolCalls) {
            const name = tc.function.name;
            let args: any = {};
            try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
            if (READ_ONLY_TOOLS.has(name)) {
              send({ type: "tool_call", id: tc.id, name, status: "running" });
              const res = await execTool(supabase, user.id, name, args);
              executedResults.push({ id: tc.id, name, res });
              send({ type: "tool_call", id: tc.id, name, status: "done" });
            } else if (MUTATING_TOOLS.has(name)) {
              if (isReadOnly) {
                executedResults.push({ id: tc.id, name, res: { error: "Caretaker is in chat-only mode; cannot execute actions." } });
              } else if (isAutopilot) {
                send({ type: "tool_call", id: tc.id, name, status: "running" });
                const res = await execTool(supabase, user.id, name, { ...args, _user_jwt: jwt });
                executedResults.push({ id: tc.id, name, res });
                send({ type: "tool_call", id: tc.id, name, status: "done" });
              } else {
                pendingApprovals.push({ id: tc.id, name, args });
              }
            } else {
              executedResults.push({ id: tc.id, name, res: { error: `unknown tool ${name}` } });
            }
          }

          await supabase.from("caretaker_messages").insert({
            user_id: user.id, role: "assistant", content: assistantContent,
            tool_calls: toolCalls, pending_approval: pendingApprovals.length > 0,
          });

          conv.push({ role: "assistant", content: assistantContent, tool_calls: toolCalls });
          for (const r of executedResults) {
            await supabase.from("caretaker_messages").insert({
              user_id: user.id, role: "tool", tool_call_id: r.id, result: r.res, content: JSON.stringify(r.res),
            });
            conv.push({ role: "tool", tool_call_id: r.id, content: JSON.stringify(r.res) });
          }

          if (pendingApprovals.length > 0) {
            send({ type: "pending", items: pendingApprovals });
            send({ type: "done" });
            break;
          }
        }
      } catch (e: any) {
        console.error("caretaker-chat stream error", e);
        try { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "error", error: String(e?.message || e) })}\n\n`)); } catch {}
      } finally {
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
