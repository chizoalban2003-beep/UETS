import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Coins, ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import { formatNum } from "@/lib/trend";
import KycGate from "@/components/KycGate";

const PACKS = [
  { usd: 10, credits: 10, label: "Starter" },
  { usd: 50, credits: 50, label: "Trader", popular: true },
  { usd: 200, credits: 200, label: "Pro" },
  { usd: 500, credits: 500, label: "Elite" },
];

export default function Credits() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [buying, setBuying] = useState<number | null>(null);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("wallets")
      .select("balance, mode")
      .eq("user_id", user.id)
      .maybeSingle();
    setBalance(Number((data as any)?.balance ?? 0));
    setMode((data as any)?.mode ?? null);
  };

  useEffect(() => {
    document.title = "Credits · Driftworks";
    load();
  }, [user]);

  // Detect return from Stripe Checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("purchased") === "true") {
      toast.success("Credits added to your wallet!");
      window.history.replaceState({}, "", "/credits");
      load();
    }
    if (params.get("cancelled") === "true") {
      toast.error("Purchase cancelled.");
      window.history.replaceState({}, "", "/credits");
    }
  }, []);

  const buyCredits = async (pack: (typeof PACKS)[number]) => {
    setBuying(pack.usd);
    const { data, error } = await supabase.functions.invoke("billing-checkout", {
      body: {
        priceId: `dwc_${pack.usd}_credits`,
        userId: user?.id,
        customerEmail: user?.email,
        returnUrl: `${window.location.origin}/credits`,
        environment: "sandbox",
      },
    });
    setBuying(null);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Purchase failed");
      return;
    }
    // One-time checkout returns a redirect URL
    if ((data as any)?.url) {
      window.location.href = (data as any).url;
    }
  };

  return (
    <div className="container py-10 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-lg bg-gradient-primary shadow-glow flex items-center justify-center">
          <Coins className="w-5 h-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Driftworks Credits</h1>
          <p className="text-xs text-muted-foreground">1 Credit = $1 USD. Used to trade on real-capital markets.</p>
        </div>
        {balance !== null && (
          <div className="ml-auto text-right">
            <div className="text-xs text-muted-foreground">Balance</div>
            <div className="font-mono-num text-xl font-semibold">§{formatNum(balance)}</div>
            {mode && (
              <Badge variant={mode === "credit" ? "default" : "secondary"} className="text-[10px] mt-0.5">
                {mode === "credit" ? "Real-capital mode" : "Paper mode"}
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* KYC Gate wraps the purchasing section */}
      <KycGate>
        <div className="space-y-6">
          {/* Pack grid */}
          <div>
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Buy credits</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {PACKS.map((pack) => (
                <Card
                  key={pack.usd}
                  className={`relative cursor-pointer transition-all hover:border-primary/60 ${
                    pack.popular ? "border-primary/40 bg-primary/5" : ""
                  }`}
                >
                  {pack.popular && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] px-2">
                      Popular
                    </Badge>
                  )}
                  <CardHeader className="pb-2 pt-5 px-4">
                    <CardTitle className="text-base">§{pack.credits}</CardTitle>
                    <CardDescription className="text-xs">{pack.label}</CardDescription>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="font-mono-num text-sm text-muted-foreground mb-3">${pack.usd} USD</div>
                    <Button
                      size="sm"
                      className="w-full"
                      variant={pack.popular ? "default" : "outline"}
                      disabled={buying === pack.usd}
                      onClick={() => buyCredits(pack)}
                    >
                      {buying === pack.usd ? "Redirecting…" : "Buy"}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Withdrawal section */}
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <ArrowDownToLine className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">Withdraw credits</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Credits can be withdrawn back to your original payment method. Minimum §10. Processing within 3–5 business days.
                </p>
              </div>
              <Button variant="outline" size="sm" disabled>
                Coming soon
              </Button>
            </div>
          </Card>

          <p className="text-[10px] text-muted-foreground text-center">
            Credits are non-transferable and valid for 12 months after purchase. 1 Credit = $1 USD.
          </p>
        </div>
      </KycGate>
    </div>
  );
}
