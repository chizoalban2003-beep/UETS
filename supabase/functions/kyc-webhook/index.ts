// kyc-webhook — receives Stripe Identity webhook events.
// No JWT auth — called directly by Stripe.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { verifyWebhook } from "../_shared/stripe.ts";

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
    // Verify Stripe signature
    const event = await verifyWebhook(req, "sandbox");

    // Service-role client for privileged writes
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    switch (event.type) {
      case "identity.verification_session.verified": {
        const sessionId = event.data.object.id;
        const userId = event.data.object.metadata?.user_id;

        await sb
          .from("kyc_verifications")
          .update({ status: "verified", verified_at: new Date().toISOString() })
          .eq("stripe_session_id", sessionId);

        if (userId) {
          await sb.from("notifications").insert({
            user_id: userId,
            kind: "kyc_verified",
            title: "Identity verified",
            body: "You can now buy and trade with Driftworks Credits.",
          });
        }
        break;
      }

      case "identity.verification_session.requires_input": {
        const obj = event.data.object;
        await sb
          .from("kyc_verifications")
          .update({
            status: "failed",
            failure_reason: obj.last_error?.reason ?? "unknown",
          })
          .eq("stripe_session_id", obj.id);
        break;
      }

      default:
        // Ignore other event types
        break;
    }

    return json({ received: true });
  } catch (e: any) {
    console.error("kyc-webhook error:", e);
    return json({ error: e?.message ?? "Invalid request" }, 400);
  }
});
