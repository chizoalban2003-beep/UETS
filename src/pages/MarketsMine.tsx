import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import MarketLifecycle from "@/components/MarketLifecycle";
import { Plus } from "lucide-react";

const DRAFT_STATUSES = ["draft", "pending_review"];
const LIVE_STATUSES = ["open", "pending_resolution", "disputable"];
const DONE_STATUSES = ["resolved", "cancelled"];

export default function MarketsMine() {
  const { user } = useAuth();
  const [markets, setMarkets] = useState<any[]>([]);
  const [disputes, setDisputes] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("markets")
      .select("*")
      .eq("creator_id", user.id)
      .order("created_at", { ascending: false });
    setMarkets(data || []);
    const ids = (data || []).map((m: any) => m.id);
    if (ids.length) {
      const { data: d } = await supabase
        .from("market_disputes")
        .select("*, market:markets(name)")
        .in("market_id", ids)
        .order("created_at", { ascending: false });
      setDisputes(d || []);
    } else {
      setDisputes([]);
    }
  };

  useEffect(() => {
    load();
  }, [user]);

  const cancel = async (id: string) => {
    if (!confirm("Cancel this market? A 5% penalty applies if it's already live.")) return;
    setBusy(id);
    const { data, error } = await supabase.functions.invoke("market-cancel", {
      body: { market_id: id },
    });
    setBusy(null);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Failed");
      return;
    }
    toast.success("Market cancelled, stake returned");
    load();
  };

  const claim = async (id: string) => {
    setBusy(id);
    const { data, error } = await supabase.functions.invoke("creator-payout", {
      body: { market_id: id },
    });
    setBusy(null);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Failed");
      return;
    }
    toast.success("Payout claimed");
    load();
  };

  const drafts = markets.filter((m) => DRAFT_STATUSES.includes(m.status));
  const live = markets.filter((m) => LIVE_STATUSES.includes(m.status));
  const done = markets.filter((m) => DONE_STATUSES.includes(m.status));

  return (
    <div className="container py-10 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">My markets</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage drafts, live markets, and claim creator payouts.</p>
        </div>
        <Button asChild><Link to="/markets/new"><Plus className="w-4 h-4 mr-1" />New market</Link></Button>
      </div>

      <Tabs defaultValue="live">
        <TabsList>
          <TabsTrigger value="drafts">Drafts ({drafts.length})</TabsTrigger>
          <TabsTrigger value="live">Live ({live.length})</TabsTrigger>
          <TabsTrigger value="done">Resolved ({done.length})</TabsTrigger>
          <TabsTrigger value="disputes">Disputes ({disputes.filter((d) => d.status === "open").length})</TabsTrigger>
        </TabsList>

        <TabsContent value="drafts" className="mt-4 space-y-3">
          {drafts.length === 0 && <Empty msg="No drafts yet." />}
          {drafts.map((m) => (
            <Row key={m.id} m={m} busy={busy === m.id}>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/markets/${m.id}`}>Edit & submit</Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => cancel(m.id)} disabled={busy === m.id}>
                Discard
              </Button>
            </Row>
          ))}
        </TabsContent>

        <TabsContent value="live" className="mt-4 space-y-3">
          {live.length === 0 && <Empty msg="No live markets." />}
          {live.map((m) => (
            <Row key={m.id} m={m} busy={busy === m.id}>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/markets/${m.id}`}>View</Link>
              </Button>
              {m.status === "open" && (
                <Button variant="ghost" size="sm" onClick={() => cancel(m.id)} disabled={busy === m.id}>
                  Cancel
                </Button>
              )}
            </Row>
          ))}
        </TabsContent>

        <TabsContent value="done" className="mt-4 space-y-3">
          {done.length === 0 && <Empty msg="Nothing resolved yet." />}
          {done.map((m) => (
            <Row key={m.id} m={m} busy={busy === m.id}>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/markets/${m.id}`}>View</Link>
              </Button>
              {m.status === "resolved" && !m.payout_claimed_at && (
                <Button size="sm" onClick={() => claim(m.id)} disabled={busy === m.id}>
                  Claim payout
                </Button>
              )}
              {m.payout_claimed_at && <Badge variant="outline">Paid out</Badge>}
            </Row>
          ))}
        </TabsContent>

        <TabsContent value="disputes" className="mt-4 space-y-3">
          {disputes.length === 0 && <Empty msg="No disputes raised on your markets." />}
          {disputes.map((d) => (
            <Card key={d.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={d.status === "open" ? "destructive" : "outline"} className="text-[10px]">{d.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(d.created_at).toLocaleString()}
                    </span>
                  </div>
                  <Link to={`/markets/${d.market_id}`} className="font-medium hover:underline">
                    {d.market?.name || "Market"}
                  </Link>
                  <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line">{d.reason}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>Bond</div>
                  <div className="font-mono-num text-foreground">${Number(d.bond).toFixed(2)}</div>
                </div>
              </div>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ m, busy, children }: { m: any; busy: boolean; children: React.ReactNode }) {
  const fees = Number(m.fees_accrued || 0);
  const stake = Number(m.creator_stake || 0);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">{m.category || "general"}</span>
            {m.status === "pending_review" ? (
              <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600 dark:text-amber-400">
                Under review
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">{m.status}</Badge>
            )}
          </div>
          <Link to={`/markets/${m.id}`} className="font-medium hover:underline">{m.name}</Link>
          <div className="mt-2"><MarketLifecycle status={m.status} /></div>
        </div>
        <div className="text-right text-xs text-muted-foreground space-y-0.5">
          <div>Stake <span className="font-mono-num text-foreground">${stake.toFixed(2)}</span></div>
          <div>Fees accrued <span className="font-mono-num text-bull">${fees.toFixed(2)}</span></div>
          <div>Your share (50%) <span className="font-mono-num">${(fees * 0.5).toFixed(2)}</span></div>
        </div>
      </div>
      <div className="flex gap-2 mt-3">{children}</div>
      {busy && <div className="text-xs text-muted-foreground mt-2">Working…</div>}
    </Card>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="text-sm text-muted-foreground py-12 text-center border border-dashed border-border rounded-lg">{msg}</div>;
}
