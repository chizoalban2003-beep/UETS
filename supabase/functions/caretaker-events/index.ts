// Generates Caretaker briefings: pre-event, during-event, post-event recaps.
// Invoked on demand by the dock (cheap dedupe) and on a schedule by piggy-back.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const DEDUPE_MINUTES = 30;
const PER_USER_CAP = 3;

type Kind = "pre_event" | "during_event" | "post_event";

const SKILL_TONE: Record<string, string> = {
  beginner: "Plain English. No jargon without explaining it. Use a tiny worked example when helpful.",
  intermediate: "Concise, can use trading terms (distortion, snapback, AMM mid). Skip basic definitions.",
  advanced: "Tight and quantitative. Show the math (band width, distortion %, fee impact). Skip lessons.",
};

const MODE_VOICE: Record<string, string> = {
  teach: "You won't trade. Frame everything as a lesson: what you'd consider, why, and what would change your mind.",
  suggest: "You may propose a trade. Be specific: side, rough size, and what you'd watch to invalidate.",
  copilot: "You may execute trades inside guardrails (max position, daily loss). Be decisive.",
  autopilot: "You're running fully automated within guardrails. Tell the user what you did or will do, and why.",
};

function buildPrompt(kind: Kind, skill: string, mode: string, payload: any): string {
  const tone = SKILL_TONE[skill] || SKILL_TONE.beginner;
  const voice = MODE_VOICE[mode] || MODE_VOICE.suggest;
  const base = `You are the Caretaker for Driftworks. Skill level: ${skill}. Mode: ${mode}.\nTone: ${tone}\nVoice: ${voice}\nReturn 4-7 sentences in markdown. Never invent numbers; only use the data I give you.`;

  if (kind === "pre_event") {
    return `${base}\n\nTASK: Write a PRE-EVENT briefing.\n${JSON.stringify(payload)}\n\nCover: (1) what's resolving and when, (2) where price sits vs the band right now, (3) what you're watching, (4) what you would do at each plausible outcome (snapback YES vs distortion).`;
  }
  if (kind === "during_event") {
    return `${base}\n\nTASK: Write a SHORT live update for an in-progress market.\n${JSON.stringify(payload)}\n\nLead with one line: still on plan / plan changed because… Then 2-3 sentences on what changed and what to do.`;
  }
  return `${base}\n\nTASK: Write a POST-EVENT recap for a resolved market.\n${JSON.stringify(payload)}\n\nCover: (1) outcome (snapback or distortion, by how much), (2) user's P&L on this market, (3) what the strategy got right or wrong, (4) one lesson for next time.`;
}

