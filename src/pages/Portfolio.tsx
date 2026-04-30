import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";

export default function Portfolio() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number>(0);
  const [positions, setPositions] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: w }, { data: pos }, { data: tr }, { data: lg }] = await Promise.all([
        supabase.from("wallets").select("balance").eq("user_id", user.id).maybeSingle(),
        supabase.from("positions").select("*, contract:contracts(*, market:markets(id,name,unit))").eq("user_id", user.id),
        supabase.from("trades").select("*, contract:contracts(kind, market:markets(id,name))").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
        supabase.from("ledger_entries").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
      ]);
      setBalance(w ? Number(w.balance) : 0);
      setPositions((pos || []).filter((p: any) => Number(p.yes_shares) > 0 || Number(p.no_shares) > 0));
      setTrades(tr || []);
      setLedger(lg || []);
    })();
  }, [user]);

  return (
    <div className="container py-8 max-w-6xl">
      <h1 className="text-3xl font-semibold tracking-tight mb-1">Portfolio</h1>
      <p className="text-sm text-muted-foreground mb-6">Paper-trading capital · all balances are virtual</p>

      <Card className="p-6 mb-6 bg-gradient-surface">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Wallet balance</div>
        <div className="text-4xl font-mono-num text-primary mt-1">${balance.toFixed(2)}</div>
      </Card>

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
                  <div>${Number(t.cost).toFixed(2)}</div>
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
