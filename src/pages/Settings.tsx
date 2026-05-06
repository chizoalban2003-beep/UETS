import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bell, User, Save } from "lucide-react";
import { toast } from "sonner";

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

    // Load display name + leaderboard preference
    supabase
      .from("profiles")
      .select("display_name, leaderboard_public")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setDisplayName((data as any).display_name ?? "");
          setLeaderboardPublic((data as any).leaderboard_public ?? true);
        }
      });

    // Check push state from browser
    navigator.serviceWorker?.getRegistration().then(async (reg) => {
      const sub = await reg?.pushManager.getSubscription();
      setPushEnabled(!!sub);
    });
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
    </div>
  );
}
