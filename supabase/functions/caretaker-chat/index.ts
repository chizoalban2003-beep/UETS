// Caretaker chat — streaming AI co-pilot.
// Uses Lovable AI Gateway with tool calling. Read-only tools run inline.
// Mutating tools either auto-execute (autopilot mode) or return as pending approvals.
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const READ_ONLY_TOOLS = new Set([
  "get_portfolio", "get_market_snapshot", "list_top_markets", "list_goals",
  "run_backtest", "suggest_hedges", "explain_concept", "list_briefings",
  "search_markets", "analyze_market", "analyze_portfolio", "simulate_trade",
  "draft_market", "list_alerts", "list_notifications",
]);
const MUTATING_TOOLS = new Set([
  "place_trade", "create_market_from_template", "update_bot_config", "set_goal",
  "generate_report", "reset_paper_balance",
  "schedule_alert", "delete_alert", "remember", "forget",
  "pause_bot", "resume_bot", "request_payout",
]);

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
  {
    type: "function",
    function: {
      name: "explain_concept",
      description: "Return a focused mini-lesson on a Driftworks concept, adapted to the user's skill level. Use when the user is confused, asks 'why', or when you want to teach alongside a suggestion.",
      parameters: {
        type: "object",
        properties: {
          concept: { type: "string", description: "e.g. 'band width', 'distortion vs snapback', 'AMM pricing', 'fees', 'hedging', 'mean reversion'" },
          context_market_id: { type: "string", description: "Optional market id to ground the lesson with concrete numbers." },
        },
        required: ["concept"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_briefings",
      description: "List the user's recent Caretaker event briefings (pre-event, live updates, post-event recaps). Useful when the user asks 'what happened' or 'what's next'.",
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
      name: "search_markets",
      description: "Search live markets by keyword/category/status. Returns up to 20 matches.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          category: { type: "string" },
          status: { type: "string", enum: ["draft", "open", "pending_resolution", "disputable", "resolved", "cancelled"] },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_market",
      description: "Deep analysis of a single market: latest data, distortion estimate, contract prices, position concentration flags, and a textual brief. Use before suggesting trades.",
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
      name: "analyze_portfolio",
      description: "Portfolio analysis: P&L, exposure by category, risk concentration, suggested rebalances. Read-only.",
      parameters: {
        type: "object",
        properties: { window_days: { type: "number", description: "default 30" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "simulate_trade",
      description: "Dry-run a trade: returns expected price, slippage, post-trade prob_yes, and worst/best case payouts. No state changes.",
      parameters: {
        type: "object",
        properties: {
          contract_id: { type: "string" },
          side: { type: "string", enum: ["buy_yes", "buy_no", "sell_yes", "sell_no"] },
          shares: { type: "number" },
        },
        required: ["contract_id", "side", "shares"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_market",
      description: "Generate a market draft (name, rules_md, suggested oracle, resolution_at) from a freeform idea. Returns a structured proposal that the user can publish via /markets/new.",
      parameters: {
        type: "object",
        properties: { idea: { type: "string" }, days_to_resolve: { type: "number", description: "default 14" } },
        required: ["idea"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_alert",
      description: "Create an alert that fires when a market crosses a threshold. Condition: { kind: 'price_above'|'price_below'|'distortion_above', value: number }.",
      parameters: {
        type: "object",
        properties: {
          market_id: { type: "string" },
          label: { type: "string" },
          condition: { type: "object" },
        },
        required: ["market_id", "condition"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_alerts",
      description: "List the user's active alerts.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_alert",
      description: "Deactivate an alert by id.",
      parameters: {
        type: "object",
        properties: { alert_id: { type: "string" } },
        required: ["alert_id"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_notifications",
      description: "List the user's recent in-app notifications.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number" }, unread_only: { type: "boolean" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description: "Save a small preference / fact about the user (e.g. 'risk_tolerance' = 'low'). Use sparingly for things that affect future suggestions.",
      parameters: {
        type: "object",
        properties: { key: { type: "string" }, value: { type: "string" } },
        required: ["key", "value"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget",
      description: "Forget a previously remembered key.",
      parameters: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pause_bot",
      description: "Pause the trading bot (sets mode to 'off').",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "resume_bot",
      description: "Resume the trading bot (sets mode to 'suggest').",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "request_payout",
      description: "Claim creator payout (stake + fee share) for a resolved market the user created.",
      parameters: {
        type: "object",
        properties: { market_id: { type: "string" } },
        required: ["market_id"], additionalProperties: false,
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
  if (name === "run_backtest") {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/bot-backtest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${args._user_jwt}` },
      body: JSON.stringify({
        market_ids: args.market_ids,
        lookback_days: args.lookback_days || 30,
        strategy: args.strategy || "mean_reversion",
      }),
    });
    const j = await r.json();
    if (!r.ok) return { error: j?.error || "backtest failed" };
    return {
      total_pnl: j.aggregate?.total_pnl,
      trade_count: j.aggregate?.trade_count,
      win_rate: j.aggregate?.win_rate,
      max_drawdown: j.aggregate?.max_drawdown,
      sharpe: j.aggregate?.sharpe,
      per_market: j.per_market?.map((m: any) => ({ name: m.name, final_pnl: m.final_pnl, trades: m.trades?.length })),
    };
  }
  if (name === "suggest_hedges") {
    const { data: positions } = await supabase
      .from("positions")
      .select("id,yes_shares,no_shares,contract:contracts(id,kind,reserve_yes,reserve_no,market:markets(id,name,category,data_source_id))")
      .eq("user_id", userId);
    const open = (positions || []).filter((p: any) => Number(p.yes_shares) > 0 || Number(p.no_shares) > 0);
    if (open.length < 2) return { suggestions: [], note: "Need at least 2 open positions to suggest hedges." };

    // Pull last 30d data for each unique market
    const marketIds = [...new Set(open.map((p: any) => p.contract.market.id))];
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const seriesByMarket: Record<string, number[]> = {};
    for (const mid of marketIds) {
      const { data: pts } = await supabase.from("market_data_points")
        .select("value").eq("market_id", mid).gt("ts", since)
        .order("ts", { ascending: true }).limit(500);
      seriesByMarket[mid] = (pts || []).map((p: any) => Number(p.value));
    }

    const correlations: any[] = [];
    for (let i = 0; i < marketIds.length; i++) {
      for (let j = i + 1; j < marketIds.length; j++) {
        const a = seriesByMarket[marketIds[i]];
        const b = seriesByMarket[marketIds[j]];
        const c = pearson(a, b);
        if (c !== null) correlations.push({ a: marketIds[i], b: marketIds[j], corr: c });
      }
    }
    correlations.sort((x, y) => Math.abs(y.corr) - Math.abs(x.corr));

    const suggestions = correlations.slice(0, 3).map((c) => {
      const posA = open.find((p: any) => p.contract.market.id === c.a);
      const posB = open.find((p: any) => p.contract.market.id === c.b);
      const netA = Number(posA.yes_shares) - Number(posA.no_shares);
      const netB = Number(posB.yes_shares) - Number(posB.no_shares);
      const sameDirection = (netA > 0 && netB > 0) || (netA < 0 && netB < 0);
      const correlated = c.corr > 0.5;
      const isCorrelatedBet = sameDirection && correlated;
      return {
        markets: [posA.contract.market.name, posB.contract.market.name],
        correlation: Math.round(c.corr * 100) / 100,
        is_correlated_bet: isCorrelatedBet,
        suggestion: isCorrelatedBet
          ? `These are positively correlated (${c.corr.toFixed(2)}) and you're long-biased on both. Consider reducing one OR taking an opposite-side position on the smaller one to hedge.`
          : `Correlation ${c.corr.toFixed(2)}. Current sides already provide partial offset.`,
      };
    });
    return { suggestions, total_correlations_checked: correlations.length };
  }
  if (name === "reset_paper_balance") {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/reset-paper-balance`, {
      method: "POST",
      headers: { Authorization: `Bearer ${args._user_jwt}` },
    });
    const j = await r.json();
    return j;
  }
  if (name === "explain_concept") {
    const lessons: Record<string, { plain: string; mid: string; deep: string }> = {
      "band width": {
        plain: "Every market has a 'normal range' around its trend line — the band. As long as price stays inside, the snap-back contract pays out. Wider bands = harder to break out.",
        mid: "Band width is the half-width of the no-distortion zone around the trend (linear/EWMA/Bollinger). If `band_is_pct`, it's a % of the trend value; otherwise an absolute distance.",
        deep: "At resolution, distortion = clamp((|final − trend| − band) / (2·band), 0, 1). Snapback YES pays 1 iff |final − trend| ≤ band, else 0.",
      },
      "distortion vs snapback": {
        plain: "Two contracts per market. Snapback is a yes/no bet that price stays in the band. Distortion pays more the further price ends up outside the band.",
        mid: "Snapback YES = binary inside-band payout. Distortion YES = linear payout in the [0,1] distortion ratio. They are NOT the same direction trade.",
        deep: "Pricing both off the same constant-product AMM lets you express two views: variance (snapback NO) and tail size (distortion YES). Combine to build straddle/strangle analogs.",
      },
      "amm pricing": {
        plain: "Price is set by a pool of YES and NO shares. Buying YES drains YES from the pool, making YES more expensive. Like a Uniswap pool but for one market outcome.",
        mid: "x·y = k constant-product. Implied prob_yes = reserve_no / (reserve_yes + reserve_no). Slippage scales with trade size relative to liquidity.",
        deep: "For shares Δ on YES side: new_yes = reserve_yes − Δ, new_no = k/new_yes, cost = new_no − reserve_no. Effective price = cost / Δ. Fee taken on |gross|.",
      },
      "fees": {
        plain: "Each trade pays a small fee (1% by default) to discourage churn. It comes out of your cost on buys and your payout on sells.",
        mid: "fee_bps default 100 (1%). Applied as |gross| × fee_bps/10000. Round-trip cost is ~2% before P&L.",
        deep: "Edge needed = 2·fee + slippage. For high-frequency mean-reversion this often exceeds the actual mean-reversion alpha; size up or trade less.",
      },
      "hedging": {
        plain: "If two markets move together, holding YES on both doubles your risk. A hedge is taking the opposite side on the smaller one to flatten total exposure.",
        mid: "Pearson-correlate held markets' price series. If |corr| > 0.5 and you're net-long both, opposite-side or distortion NO on the lower-conviction one cuts net exposure.",
        deep: "Beta-weight by position size and 30d realized vol. Optimal hedge ratio h* = ρ·σ_a/σ_b. Caretaker's `suggest_hedges` ranks pairs by |corr| but not yet by h*.",
      },
      "mean reversion": {
        plain: "Bet that things stretched far from normal will snap back. Works in calm markets, fails when the trend itself is shifting.",
        mid: "Buy snapback YES when |z-score| is high but momentum is decaying. Avoid when band is widening or trend slope is changing sign.",
        deep: "Edge = E[reversion] · P(no regime change) − fees − slippage. Decay constant matters: EWMA bands adapt faster than linear, raising false-positive rate.",
      },
    };
    const key = String(args.concept || "").toLowerCase();
    const lesson = lessons[key];
    if (!lesson) return { concept: args.concept, body: `No prepared lesson for "${args.concept}". Ask me in plain English and I'll explain.` };
    let context_md = "";
    if (args.context_market_id) {
      const { data: m } = await supabase.from("markets").select("name,band_width,band_is_pct").eq("id", args.context_market_id).maybeSingle();
      if (m) context_md = `Grounded for **${m.name}**: band ${m.band_is_pct ? `${m.band_width}%` : m.band_width}.`;
    }
    return { concept: args.concept, plain: lesson.plain, intermediate: lesson.mid, advanced: lesson.deep, context: context_md };
  }
  if (name === "list_briefings") {
    const { data } = await supabase
      .from("caretaker_events")
      .select("id,kind,title,body_md,market_id,created_at,read_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(args.limit || 5);
    return { briefings: data || [] };
  }
  if (name === "search_markets") {
    let q = supabase.from("markets").select("id,name,category,unit,status,market_kind,resolution_at").limit(20);
    if (args.status) q = q.eq("status", args.status); else q = q.in("status", ["open","pending_resolution","disputable"]);
    if (args.category) q = q.eq("category", args.category);
    if (args.query) q = q.ilike("name", `%${args.query}%`);
    const { data } = await q;
    return { markets: data || [] };
  }
  if (name === "analyze_market") {
    const { data: m } = await supabase.from("markets").select("*").eq("id", args.market_id).maybeSingle();
    if (!m) return { error: "market not found" };
    const { data: pts } = await supabase.from("market_data_points").select("ts,value").eq("market_id", args.market_id).order("ts", { ascending: false }).limit(60);
    const { data: cts } = await supabase.from("contracts").select("*").eq("market_id", args.market_id);
    const { data: conc } = await supabase.rpc("detect_concentration_risk", { _market_id: args.market_id });
    const series = (pts || []).map((p: any) => Number(p.value)).reverse();
    const trend = series.length ? series.reduce((a,b)=>a+b,0)/series.length : null;
    const last = series[series.length-1] ?? null;
    const band = m.band_is_pct ? Math.abs(trend ?? 0) * (Number(m.band_width)/100) : Number(m.band_width);
    const distortion = trend != null && last != null ? Math.max(0, (Math.abs(last-trend) - band)/(2*Math.max(band,1e-6))) : null;
    return {
      name: m.name, status: m.status, market_kind: m.market_kind, unit: m.unit,
      latest: last, trend, band, distortion_estimate: distortion,
      contracts: (cts||[]).map((c:any)=>({id:c.id, kind:c.kind, prob_yes: Number(c.reserve_no)/(Number(c.reserve_yes)+Number(c.reserve_no))})),
      concentration_flags: conc || [],
    };
  }
  if (name === "analyze_portfolio") {
    const days = args.window_days || 30;
    const since = new Date(Date.now() - days*86400000).toISOString();
    const { data: trades } = await supabase.from("trades").select("*,contracts(market_id,markets(name,category))").eq("user_id", userId).gte("created_at", since);
    const { data: positions } = await supabase.from("positions").select("*,contracts(market_id,reserve_yes,reserve_no,markets(name,category))").eq("user_id", userId);
    const realized = (trades||[]).reduce((a:number,t:any)=>a+(t.side?.startsWith("sell")?Number(t.cost):-Number(t.cost)-Number(t.fee||0)),0);
    const byCategory: Record<string, number> = {};
    for (const p of positions || []) {
      const cat = p.contracts?.markets?.category || "Other";
      const exposure = (Number(p.yes_shares)+Number(p.no_shares));
      byCategory[cat] = (byCategory[cat]||0) + exposure;
    }
    const totalExposure = Object.values(byCategory).reduce((a,b)=>a+b,0);
    const concentrated = Object.entries(byCategory).filter(([,v])=>totalExposure>0 && v/totalExposure > 0.5).map(([k,v])=>({category:k, share_pct: Math.round(v/totalExposure*100)}));
    return { window_days: days, realized_pnl: realized, trade_count: trades?.length || 0, exposure_by_category: byCategory, concentration_warnings: concentrated };
  }
  if (name === "simulate_trade") {
    const { data: c } = await supabase.from("contracts").select("*").eq("id", args.contract_id).maybeSingle();
    if (!c) return { error: "contract not found" };
    const ry = Number(c.reserve_yes), rn = Number(c.reserve_no), k = ry*rn, s = Number(args.shares);
    let newYes=ry, newNo=rn, gross=0;
    try {
      if (args.side === "buy_yes") { newYes = ry-s; if (newYes<=0) return {error:"insufficient liquidity"}; newNo = k/newYes; gross = newNo-rn; }
      else if (args.side === "buy_no") { newNo = rn-s; if (newNo<=0) return {error:"insufficient liquidity"}; newYes = k/newNo; gross = newYes-ry; }
      else if (args.side === "sell_yes") { newYes = ry+s; newNo = k/newYes; gross = rn-newNo; }
      else if (args.side === "sell_no") { newNo = rn+s; newYes = k/newNo; gross = ry-newYes; }
    } catch (e:any) { return { error: String(e?.message||e) }; }
    const fee = Math.abs(gross) * (c.fee_bps||100)/10000;
    const cost = args.side.startsWith("buy") ? gross+fee : gross-fee;
    return {
      avg_price: gross/s, total_cost: cost, fee, post_prob_yes: newNo/(newYes+newNo),
      slippage_pct: ((Math.abs(gross/s) - rn/(ry+rn))/(rn/(ry+rn))*100),
    };
  }
  if (name === "draft_market") {
    const days = args.days_to_resolve || 14;
    const resolution = new Date(Date.now() + days*86400000).toISOString();
    return {
      draft: {
        name: args.idea.slice(0, 80),
        rules_md: `Resolves on ${new Date(resolution).toUTCString()}.\n\nIdea: ${args.idea}\n\nProvide a clear yes/no resolution criterion before publishing. The market should be unambiguous and verifiable from a public source.`,
        suggested_oracle: "manual",
        market_kind: "event",
        resolution_at: resolution,
      },
      next_step: "Open /markets/new and paste these fields, then refine before publishing.",
    };
  }
  if (name === "schedule_alert") {
    const { data, error } = await supabase.from("caretaker_alerts").insert({
      user_id: userId, market_id: args.market_id, condition: args.condition, label: args.label || null,
    }).select().single();
    if (error) return { error: error.message };
    return { ok: true, alert: data };
  }
  if (name === "list_alerts") {
    const { data } = await supabase.from("caretaker_alerts").select("*").eq("user_id", userId).eq("active", true).order("created_at",{ascending:false});
    return { alerts: data || [] };
  }
  if (name === "delete_alert") {
    const { error } = await supabase.from("caretaker_alerts").update({ active: false }).eq("id", args.alert_id).eq("user_id", userId);
    if (error) return { error: error.message };
    return { ok: true };
  }
  if (name === "list_notifications") {
    let q = supabase.from("notifications").select("*").eq("user_id", userId).order("created_at",{ascending:false}).limit(args.limit || 10);
    if (args.unread_only) q = q.is("read_at", null);
    const { data } = await q;
    return { notifications: data || [] };
  }
  if (name === "remember") {
    const { error } = await supabase.from("caretaker_memory").upsert({ user_id: userId, key: args.key, value: args.value, updated_at: new Date().toISOString() });
    if (error) return { error: error.message };
    return { ok: true };
  }
  if (name === "forget") {
    const { error } = await supabase.from("caretaker_memory").delete().eq("user_id", userId).eq("key", args.key);
    if (error) return { error: error.message };
    return { ok: true };
  }
  if (name === "pause_bot") {
    const { error } = await supabase.from("bots").update({ mode: "off" }).eq("user_id", userId);
    if (error) return { error: error.message };
    return { ok: true };
  }
  if (name === "resume_bot") {
    const { error } = await supabase.from("bots").update({ mode: "suggest" }).eq("user_id", userId);
    if (error) return { error: error.message };
    return { ok: true };
  }
  if (name === "request_payout") {
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${args._user_jwt}` } },
    });
    const { data, error } = await userClient.rpc("payout_creator", { _market_id: args.market_id });
    if (error) return { error: error.message };
    return { ok: true, market: data };
  }
  return { error: `unknown tool ${name}` };
}
function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 5) return null;
  const ax = a.slice(-n), bx = b.slice(-n);
  const ma = ax.reduce((x, y) => x + y, 0) / n;
  const mb = bx.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ax[i] - ma) * (bx[i] - mb);
    da += (ax[i] - ma) ** 2;
    db += (bx[i] - mb) ** 2;
  }
  const denom = Math.sqrt(da * db);
  return denom > 1e-9 ? num / denom : null;
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

  // Enforce caretaker daily quota by tier (free 25 / pro 250 / creator_pro 1000).
  const { error: quotaErr } = await supabase.rpc("consume_caretaker_quota", { _user_id: user.id, _cost: 1 });
  if (quotaErr) {
    return new Response(
      JSON.stringify({
        error: "quota_exceeded",
        message: "You've hit today's Caretaker action limit. Upgrade your plan in Billing to keep going.",
      }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }


  const ctx = await getUserContext(supabase, user.id);
  const { data: profile } = await supabase
    .from("profiles")
    .select("skill_level,caretaker_mode,display_name,caretaker_name,caretaker_voice,caretaker_language,caretaker_persona")
    .eq("id", user.id)
    .maybeSingle();
  const skill = (profile?.skill_level as string) || "beginner";
  const cmode = (profile?.caretaker_mode as string) || "suggest";
  const cname = ((profile as any)?.caretaker_name as string) || "Caretaker";
  const cvoice = ((profile as any)?.caretaker_voice as string) || "calm";
  const clang = ((profile as any)?.caretaker_language as string) || "en";
  const cpersona = ((profile as any)?.caretaker_persona as string) || "coach";
  const { data: memRows } = await supabase.from("caretaker_memory").select("key,value").eq("user_id", user.id).limit(40);
  const memoryBlock = (memRows && memRows.length)
    ? memRows.map((m: any) => `- ${m.key}: ${m.value}`).join("\n")
    : "(no saved preferences yet)";

  const { data: history } = await supabase.from("caretaker_messages")
    .select("role,content,tool_calls,tool_call_id,result")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(40);

  const SKILL_GUIDE: Record<string, string> = {
    beginner: "User is a beginner. Use plain English. Define jargon the first time you use it. Offer one tiny worked example when proposing a trade. Suggest using `explain_concept` whenever you introduce something new.",
    intermediate: "User is intermediate. Skip definitions of basic terms (band, distortion, snapback, AMM). Be tighter. Only call `explain_concept` if the user asks why.",
    advanced: "User is advanced. Be quantitative. Show key numbers (band %, distortion ratio, fee impact). Skip lessons unless asked.",
  };

  const MODE_GUIDE: Record<string, string> = {
    teach: "Teach mode: never call mutating tools (place_trade, update_bot_config, etc.). For every market you discuss, explain the setup and walk through what you would consider, but stop short of executing anything.",
    suggest: "Suggest mode: propose trades by calling `place_trade`. The system will surface an approval card automatically. Always say *why* before the call.",
    copilot: "Co-pilot mode: you may execute trades inside guardrails (max_position_size, max_daily_loss, enabled_market_ids). The execute layer enforces these. Be decisive but report what you did.",
    autopilot: "Autopilot mode: full automation within guardrails. Narrate decisions like a flight crew — calm, specific, no questions back.",
  };

  const VOICE_GUIDE: Record<string, string> = {
    calm: "Voice: calm flight-crew cadence. Specific, unhurried, no hedging. One short sentence per beat.",
    coach: "Voice: warm coach. Encouraging, second-person, end most replies with one short reflective question that helps the user think.",
    quant: "Voice: terse quant. Numbers first, no emoji, no fluff, no greetings. Bullet points over prose. Round to 2 decimals.",
    concise: "Voice: concise. Three sentences maximum unless the user explicitly asks to expand. No preamble.",
  };

  const LANG_NAME: Record<string, string> = { en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese" };
  const langLabel = LANG_NAME[clang] || "English";

  const systemPrompt = `You are ${cname} — the always-on co-pilot for Driftworks, a markets platform where users "trade the drift from trend". Your role-name is "Caretaker"; your given name is "${cname}". Refer to yourself as ${cname} when introducing yourself.

You operate across three lifecycle moments for every event: PRE (briefing + plan), DURING (live updates as price/data moves), and POST (recap + lesson). Use \`list_briefings\` if the user asks "what happened" or "what's next".

Skill level: ${skill}. ${SKILL_GUIDE[skill] || SKILL_GUIDE.beginner}

Caretaker mode: ${cmode}. ${MODE_GUIDE[cmode] || MODE_GUIDE.suggest}

${VOICE_GUIDE[cvoice] || VOICE_GUIDE.calm}

Reply language: ${langLabel}. Always reply in ${langLabel} regardless of the language the user writes in, unless the user explicitly asks you to switch.

Current user state:
- Cash balance: $${Number(ctx.wallet?.balance || 0).toFixed(2)} (paper trading)
- Open positions: ${ctx.positions.length}
- Trading bot strategy: ${ctx.bot?.strategy || "n/a"}; risk caps: max position ${ctx.bot?.max_position_size}, max daily loss ${ctx.bot?.max_daily_loss}
- Active goals: ${ctx.goals.length ? ctx.goals.map((g: any) => g.title).join(", ") : "none"}

How markets work: each market tracks a real-world series with a "trend" (linear/EWMA/Bollinger/seasonal/log_linear) and an elasticity band. Two contracts per market: DISTORTION (pays out proportional to how far the value ends up outside the band) and SNAPBACK (binary: does it finish inside the band?). Constant-product AMM with a small fee.

Persona: ${cpersona}. ${({coach:"You are a patient teacher; explain before acting; ask one short question at the end.", analyst:"You are a data-driven analyst; lead with numbers, charts, distributions; cite tool outputs.", trader:"You are a fast-talking trader; terse, direct, propose specific trades with sizes; minimize fluff.", creator:"You are a market-design partner; focus on rules clarity, oracle choice, fee strategy, fairness."} as Record<string,string>)[cpersona] || ""}

Saved user preferences (use them when relevant):
${memoryBlock}

You have many tools. ALWAYS prefer calling read-only tools (search_markets, analyze_market, analyze_portfolio, simulate_trade) BEFORE proposing actions. Chain tools when useful. Use \`remember\` when the user states a durable preference.

Lead with insight, then action. Keep messages tight. Use markdown.`;

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

  // New caretaker_mode (profiles): teach | suggest | copilot | autopilot.
  // Map to behavior:
  //   teach     → tools restricted to read-only; mutating calls are converted to lessons.
  //   suggest   → mutating tools become approval cards (default).
  //   copilot   → mutating tools auto-execute IF within bot guardrails; else fall back to approval.
  //   autopilot → mutating tools auto-execute IF within guardrails; else silently skipped + journaled.
  const isTeach = cmode === "teach";
  const isCopilot = cmode === "copilot";
  const isAutopilot = cmode === "autopilot";
  const guardCaps = {
    max_position_size: Number(ctx.bot?.max_position_size || 0),
    max_daily_loss: Number(ctx.bot?.max_daily_loss || 0),
    enabled_market_ids: (ctx.bot?.enabled_market_ids || []) as string[],
  };

  // Compute today's realized loss (negative cost flows from bot trades) for max_daily_loss check.
  const sinceMidnight = new Date(); sinceMidnight.setHours(0, 0, 0, 0);
  const { data: todaysTrades } = await supabase
    .from("trades")
    .select("side,cost,fee,by_bot,created_at")
    .eq("user_id", user.id)
    .gte("created_at", sinceMidnight.toISOString());
  const realizedToday = (todaysTrades || []).reduce((acc: number, t: any) => {
    return acc + (t.side?.startsWith("sell") ? Number(t.cost) : -Number(t.cost) - Number(t.fee || 0));
  }, 0);

  // Check whether a mutating tool call is within guardrails. Returns null if OK, or a reason string.
  async function violatesGuardrails(name: string, args: any): Promise<string | null> {
    if (name !== "place_trade") return null; // only place_trade hits position/loss caps
    if (guardCaps.max_position_size && Number(args.shares) > guardCaps.max_position_size) {
      return `shares ${args.shares} > max_position_size ${guardCaps.max_position_size}`;
    }
    if (guardCaps.max_daily_loss && realizedToday < -Math.abs(guardCaps.max_daily_loss)) {
      return `daily loss cap reached (${realizedToday.toFixed(2)} ≤ -${guardCaps.max_daily_loss})`;
    }
    if (guardCaps.enabled_market_ids?.length) {
      // resolve contract → market
      const { data: c } = await supabase.from("contracts").select("market_id").eq("id", args.contract_id).maybeSingle();
      if (c && !guardCaps.enabled_market_ids.includes(c.market_id)) {
        return `market not in enabled_market_ids`;
      }
    }
    return null;
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: any) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch {}
      };

      try {
        for (let step = 0; step < 8; step++) {
          const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: conv,
              tools: isTeach ? TOOLS.filter((t) => READ_ONLY_TOOLS.has(t.function.name)) : TOOLS,
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
              const res = await execTool(supabase, user.id, name, { ...args, _user_jwt: jwt });
              executedResults.push({ id: tc.id, name, res });
              send({ type: "tool_call", id: tc.id, name, status: "done" });
            } else if (MUTATING_TOOLS.has(name)) {
              if (isTeach) {
                executedResults.push({ id: tc.id, name, res: { error: "Caretaker is in Teach mode — describe the trade as a lesson instead of executing it." } });
              } else if (isCopilot || isAutopilot) {
                const violation = await violatesGuardrails(name, args);
                if (violation) {
                  if (isAutopilot) {
                    // Silently skip + journal it
                    await supabase.from("caretaker_events").insert({
                      user_id: user.id,
                      market_id: null,
                      kind: "action_taken",
                      title: `Skipped ${name}`,
                      body_md: `Autopilot skipped a proposed \`${name}\` because: ${violation}.`,
                      metrics: { args, violation },
                    });
                    executedResults.push({ id: tc.id, name, res: { skipped: true, reason: violation } });
                  } else {
                    // Co-pilot: fall back to approval
                    pendingApprovals.push({ id: tc.id, name, args, guardrail_warning: violation });
                  }
                } else {
                  send({ type: "tool_call", id: tc.id, name, status: "running" });
                  const res = await execTool(supabase, user.id, name, { ...args, _user_jwt: jwt });
                  executedResults.push({ id: tc.id, name, res });
                  send({ type: "tool_call", id: tc.id, name, status: "done" });
                  // Journal the action
                  await supabase.from("caretaker_events").insert({
                    user_id: user.id,
                    market_id: null,
                    kind: "action_taken",
                    title: `${cmode === "autopilot" ? "Autopilot" : "Co-pilot"} ran ${name}`,
                    body_md: `Executed \`${name}\` with args \`${JSON.stringify(args).slice(0, 240)}\`.`,
                    metrics: { args, result: res },
                  });
                }
              } else {
                // Suggest mode (default)
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
