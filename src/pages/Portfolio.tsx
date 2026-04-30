import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { RefreshCw, AlertTriangle, Activity } from "lucide-react";
import { toast } from "sonner";

export default function Portfolio() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number>(0);
  const [positions, setPositions] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [resetting, setResetting] = useState(false);

  const load = async () => {
    if (!user) return;
    const [{ data: w }, { data: pos }, { data: tr }, { data: lg }] = await Promise.all([
      supabase.from("wallets").select("balance").eq("user_id", user.id).maybeSingle(),
      supabase.from("positions").select("*, contract:contracts(*, market:markets(id,name,unit,category))").eq("user_id", user.id),
      supabase.from("trades").select("*, contract:contracts(kind, market:markets(id,name))").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("ledger_entries").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    ]);
    setBalance(w ? Number(w.balance) : 0);
    setPositions((pos || []).filter((p: any) => Number(p.yes_shares) > 0 || Number(p.no_shares) > 0));
    setTrades(tr || []);
    setLedger(lg || []);
  };

  useEffect(() => { load(); }, [user]);

  const onReset = async () => {
    if (!confirm("Reset paper balance to §10,000 and zero all positions? This is rate-limited to once per 24h.")) return;
    setResetting(true);
    try {
      const { data, error } = await supabase.functions.invoke("reset-paper-balance", { body: {} });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Paper balance reset to §10,000");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  // Net exposure per market: (yes - no) * implied probability of YES.
  const exposure = positions.map((p: any) => {
    const ry = Number(p.contract?.reserve_yes || 1);
    const rn = Number(p.contract?.reserve_no || 1);
    const probYes = rn / (ry + rn);
    const net = (Number(p.yes_shares) - Number(p.no_shares));
    return {
      market: p.contract?.market?.name,
      kind: p.contract?.kind,
      category: p.contract?.market?.category || "Other",
      net,
      mark: Math.abs(net) * (net >= 0 ? probYes : (1 - probYes)),
      direction: net >= 0 ? "YES" : "NO",
    };
  });

  const byCategory: Record<string, number> = {};
  for (const e of exposure) byCategory[e.category] = (byCategory[e.category] || 0) + e.mark;
  const totalExposure = exposure.reduce((a, b) => a + b.mark, 0);

  return (
    <div className="container py-8 max-w-6xl">
      <div className="flex justify-between items-start mb-1 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Portfolio</h1>
          <p className="text-sm text-muted-foreground">Paper-trading capital · all balances are virtual</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/backtest"><Activity className="w-4 h-4 mr-1.5" />Backtest bot</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={onReset} disabled={resetting}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${resetting ? "animate-spin" : ""}`} />
            Reset paper balance
          </Button>
        </div>
      </div>

      <Card className="p-6 my-6 bg-gradient-surface">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Wallet balance</div>
        <div className="text-4xl font-mono-num text-primary mt-1">§{balance.toFixed(2)}</div>
      </Card>

      {exposure.length > 0 && (
        <Card className="p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-medium">Net exposure</h2>
            <span className="text-xs text-muted-foreground">mark-to-market by category</span>
          </div>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            {Object.entries(byCategory).map(([cat, v]) => {
              const pct = totalExposure ? (v / totalExposure) * 100 : 0;
              return (
                <div key={cat} className="border border-border/60 rounded-md p-3">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">{cat}</div>
                  <div className="font-mono-num text-lg mt-0.5">§{v.toFixed(2)}</div>
                  <div className="h-1.5 bg-secondary rounded-full mt-2 overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          {exposure.length >= 2 && (
            <div className="flex items-start gap-2 p-3 rounded-md border border-border/60 bg-secondary/20 text-xs">
              <AlertTriangle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                You hold {exposure.length} positions. Ask the Caretaker
                <span className="font-medium"> "suggest hedges"</span> to find offsetting trades across correlated markets.
              </div>
            </div>
          )}
        </Card>
      )}

      <h2 className="font-medium mb-3">Open positions</h2>
      {positions.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground mb-8">No open positions yet. <Link to="/markets" className="text-primary underline">Browse markets</Link></Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-3 mb-8">
          {positions.map((p) => (
            <Link key={p.id} to={`/markets/${p.contract.market.id}`}>
              <Card className="p-4 hover:border-primary/50 transition-colors">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">{p.contract.kind}</div>
                    <div className="font-medium leading-tight">{p.contract.market.name}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs mt-3">
                  <div><span className="text-muted-foreground">YES </span><span className="font-mono-num">{Number(p.yes_shares).toFixed(2)}</span></div>
                  <div><span className="text-muted-foreground">NO </span><span className="font-mono-num">{Number(p.no_shares).toFixed(2)}</span></div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="font-medium mb-3">Recent trades</h2>
          <Card className="divide-y divide-border/60">
            {trades.length === 0 ? <div className="p-4 text-sm text-muted-foreground">No trades yet</div> : trades.map((t) => (
              <div key={t.id} className="p-3 flex justify-between items-center text-sm">
                <div>
                  <div className="font-medium leading-tight">{t.contract.market.name}</div>
                  <div className="text-xs text-muted-foreground">{t.contract.kind} · {t.side} · {Number(t.shares).toFixed(2)} sh</div>
                </div>
                <div className="text-right text-xs font-mono-num">
                  <div>§{Number(t.cost).toFixed(2)}</div>
                  <div className="text-muted-foreground">{format(new Date(t.created_at), "MMM d")}</div>
                </div>
              </div>
            ))}
          </Card>
        </div>
        <div>
          <h2 className="font-medium mb-3">Ledger</h2>
          <Card className="divide-y divide-border/60">
            {ledger.map((l) => (
              <div key={l.id} className="p-3 flex justify-between items-center text-sm">
                <div>
                  <div className="font-medium leading-tight capitalize">{l.reason.replace("_", " ")}</div>
                  <div className="text-xs text-muted-foreground">{l.note || "—"}</div>
                </div>
                <div className={`font-mono-num ${Number(l.amount) >= 0 ? "text-bull" : "text-bear"}`}>
                  {Number(l.amount) >= 0 ? "+" : ""}{Number(l.amount).toFixed(2)}
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
