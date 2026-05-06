// send-notification — deliver pending notifications via email (Resend) and web push.
// Intended to be called by a scheduled pg_cron job every 5 minutes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_URL = Deno.env.get("APP_URL") ?? "https://driftworks.app";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// CTA map: kind → path for push notification deep-links
const CTA_MAP: Record<string, { path: string }> = {
  kyc_verified: { path: "/credits" },
  market_submitted: { path: "/markets/mine" },
  market_approved: { path: "/markets/mine" },
  market_resolving: { path: "/markets/mine" },
  goal_achieved: { path: "/goals" },
  payment_failed: { path: "/billing" },
  agent_complete: { path: "/caretaker" },
  credit_purchase: { path: "/credits" },
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
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Fetch undelivered notifications (no email_sent_at, created in last 24h)
    const { data: notifications } = await sb
      .from("notifications")
      .select("id, user_id, kind, title, body, payload")
      .is("email_sent_at", null)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: true })
      .limit(50);

    if (!notifications?.length) return json({ ok: true, sent: 0 });

    let sent = 0;

    for (const n of notifications) {
      // Fetch user email + prefs
      const [{ data: authUser }, { data: prefs }] = await Promise.all([
        sb.auth.admin.getUserById(n.user_id),
        sb.from("notification_prefs").select("*").eq("user_id", n.user_id).maybeSingle(),
      ]);

      const email = authUser?.user?.email;
      const emailEnabled = prefs?.email_enabled !== false; // default true

      // ── Email via Resend ──────────────────────────────────────────────────
      if (email && emailEnabled && RESEND_API_KEY) {
        const cta = CTA_MAP[n.kind];
        const ctaHtml = cta
          ? `<p style="margin-top:16px"><a href="${APP_URL}${cta.path}" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px">Open Driftworks</a></p>`
          : "";

        try {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "Driftworks <notifications@driftworks.app>",
              to: [email],
              subject: n.title,
              html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto"><h2 style="font-size:18px">${escapeHtml(n.title)}</h2><p style="color:#555">${escapeHtml(n.body ?? "")}</p>${ctaHtml}</div>`,
            }),
          });
        } catch (emailErr) {
          console.error("send-notification email error:", emailErr);
        }
      }

      // ── Web push ─────────────────────────────────────────────────────────
      const { data: pushSubs } = await sb
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth_key")
        .eq("user_id", n.user_id);

      if (pushSubs?.length) {
        const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
        const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");

        if (VAPID_PUBLIC && VAPID_PRIVATE) {
          const webpush = await import("https://esm.sh/web-push@3.6.7");
          webpush.default.setVapidDetails(
            "mailto:push@driftworks.app",
            VAPID_PUBLIC,
            VAPID_PRIVATE,
          );

          const cta = CTA_MAP[n.kind];
          const pushPayload = JSON.stringify({
            title: n.title,
            body: n.body ?? "",
            url: cta ? `${APP_URL}${cta.path}` : APP_URL,
            tag: n.kind,
          });

          for (const sub of pushSubs) {
            try {
              await webpush.default.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
                pushPayload,
              );
            } catch (pushErr: any) {
              // 410 = subscription expired — clean it up
              if (pushErr?.statusCode === 410) {
                await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
              } else {
                console.error("push send error:", pushErr?.message);
              }
            }
          }
        }
      }

      // Mark as sent
      await sb
        .from("notifications")
        .update({ email_sent_at: new Date().toISOString() })
        .eq("id", n.id);

      sent++;
    }

    return json({ ok: true, sent });
  } catch (e: any) {
    console.error("send-notification error:", e);
    return json({ error: e?.message ?? "Internal server error" }, 500);
  }
});
