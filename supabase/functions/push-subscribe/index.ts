import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );

    const { data: { user }, error: authErr } = await sb.auth.getUser();
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json();
    const { endpoint, p256dh, auth_key, user_agent } = body;

    if (!endpoint || !p256dh || !auth_key) {
      return json({ error: "endpoint, p256dh, auth_key required" }, 400);
    }

    await sb.from("push_subscriptions").upsert(
      { user_id: user.id, endpoint, p256dh, auth_key, user_agent: user_agent ?? null },
      { onConflict: "user_id,endpoint" },
    );

    await sb.from("notification_prefs").upsert(
      { user_id: user.id, push_enabled: true },
      { onConflict: "user_id" },
    );

    return json({ ok: true });
  } catch (e: any) {
    console.error("push-subscribe error:", e);
    return json({ error: e?.message ?? "Internal server error" }, 500);
  }
});
