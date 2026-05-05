// One-shot tester for a custom JSON URL oracle. Returns the parsed numeric value
// without persisting anything. Used by the MarketNew "Test fetch" button.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonPathGet(obj: any, path: string): any {
  if (!path) return obj;
  return path.split(".").reduce((acc, k) => {
    if (acc == null) return acc;
    const idx = /^\d+$/.test(k) ? Number(k) : k;
    return acc[idx as any];
  }, obj);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { url, json_path } = await req.json();
    if (typeof url !== "string" || !url.startsWith("https://")) {
      return new Response(JSON.stringify({ error: "url must be https" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const r = await fetch(url);
    const text = await r.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch {
      return new Response(JSON.stringify({ error: "response is not valid JSON", sample: text.slice(0, 200) }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const raw = jsonPathGet(parsed, json_path || "");
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return new Response(JSON.stringify({ error: `value at "${json_path}" is not numeric`, raw }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ value, ts: Date.now() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
