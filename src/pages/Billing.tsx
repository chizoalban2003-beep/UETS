import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Sparkles, Zap, Crown, Check, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { getStripeEnvironment } from "@/lib/stripe";
import { toast } from "sonner";

type Tier = "free" | "pro_trader" | "creator_pro";

const TIERS: Array<{
  tier: Tier;
  name: string;
  price: string;
  priceId?: string;
  blurb: string;
  perks: string[];
  icon: any;
  highlight?: boolean;
}> = [
  {
    tier: "free",
    name: "Free",
    price: "$0",
    blurb: "Get started, learn the ropes.",
    perks: ["25 caretaker actions / day", "1 active market", "Standard fees", "Paper-trading sandbox"],
    icon: Sparkles,
  },
  {
    tier: "pro_trader",
    name: "Pro Trader",
    price: "$9 / mo",
    priceId: "pro_trader_monthly",
    blurb: "For active traders who want their agent on duty.",
    perks: ["250 caretaker actions / day", "3 active markets", "Scout (auto trade ideas)", "Advanced backtests"],
    icon: Zap,
    highlight: true,
  },
  {
    tier: "creator_pro",
    name: "Creator Pro",
    price: "$19 / mo",
    priceId: "creator_pro_monthly",
    blurb: "For market creators running a marketplace.",
    perks: ["1000 caretaker actions / day", "5 active markets", "60% creator fee share (vs 50%)", "Steward + Advertiser agents"],
    icon: Crown,
  },
];

const TIER_CAPS: Record<Tier, number> = { free: 25, pro_trader: 250, creator_pro: 1000 };

export default function Billing() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [sub, setSub] = useState<{ tier: Tier; status: string; current_period_end?: string | null } | null>(null);
  const [usage, setUsage] = useState<number>(0);
  const [checkoutPriceId, setCheckoutPriceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const load = async () => {
      const { data: s } = await supabase
        .from("subscriptions")
        .select("tier,status,current_period_end")
        .eq("user_id", user.id)
        .maybeSingle();
      const today = new Date().toISOString().slice(0, 10);
      const { data: u } = await supabase
        .from("caretaker_usage")
        .select("count")
        .eq("user_id", user.id)
        .eq("day", today)
        .maybeSingle();
      if (!mounted) return;
      setSub((s as any) || { tier: "free", status: "active" });
      setUsage(u?.count || 0);
      setLoading(false);
    };
    load();
    const ch = supabase
      .channel("billing")
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${user.id}` }, load)
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, [user]);

  useEffect(() => {
    if (params.get("checkout") === "success") {
      toast.success("Payment received — your plan will activate in a few seconds.");
    }
  }, [params]);

  if (!user) {
    return (
      <div className="container py-12 text-center">
        <p className="text-muted-foreground mb-4">Sign in to manage your plan.</p>
        <Button onClick={() => nav("/auth")}>Sign in</Button>
      </div>
    );
  }

  const currentTier: Tier = sub?.tier || "free";
  const cap = TIER_CAPS[currentTier];

  const openPortal = async () => {
    const { data, error } = await supabase.functions.invoke("billing-portal", {
      body: { returnUrl: window.location.href, environment: getStripeEnvironment() },
    });
    if (error || !data?.url) {
      toast.error(error?.message || "Could not open billing portal");
      return;
    }
    window.open(data.url, "_blank");
  };

  return (
    <>
      <PaymentTestModeBanner />
      <div className="container py-10 max-w-6xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Billing & plan</h1>
          <p className="text-muted-foreground mt-1">Pick the plan that matches how hard you want your Caretaker to work.</p>
        </header>

        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Current plan
                  <Badge variant={currentTier === "free" ? "secondary" : "default"} className="capitalize">
                    {currentTier.replace("_", " ")}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {sub?.status === "active" || sub?.status === "trialing"
                    ? "Active"
                    : sub?.status || "Active"}
                  {sub?.current_period_end && ` · renews ${new Date(sub.current_period_end).toLocaleDateString()}`}
                </CardDescription>
              </div>
              {currentTier !== "free" && (
                <Button variant="outline" size="sm" onClick={openPortal}>
                  Manage subscription <ExternalLink className="w-3 h-3 ml-1" />
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Caretaker actions today</span>
                <span className="font-mono-num">{usage} / {cap}</span>
              </div>
              <Progress value={Math.min(100, (usage / cap) * 100)} />
            </div>
          </CardContent>
        </Card>

        {checkoutPriceId ? (
          <Card>
            <CardHeader>
              <CardTitle>Complete your upgrade</CardTitle>
              <CardDescription>Test card: 4242 4242 4242 4242 · any future date · any CVC</CardDescription>
            </CardHeader>
            <CardContent>
              <StripeEmbeddedCheckout
                priceId={checkoutPriceId}
                userId={user.id}
                customerEmail={user.email || undefined}
              />
              <Button variant="ghost" className="mt-4" onClick={() => setCheckoutPriceId(null)}>
                Cancel
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-3 gap-4">
            {TIERS.map((t) => {
              const Icon = t.icon;
              const isCurrent = currentTier === t.tier;
              return (
                <Card key={t.tier} className={t.highlight ? "border-primary shadow-glow" : ""}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="w-5 h-5 text-primary" />
                        <CardTitle>{t.name}</CardTitle>
                      </div>
                      {t.highlight && <Badge>Most popular</Badge>}
                    </div>
                    <div className="mt-2">
                      <span className="text-3xl font-bold">{t.price}</span>
                    </div>
                    <CardDescription>{t.blurb}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-2 text-sm">
                      {t.perks.map((p) => (
                        <li key={p} className="flex items-start gap-2">
                          <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                    {isCurrent ? (
                      <Button disabled className="w-full" variant="secondary">Current plan</Button>
                    ) : t.priceId ? (
                      <Button className="w-full" onClick={() => setCheckoutPriceId(t.priceId!)}>
                        Upgrade to {t.name}
                      </Button>
                    ) : (
                      <Button disabled className="w-full" variant="ghost">Free tier</Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-8 text-center">
          Subscriptions are billed in USD. Trading on Driftworks uses paper currency (§). Cancel anytime from the billing portal.
        </p>
      </div>
    </>
  );
}
