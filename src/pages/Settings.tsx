import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bell, User, Save, Key, Copy, Trash2, Plus, Banknote } from "lucide-react";
import { toast } from "sonner";

async function browserSha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

type Prefs = {
  push_enabled: boolean;
  email_enabled: boolean;
  goal_alerts: boolean;
  market_resolving: boolean;
  payment_failed: boolean;
  agent_complete: boolean;
};

const DEFAULT_PREFS: Prefs = {
  push_enabled: false,
  email_enabled: true,
  goal_alerts: true,
  market_resolving: true,
  payment_failed: true,
  agent_complete: true,
};

export default function Settings() {
  const { user } = useAuth();
  const { supported, subscribe, unsubscribe } = usePushNotifications();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [leaderboardPublic, setLeaderboardPublic] = useState(true);
  const [saving, setSaving] = useState(false);

  // Developer API key state
  const [apiKeys, setApiKeys] = useState<{ id: string; label: string; tier: string; last_used_at: string | null; created_at: string }[]>([]);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);

  // Stripe Connect state
  const [connectStatus, setConnectStatus] = useState<"unlinked" | "pending" | "linked">("unlinked");
  const [connectLoading, setConnectLoading] = useState(false);

  useEffect(() => {
    document.title = "Settings · Driftworks";
    if (!user) return;

    // Load prefs
    supabase
      .from("notification_prefs")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setPrefs({ ...DEFAULT_PREFS, ...data });
      });

    // Load display name + leaderboard preference + Stripe Connect status
    supabase
      .from("profiles")
      .select("display_name, leaderboard_public, stripe_connect_account_id, stripe_connect_onboarded")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setDisplayName((data as any).display_name ?? "");
          setLeaderboardPublic((data as any).leaderboard_public ?? true);
          if ((data as any).stripe_connect_onboarded) setConnectStatus("linked");
          else if ((data as any).stripe_connect_account_id) setConnectStatus("pending");
        }
      });

    // Load API keys
    loadApiKeys();

    // Check push state from browser
    navigator.serviceWorker?.getRegistration().then(async (reg) => {
      const sub = await reg?.pushManager.getSubscription();
      setPushEnabled(!!sub);
    });

    // Handle Stripe Connect return
    const params = new URLSearchParams(window.location.search);
    if (params.get("connect") === "success") {
      setConnectStatus("linked");
      toast.success("Bank account linked — creator fees will be transferred automatically");
      window.history.replaceState({}, "", "/settings");
    } else if (params.get("connect") === "refresh") {
      toast.info("Onboarding incomplete — please try again");
      window.history.replaceState({}, "", "/settings");
    }
  }, [user]);

  const savePref = async (patch: Partial<Prefs>) => {
    if (!user) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    await supabase
      .from("notification_prefs")
      .upsert({ user_id: user.id, ...next }, { onConflict: "user_id" });
  };

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName.trim() || null, leaderboard_public: leaderboardPublic })
      .eq("id", user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Profile saved");
  };

  // --- Developer API key management ---
  const loadApiKeys = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("api_keys")
      .select("id, label, tier, last_used_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setApiKeys((data as any) ?? []);
  };

  const createApiKey = async () => {
    if (!user || !newKeyLabel.trim()) return;
    setCreatingKey(true);
    const raw = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const keyHash = await browserSha256(raw);
    const { error } = await supabase
      .from("api_keys")
      .insert({ user_id: user.id, label: newKeyLabel.trim(), key_hash: keyHash, tier: "free" });
    if (error) { toast.error(error.message); }
    else {
      setNewKeyValue(raw);
      setNewKeyLabel("");
      await loadApiKeys();
    }
    setCreatingKey(false);
  };

  const revokeApiKey = async (id: string) => {
    if (!confirm("Revoke this API key? This cannot be undone.")) return;
    await supabase.from("api_keys").delete().eq("id", id);
    await loadApiKeys();
    toast.success("API key revoked");
  };

  // --- Stripe Connect ---
  const startConnectOnboarding = async () => {
    if (!user) return;
    setConnectLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-connect-onboard`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ return_url: window.location.origin + "/settings" }),
      });
      const payload = await res.json();
      if (payload.url) {
        window.open(payload.url, "_blank");
      } else {
        toast.error(payload.error ?? "Could not start onboarding");
      }
    } catch (err) {
      toast.error("Failed to connect Stripe");
    }
    setConnectLoading(false);
  };

  return (
    <div className="container py-10 max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      {/* Profile */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Profile</CardTitle>
          </div>
          <CardDescription>Update your public display name.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="displayName">Display name</Label>
            <div className="flex gap-2">
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Anonymous"
                maxLength={40}
              />
              <Button size="sm" onClick={saveProfile} disabled={saving}>
                <Save className="w-4 h-4 mr-1" />
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-normal">Show me on the leaderboard</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Your name and P&L appear on the public leaderboard</p>
            </div>
            <Switch
              checked={leaderboardPublic}
              onCheckedChange={(v) => setLeaderboardPublic(v)}
            />
          </div>
          <p className="text-xs text-muted-foreground">Email: {user?.email ?? "—"}</p>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Notifications</CardTitle>
          </div>
          <CardDescription>Choose how and when you receive alerts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Push toggle */}
          {supported && (
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <div>
                <Label className="font-normal">Push notifications</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Instant alerts in your browser or on your home screen
                </p>
              </div>
              <Switch
                checked={pushEnabled}
                onCheckedChange={async (v) => {
                  if (v) {
                    const result = await subscribe();
                    if (result.ok) {
                      setPushEnabled(true);
                      await savePref({ push_enabled: true });
                      toast.success("Push notifications enabled");
                    } else {
                      toast.error(result.error ?? "Could not enable push");
                    }
                  } else {
                    await unsubscribe();
                    setPushEnabled(false);
                    await savePref({ push_enabled: false });
                    toast.success("Push notifications disabled");
                  }
                }}
              />
            </div>
          )}

          {/* Email toggle */}
          <div className="flex items-center justify-between pb-3 border-b border-border/60">
            <div>
              <Label className="font-normal">Email notifications</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Delivered to {user?.email ?? "your email"}</p>
            </div>
            <Switch
              checked={prefs.email_enabled}
              onCheckedChange={(v) => savePref({ email_enabled: v })}
            />
          </div>

          {/* Per-kind toggles */}
          {([
            { key: "goal_alerts", label: "Goal achieved", desc: "When you hit a portfolio milestone" },
            { key: "market_resolving", label: "Market resolving", desc: "When markets you're in start settling" },
            { key: "payment_failed", label: "Payment issues", desc: "Billing failures and credit issues" },
            { key: "agent_complete", label: "Agent complete", desc: "When Caretaker finishes a long task" },
          ] as const).map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between">
              <div>
                <Label className="font-normal">{label}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
              <Switch
                checked={prefs[key]}
                onCheckedChange={(v) => savePref({ [key]: v })}
                disabled={!prefs.email_enabled && !prefs.push_enabled}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Developer API */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Developer API</CardTitle>
          </div>
          <CardDescription>
            Access Driftworks data programmatically via REST.
            Base URL: <code className="text-xs bg-muted px-1 rounded">{import.meta.env.VITE_SUPABASE_URL}/functions/v1/api</code>
            &nbsp;— Header: <code className="text-xs bg-muted px-1 rounded">X-API-Key: your-key</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {newKeyValue && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950 border border-amber-300 rounded-md space-y-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Copy this key now — it won't be shown again
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs break-all bg-background border rounded p-2">{newKeyValue}</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { navigator.clipboard.writeText(newKeyValue); toast.success("Copied"); }}
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setNewKeyValue(null)}>
                I've saved it
              </Button>
            </div>
          )}

          {apiKeys.length > 0 && (
            <div className="divide-y divide-border rounded-md border">
              {apiKeys.map((k) => (
                <div key={k.id} className="flex items-center justify-between px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{k.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {k.tier} · {k.last_used_at ? `Last used ${new Date(k.last_used_at).toLocaleDateString()}` : "Never used"} · Created {new Date(k.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => revokeApiKey(k.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Input
              placeholder="Key label (e.g. my-bot)"
              value={newKeyLabel}
              onChange={(e) => setNewKeyLabel(e.target.value)}
              maxLength={40}
              onKeyDown={(e) => e.key === "Enter" && createApiKey()}
            />
            <Button size="sm" onClick={createApiKey} disabled={creatingKey || !newKeyLabel.trim()}>
              <Plus className="w-3 h-3 mr-1" />
              Create key
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Free tier: 100 req/day · Pro: 1,000/day · Elite: 10,000/day</p>
        </CardContent>
      </Card>

      {/* Creator Earnings — Stripe Connect */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Banknote className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Creator Earnings</CardTitle>
          </div>
          <CardDescription>
            Link a bank account to receive creator fees automatically.
            Minimum payout: $1. Fees are transferred weekly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {connectStatus === "linked" ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-sm font-medium text-green-600">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                Bank account connected
              </span>
            </div>
          ) : (
            <Button
              size="sm"
              onClick={startConnectOnboarding}
              disabled={connectLoading}
            >
              {connectStatus === "pending" ? "Complete bank setup" : "Link bank account"}
            </Button>
          )}
          {connectStatus === "pending" && (
            <p className="text-xs text-amber-600">Onboarding incomplete — click to finish setup.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Creator fees are paid via Stripe Connect. You'll need a Stripe account to receive payouts.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
