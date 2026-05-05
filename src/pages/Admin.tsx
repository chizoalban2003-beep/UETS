import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Shield, CheckCircle2, XCircle, AlertTriangle, Users, BarChart2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link, useNavigate } from "react-router-dom";

export default function Admin() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [disputes, setDisputes] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    // Check admin role
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data }) => {
        if (!data) { setIsAdmin(false); nav("/"); return; }
        setIsAdmin(true);
        loadAll();
      });
  }, [user]);

  const loadAll = async () => {
    const [{ data: d }, { data: r }, { data: markets }, { data: users }, { data: trades }] =
      await Promise.all([
        supabase.from("market_disputes").select("*, market:markets(id,name,creator_id)").eq("status", "open").order("created_at", { ascending: false }),
        supabase.from("market_reviews").select("*, market:markets(id,name)").eq("status", "pending").order("created_at", { ascending: false }).limit(20),
        supabase.from("markets").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("trades").select("id", { count: "exact", head: true }),
      ]);
    setDisputes(d || []);
    setReviews(r || []);
    setStats({
      markets: (markets as any)?.count ?? 0,
      users: (users as any)?.count ?? 0,
      trades: (trades as any)?.count ?? 0,
    });
  };

  const resolveDispute = async (id: string, resolution: "upheld" | "dismissed") => {
    setBusy(id);
    const { error } = await supabase
      .from("market_disputes")
      .update({ status: resolution === "upheld" ? "upheld" : "dismissed" })
      .eq("id", id);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(`Dispute ${resolution}`);
    loadAll();
  };

  const approveMarket = async (marketId: string, reviewId: string) => {
    setBusy(reviewId);
    await Promise.all([
      supabase.from("market_reviews").update({ status: "approved" }).eq("id", reviewId),
      supabase.from("markets").update({ status: "open" }).eq("id", marketId),
    ]);
    setBusy(null);
    toast.success("Market approved");
    loadAll();
  };

  const rejectMarket = async (marketId: string, reviewId: string) => {
    setBusy(reviewId);
    await Promise.all([
      supabase.from("market_reviews").update({ status: "rejected" }).eq("id", reviewId),
      supabase.from("markets").update({ status: "cancelled" }).eq("id", marketId),
    ]);
    setBusy(null);
    toast.success("Market rejected");
    loadAll();
  };

  const setLpIncentive = async (marketId: string) => {
    setBusy(marketId + "_lp");
    const { error } = await supabase.rpc("set_lp_incentive", {
      _market_id: marketId,
      _apy: 50,
      _days: 30,
      _cap_usd: 500,
    });
    setBusy(null);
    if (error) toast.error(error.message);
    else toast.success("LP incentive set: 50% APY for 30 days");
    loadAll();
  };


  if (isAdmin === false) return <div className="container py-12 text-bear">Access denied.</div>;

  return (
    <div className="container py-8 max-w-6xl">
      <div className="flex items-center gap-3 mb-8">
        <Shield className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin console</h1>
          <p className="text-xs text-muted-foreground">Disputes, market reviews, platform stats.</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total markets", value: stats.markets, icon: BarChart2 },
          { label: "Total users", value: stats.users, icon: Users },
          { label: "Total trades", value: stats.trades, icon: CheckCircle2 },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="p-5 flex items-center gap-3">
            <Icon className="w-5 h-5 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-2xl font-mono-num">{value ?? "—"}</div>
            </div>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="disputes">
        <TabsList>
          <TabsTrigger value="disputes">
            Disputes
            {disputes.length > 0 && (
              <Badge variant="destructive" className="ml-2 h-5 px-1.5">{disputes.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="reviews">
            Market reviews
            {reviews.length > 0 && (
              <Badge variant="default" className="ml-2 h-5 px-1.5">{reviews.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="disputes" className="mt-4 space-y-3">
          {disputes.length === 0 ? (
            <Card className="p-10 text-center text-sm text-muted-foreground">
              No open disputes.
            </Card>
          ) : (
            disputes.map((d) => (
              <Card key={d.id} className="p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="w-4 h-4 text-accent" />
                      <Link to={`/markets/${d.market_id}`} className="font-medium hover:text-primary">
                        {d.market?.name ?? d.market_id}
                      </Link>
                      <Badge variant="outline" className="text-[10px]">{d.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{d.reason}</p>
                    <div className="text-xs text-muted-foreground">
                      Raised {formatDistanceToNow(new Date(d.created_at), { addSuffix: true })} · Bond: §50
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === d.id}
                      onClick={() => resolveDispute(d.id, "dismissed")}
                    >
                      <XCircle className="w-4 h-4 mr-1 text-muted-foreground" />
                      Dismiss
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy === d.id}
                      onClick={() => resolveDispute(d.id, "upheld")}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1" />
                      Uphold
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="reviews" className="mt-4 space-y-3">
          {reviews.length === 0 ? (
            <Card className="p-10 text-center text-sm text-muted-foreground">
              No pending market reviews.
            </Card>
          ) : (
            reviews.map((r) => (
              <Card key={r.id} className="p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <Link to={`/markets/${r.market_id}`} className="font-medium hover:text-primary">
                      {r.market?.name ?? r.market_id}
                    </Link>
                    {r.notes && (
                      <p className="text-sm text-muted-foreground mt-1">{r.notes}</p>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">
                      Submitted {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === r.id}
                      onClick={() => rejectMarket(r.market_id, r.id)}
                    >
                      <XCircle className="w-4 h-4 mr-1 text-bear" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy === r.id}
                      onClick={() => approveMarket(r.market_id, r.id)}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1" />
                      Approve
                    </Button>
                    {r.market?.status === "open" && !Number(r.market?.lp_incentive_apy) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === r.market_id + "_lp"}
                        onClick={() => setLpIncentive(r.market_id)}
                      >
                        Set LP incentive
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
