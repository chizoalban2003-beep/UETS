// Pre-publish review: AI grades market rules for clarity, ambiguity, and manipulation risk.
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { name, description, rules_md, resolution_at, data_source } = body || {};

    if (!name || !rules_md) {
      return new Response(JSON.stringify({ error: "name and rules_md required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are the Driftworks market reviewer. Grade this draft market on three dimensions, each 0-10:
- clarity: Could a stranger predict resolution unambiguously?
- objectivity: Is the resolution data source verifiable, not subjective?
- safety: Free of manipulation hooks (insider info, illegal events, harassment)?

Then give a verdict: "approve", "revise", or "reject".

Draft:
- Name: ${name}
- Description: ${description || "(none)"}
- Resolution date: ${resolution_at || "(unset)"}
- Data source: ${JSON.stringify(data_source || {})}
- Rules:
${rules_md}

Return STRICT JSON only:
{"clarity":N,"objectivity":N,"safety":N,"verdict":"approve|revise|reject","issues":["..."],"suggestions":["..."]}`;

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`AI ${r.status}: ${t.slice(0, 200)}`);
    }
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { verdict: "revise", issues: ["Could not parse review"], suggestions: [text.slice(0, 200)] };
    }

    return new Response(JSON.stringify({ ok: true, review: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
