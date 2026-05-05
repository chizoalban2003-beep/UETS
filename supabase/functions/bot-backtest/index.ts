// bot-backtest: pure simulation. Walks historical market_data_points,
// re-derives a simple trend (rolling mean) and band, and simulates the bot's
// decisions tick-by-tick against a virtual constant-product AMM seeded at 1000/1000.
// No DB writes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;

type Trade = { ts: string; side: string; shares: number; price: number; pnl_running: number };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "auth required" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "invalid jwt" }, 401);

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const market_ids: string[] = Array.isArray(body.market_ids) ? body.market_ids.slice(0, 10) : [];
  const lookback_days = clamp(Number(body.lookback_days) || 30, 7, 90);
  const strategy = body.strategy === "momentum" ? "momentum" : "mean_reversion";
  const max_position_size = clamp(Number(body.max_position_size) || 50, 10, 500);
  if (!market_ids.length) return json({ error: "market_ids required" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const since = new Date(Date.now() - lookback_days * 86400000).toISOString();
  const { data: markets } = await sb.from("markets").select("id,name,band_width,band_is_pct").in("id", market_ids);
  if (!markets || !markets.length) return json({ error: "no markets" }, 404);

  const per_market: any[] = [];
  let total_pnl = 0;
  const dailyPnl: Record<string, number> = {};

  for (const m of markets) {
    const { data: pts } = await sb.from("market_data_points")
      .select("ts,value")
      .eq("market_id", m.id)
      .gt("ts", since)
      .order("ts", { ascending: true })
      .limit(2000);
    const series = (pts || []).map((p: any) => ({ ts: p.ts, value: Number(p.value) }));
    if (series.length < 10) {
      per_market.push({ market_id: m.id, name: m.name, trades: [], final_pnl: 0, win_rate: 0, max_drawdown: 0 });
      continue;
    }

    // Simulate: virtual AMM 1000/1000, walk ticks, compute rolling trend and band.
    let resYes = 1000, resNo = 1000; // k = 1_000_000
    const k = resYes * resNo;
    const bandPct = m.band_is_pct ? Number(m.band_width || 5) / 100 : 0.05;
    const trades: Trade[] = [];
    let cash = 0; // P&L accumulator (in numeraire units of the virtual AMM)
    let yesShares = 0, noShares = 0;
    let peak = 0, drawdown = 0;
    const window = 20;

    for (let i = window; i < series.length; i++) {
      const slice = series.slice(i - window, i);
      const trend = slice.reduce((a, b) => a + b.value, 0) / slice.length;
      const value = series[i].value;
      const dev = (value - trend) / Math.max(Math.abs(trend), 1e-6);
      const inBand = Math.abs(dev) <= bandPct;
      const probYes = resNo / (resYes + resNo); // YES = snap-back stays inside

      // Decision: SNAPBACK contract perspective
      // mean_reversion: if outside band & probYes is low, buy YES (expect snap back)
      // momentum: if outside band & |dev| growing, buy NO (expect more breach)
      let action: "buy_yes" | "buy_no" | "sell_yes" | "sell_no" | null = null;
      const targetSize = Math.min(max_position_size, 20);

      if (strategy === "mean_reversion") {
        if (!inBand && probYes < 0.45 && yesShares < max_position_size) action = "buy_yes";
        else if (inBand && probYes > 0.7 && yesShares > 0) action = "sell_yes";
      } else {
        if (!inBand && probYes > 0.55 && noShares < max_position_size) action = "buy_no";
        else if (inBand && probYes < 0.4 && noShares > 0) action = "sell_no";
      }

      if (action) {
        const shares = Math.min(targetSize, Math.max(yesShares, noShares, 5));
        const r = simTrade(resYes, resNo, k, action, shares);
        if (r) {
          resYes = r.newYes; resNo = r.newNo;
          cash += r.cashDelta;
          if (action === "buy_yes") yesShares += shares;
          if (action === "sell_yes") yesShares -= shares;
          if (action === "buy_no") noShares += shares;
          if (action === "sell_no") noShares -= shares;
          trades.push({ ts: series[i].ts, side: action, shares, price: r.price, pnl_running: cash });
        }
      }

      // mark-to-market for drawdown
      const mtm = cash + yesShares * (resNo / (resYes + resNo)) + noShares * (resYes / (resYes + resNo));
      if (mtm > peak) peak = mtm;
      const dd = peak - mtm;
      if (dd > drawdown) drawdown = dd;

      const day = series[i].ts.slice(0, 10);
      dailyPnl[day] = (dailyPnl[day] || 0) + 0; // ensure key exists
    }

    // settle remaining positions at final implied probability
    const finalProbYes = resNo / (resYes + resNo);
    const realized = cash + yesShares * finalProbYes + noShares * (1 - finalProbYes);
    const wins = trades.filter((t, i) => i > 0 && t.pnl_running > trades[i - 1].pnl_running).length;
    const win_rate = trades.length > 1 ? wins / (trades.length - 1) : 0;

    total_pnl += realized;
    per_market.push({
      market_id: m.id,
      name: m.name,
      trades,
      final_pnl: realized,
      win_rate,
      max_drawdown: drawdown,
    });

    // build per-day equity
    for (const t of trades) {
      const day = t.ts.slice(0, 10);
      dailyPnl[day] = (dailyPnl[day] || 0); // start
    }
  }

  // Aggregate equity curve: for each day in lookback, cumulative pnl across markets.
  const days: string[] = [];
  for (let i = lookback_days; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push(d);
  }
  const equity_curve: Array<{ ts: string; equity: number }> = [];
  let cum = 0;
  for (const d of days) {
    // sum trades up to end-of-day across all markets
    let dayPnl = 0;
    for (const m of per_market) {
      const upTo = m.trades.filter((t: Trade) => t.ts.slice(0, 10) <= d);
      const last = upTo.length ? upTo[upTo.length - 1].pnl_running : 0;
      const prev = upTo.filter((t: Trade) => t.ts.slice(0, 10) < d).pop()?.pnl_running ?? 0;
      dayPnl += last - prev;
    }
    cum += dayPnl;
    equity_curve.push({ ts: d, equity: cum });
  }

  // Sharpe-ish: mean / stdev of daily deltas
  const deltas: number[] = [];
  for (let i = 1; i < equity_curve.length; i++) deltas.push(equity_curve[i].equity - equity_curve[i - 1].equity);
  const mean = deltas.reduce((a, b) => a + b, 0) / Math.max(deltas.length, 1);
  const variance = deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(deltas.length, 1);
  const stdev = Math.sqrt(variance);
  const sharpe = stdev > 1e-6 ? (mean / stdev) * Math.sqrt(252) : 0;

  const allTrades = per_market.flatMap((m: any) => m.trades);
  const wins = allTrades.filter((t: Trade, i: number) => i > 0 && t.pnl_running > allTrades[i - 1].pnl_running).length;
  const win_rate = allTrades.length > 1 ? wins / (allTrades.length - 1) : 0;
  const max_drawdown = Math.max(0, ...per_market.map((m: any) => m.max_drawdown));

  return json({
    per_market,
    equity_curve,
    aggregate: {
      total_pnl,
      trade_count: allTrades.length,
      win_rate,
      max_drawdown,
      sharpe,
    },
  });
});

function simTrade(resYes: number, resNo: number, k: number, side: string, shares: number) {
  const fee = 0.01;
  if (side === "buy_yes") {
    if (shares >= resYes) return null;
    const newYes = resYes - shares;
    const newNo = k / newYes;
    const gross = newNo - resNo;
    const cost = gross * (1 + fee);
    return { newYes, newNo, cashDelta: -cost, price: gross / shares };
  }
  if (side === "buy_no") {
    if (shares >= resNo) return null;
    const newNo = resNo - shares;
    const newYes = k / newNo;
    const gross = newYes - resYes;
    const cost = gross * (1 + fee);
    return { newYes, newNo, cashDelta: -cost, price: gross / shares };
  }
  if (side === "sell_yes") {
    const newYes = resYes + shares;
    const newNo = k / newYes;
    const payout = (resNo - newNo) * (1 - fee);
    return { newYes, newNo, cashDelta: payout, price: payout / shares };
  }
  if (side === "sell_no") {
    const newNo = resNo + shares;
    const newYes = k / newNo;
    const payout = (resYes - newYes) * (1 - fee);
    return { newYes, newNo, cashDelta: payout, price: payout / shares };
  }
  return null;
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
