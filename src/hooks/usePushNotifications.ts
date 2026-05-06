import { supabase } from "@/integrations/supabase/client";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function usePushNotifications() {
  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window;

  const subscribe = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!supported) return { ok: false, error: "Not supported in this browser" };
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
      if (!VAPID_PUBLIC) return { ok: false, error: "VAPID key not configured" };
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
      const json = sub.toJSON() as any;
      const { error } = await supabase.functions.invoke("push-subscribe", {
        body: {
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth_key: json.keys.auth,
          user_agent: navigator.userAgent,
        },
      });
      return error ? { ok: false, error: error.message } : { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Push subscription failed" };
    }
  };

  const unsubscribe = async (): Promise<void> => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    } catch (e) {
      console.error("push unsubscribe error:", e);
    }
  };

  return { supported, subscribe, unsubscribe };
}