async function generateBody(kind: Kind, skill: string, mode: string, payload: any): Promise<string> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: buildPrompt(kind, skill, mode, payload) }],
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`AI ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return j?.choices?.[0]?.message?.content || "";
}

async function processUser(supabase: any, userId: string, skill: string, mode: string, marketIdFilter?: string | null) {
  const since = new Date(Date.now() - DEDUPE_MINUTES * 60_000).toISOString();
  const written: any[] = [];

  // Pull positions to know which markets are relevant
  const { data: positions } = await supabase
    .from("positions")
    .select("contract:contracts(market_id, market:markets(id,name,unit,status,resolution_at,band_width,band_is_pct,trend_model,final_value))")
    .eq("user_id", userId);

  const heldMarketIds = new Set<string>();
  for (const p of positions || []) {
    const mid = p?.contract?.market_id;
    if (mid) heldMarketIds.add(mid);
  }

  // Candidate markets: held by user, plus open markets resolving in <24h
  const soon = new Date(Date.now() + 24 * 3600_000).toISOString();
  const { data: openSoon } = await supabase
    .from("markets")
    .select("id,name,unit,status,resolution_at,band_width,band_is_pct,trend_model,final_value")
    .eq("status", "open")
    .lte("resolution_at", soon);
  const { data: held } = await supabase
    .from("markets")
    .select("id,name,unit,status,resolution_at,band_width,band_is_pct,trend_model,final_value")
    .in("id", Array.from(heldMarketIds).length ? Array.from(heldMarketIds) : ["00000000-0000-0000-0000-000000000000"]);

  const candidates = new Map<string, any>();
  for (const m of openSoon || []) candidates.set(m.id, m);
  for (const m of held || []) candidates.set(m.id, m);

  if (marketIdFilter) {
    for (const id of [...candidates.keys()]) if (id !== marketIdFilter) candidates.delete(id);
  }

  for (const [marketId, m] of candidates) {
    if (written.length >= PER_USER_CAP) break;

    // Decide which kind of briefing is appropriate
    let kind: Kind | null = null;
    if (m.status === "resolved") kind = "post_event";
    else if (m.resolution_at && new Date(m.resolution_at).getTime() - Date.now() < 24 * 3600_000) kind = "pre_event";
    else if (heldMarketIds.has(marketId)) kind = "during_event";
    if (!kind) continue;

    // Dedupe: skip if we already wrote one of this kind for this market in last DEDUPE_MINUTES
    const { data: recent } = await supabase
      .from("caretaker_events")
      .select("id")
      .eq("user_id", userId)
      .eq("market_id", marketId)
      .eq("kind", kind)
      .gte("created_at", since)
      .limit(1);
    if (recent && recent.length) continue;

    // Get latest data point
    const { data: pts } = await supabase
      .from("market_data_points")
      .select("ts,value")
      .eq("market_id", marketId)
      .order("ts", { ascending: false })
      .limit(20);
    const latest = pts?.[0];
    const trendValue = pts?.length
      ? pts.reduce((a: number, p: any) => a + Number(p.value), 0) / pts.length
      : null;

    // User's exposure on this market
    const { data: pos } = await supabase
      .from("positions")
      .select("yes_shares,no_shares,cost_basis_yes,cost_basis_no,contract:contracts(kind)")
      .eq("user_id", userId);
    const onMarket = (pos || []).filter((p: any) => candidates.has(marketId)); // crude but cheap

    const payload = {
      market: { id: m.id, name: m.name, unit: m.unit, status: m.status, resolution_at: m.resolution_at, trend_model: m.trend_model, band_width: Number(m.band_width), band_is_pct: m.band_is_pct, final_value: m.final_value !== null ? Number(m.final_value) : null },
      latest_value: latest ? Number(latest.value) : null,
      latest_at: latest?.ts ?? null,
      avg_recent: trendValue,
      user_positions: onMarket.map((p: any) => ({ kind: p.contract?.kind, yes: Number(p.yes_shares), no: Number(p.no_shares), cost_basis: Number(p.cost_basis_yes) + Number(p.cost_basis_no) })),
    };

    let body_md = "";
    try {
      body_md = await generateBody(kind, skill, mode, payload);
    } catch (e) {
      console.error("ai gen failed", e);
      continue;
    }

    const titleByKind = { pre_event: `Pre-event briefing: ${m.name}`, during_event: `Update: ${m.name}`, post_event: `Recap: ${m.name}` };
    const { data: row } = await supabase
      .from("caretaker_events")
      .insert({
        user_id: userId,
        market_id: marketId,
        kind,
        title: titleByKind[kind],
        body_md,
        metrics: { latest_value: payload.latest_value, avg_recent: payload.avg_recent },
      })
      .select()
      .single();
    if (row) written.push(row);
  }

  return written;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({} as any));
    const marketIdFilter: string | null = body?.market_id ?? null;

    // If JWT present, scope to that user. Otherwise treat as scheduled run.
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    let userIds: string[] = [];
    if (jwt) {
      const { data: { user } } = await createClient(SUPABASE_URL, Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${jwt}` } } }).auth.getUser();
      if (user) userIds = [user.id];
    } else {
      // Scheduled: pick recently-active users (had a trade or held a position in last 14d)
      const { data: recent } = await supabase
        .from("trades")
        .select("user_id")
        .gte("created_at", new Date(Date.now() - 14 * 86400_000).toISOString());
      userIds = [...new Set((recent || []).map((r: any) => r.user_id))].slice(0, 100);
    }

    const all: any[] = [];
    for (const uid of userIds) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("skill_level,caretaker_mode")
        .eq("id", uid)
        .maybeSingle();
      const skill = prof?.skill_level || "beginner";
      const mode = prof?.caretaker_mode || "suggest";
      try {
        const w = await processUser(supabase, uid, skill, mode, marketIdFilter);
        all.push(...w);
      } catch (e) {
        console.error("user failed", uid, e);
      }
    }

    return new Response(JSON.stringify({ ok: true, written: all.length, events: all }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
