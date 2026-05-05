// Scheduled ingestion: pull latest values for every due data_source and insert into market_data_points.
// Triggered by pg_cron every 5 minutes (and manually via fetch).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Source = {
  id: string;
  kind: "manual" | "provider" | "custom_url";
  provider: string | null;
  provider_params: Record<string, unknown>;
  custom_url: string | null;
  json_path: string | null;
  fetch_interval_minutes: number;
  last_fetched_at: string | null;
};

// ---- provider adapters ----------------------------------------------------

async function fetchCoinGecko(params: any): Promise<{ ts: number; value: number }> {
  // params: { id: "bitcoin", vs?: "usd" }
  const id = String(params.id || "bitcoin");
  const vs = String(params.vs || "usd");
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${vs}`);
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  const j = await r.json();
  const v = j?.[id]?.[vs];
  if (typeof v !== "number") throw new Error("coingecko: value missing");
  return { ts: Date.now(), value: v };
}

async function fetchYahoo(params: any): Promise<{ ts: number; value: number }> {
  const symbol = String(params.symbol || "AAPL");
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
    { headers: { "User-Agent": "Mozilla/5.0" } },
  );
  if (!r.ok) throw new Error(`yahoo ${r.status}`);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  const v = result?.meta?.regularMarketPrice;
  if (typeof v !== "number") throw new Error("yahoo: price missing");
  return { ts: Date.now(), value: v };
}

async function fetchOpenMeteo(params: any): Promise<{ ts: number; value: number }> {
  // params: { lat, lon, variable: "temperature_2m" }
  const lat = Number(params.lat);
  const lon = Number(params.lon);
  const v = String(params.variable || "temperature_2m");
  const r = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=${v}`,
  );
  if (!r.ok) throw new Error(`open-meteo ${r.status}`);
  const j = await r.json();
  const value = j?.current?.[v];
  if (typeof value !== "number") throw new Error("open-meteo: value missing");
  return { ts: Date.now(), value };
}

async function fetchGitHub(params: any): Promise<{ ts: number; value: number }> {
  // params: { repo: "owner/name", metric: "stargazers_count" | "forks_count" | "open_issues_count" }
  const repo = String(params.repo);
  const metric = String(params.metric || "stargazers_count");
  const r = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!r.ok) throw new Error(`github ${r.status}`);
  const j = await r.json();
  const v = j?.[metric];
  if (typeof v !== "number") throw new Error(`github: ${metric} missing`);
  return { ts: Date.now(), value: v };
}

async function fetchNasaCO2(_params: any): Promise<{ ts: number; value: number }> {
  // NOAA Mauna Loa weekly CO2 (free)
  const r = await fetch("https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_weekly_mlo.txt");
  if (!r.ok) throw new Error(`noaa ${r.status}`);
  const txt = await r.text();
  const lines = txt.split("\n").filter((l) => l && !l.startsWith("#"));
  const last = lines.reverse().find((l) => {
    const parts = l.trim().split(/\s+/);
    return parts.length >= 5 && Number(parts[4]) > 0;
  });
  if (!last) throw new Error("noaa: no rows");
  const v = Number(last.trim().split(/\s+/)[4]);
  return { ts: Date.now(), value: v };
}

async function fetchKalshi(params: any): Promise<{ ts: number; value: number }> {
  // params: { ticker } — returns YES price 0..1
  const ticker = String(params.ticker);
  const r = await fetch(`https://api.elections.kalshi.com/trade-api/v2/markets/${ticker}`);
  if (!r.ok) throw new Error(`kalshi ${r.status}`);
  const j = await r.json();
  const cents = j?.market?.yes_bid ?? j?.market?.last_price;
  if (typeof cents !== "number") throw new Error("kalshi: yes price missing");
  return { ts: Date.now(), value: cents / 100 };
}

async function fetchTwelveData(params: any): Promise<{ ts: number; value: number }> {
  const symbol = String(params.symbol);
  const key = Deno.env.get("TWELVEDATA_API_KEY") || "demo";
  const r = await fetch(`https://api.twelvedata.com/price?symbol=${symbol}&apikey=${key}`);
  if (!r.ok) throw new Error(`twelvedata ${r.status}`);
  const j = await r.json();
  const v = Number(j?.price);
  if (!Number.isFinite(v)) throw new Error(`twelvedata: ${j?.message || "price missing"}`);
  return { ts: Date.now(), value: v };
}

async function fetchPolymarket(params: any): Promise<{ ts: number; value: number }> {
  // params: { token_id }  — last trade price 0..1
  const id = String(params.token_id);
  const r = await fetch(`https://clob.polymarket.com/midpoint?token_id=${id}`);
  if (!r.ok) throw new Error(`polymarket ${r.status}`);
  const j = await r.json();
  const v = Number(j?.mid);
  if (!Number.isFinite(v)) throw new Error("polymarket: mid missing");
  return { ts: Date.now(), value: v };
}

function jsonPathGet(obj: any, path: string): any {
  if (!path) return obj;
  return path.split(".").reduce((acc, k) => {
    if (acc == null) return acc;
    const idx = /^\d+$/.test(k) ? Number(k) : k;
    return acc[idx as any];
  }, obj);
}

async function fetchCustomUrl(src: Source): Promise<{ ts: number; value: number }> {
  if (!src.custom_url) throw new Error("custom_url missing");
  const r = await fetch(src.custom_url);
  if (!r.ok) throw new Error(`custom_url ${r.status}`);
  const j = await r.json();
  const v = jsonPathGet(j, src.json_path || "");
  const num = Number(v);
  if (!Number.isFinite(num)) throw new Error(`custom_url: value at "${src.json_path}" not numeric`);
  return { ts: Date.now(), value: num };
}

async function fetchOne(src: Source): Promise<{ ts: number; value: number }> {
  if (src.kind === "custom_url") return fetchCustomUrl(src);
  switch (src.provider) {
    case "coingecko": return fetchCoinGecko(src.provider_params);
    case "yahoo": return fetchYahoo(src.provider_params);
    case "open-meteo": return fetchOpenMeteo(src.provider_params);
    case "github": return fetchGitHub(src.provider_params);
    case "nasa-co2": return fetchNasaCO2(src.provider_params);
    case "polymarket": return fetchPolymarket(src.provider_params);
    case "kalshi": return fetchKalshi(src.provider_params);
    case "twelvedata": return fetchTwelveData(src.provider_params);
    default: throw new Error(`unknown provider: ${src.provider}`);
  }
}

// ---- main -----------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { data: sources, error } = await supabase
      .from("data_sources")
      .select("*")
      .neq("kind", "manual");
    if (error) throw error;

    const now = Date.now();
    const due = (sources || []).filter((s: Source) => {
      if (!s.last_fetched_at) return true;
      const last = new Date(s.last_fetched_at).getTime();
      return now - last >= s.fetch_interval_minutes * 60_000;
    });

    const results: any[] = [];
    for (const src of due) {
      try {
        const { ts, value } = await fetchOne(src as Source);
        // find markets using this source
        const { data: markets } = await supabase
          .from("markets")
          .select("id")
          .eq("data_source_id", src.id);
        if (markets && markets.length) {
          const rows = markets.map((m: any) => ({
            market_id: m.id,
            ts: new Date(ts).toISOString(),
            value,
          }));
          await supabase.from("market_data_points").insert(rows);
        }
        await supabase
          .from("data_sources")
          .update({ last_fetched_at: new Date(ts).toISOString(), last_error: null })
          .eq("id", src.id);
        results.push({ id: src.id, ok: true, value });
      } catch (e: any) {
        await supabase
          .from("data_sources")
          .update({ last_error: String(e?.message || e), last_fetched_at: new Date().toISOString() })
          .eq("id", src.id);
        results.push({ id: src.id, ok: false, error: String(e?.message || e) });
      }
    }

    return new Response(JSON.stringify({ checked: sources?.length || 0, due: due.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
