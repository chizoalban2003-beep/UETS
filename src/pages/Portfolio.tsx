import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { RefreshCw, AlertTriangle, Activity, Download } from "lucide-react";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine,
} from "recharts";

export default function Portfolio() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number>(0);
  const [positions, setPositions] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<{ snapped_at: string; balance: number }[]>([]);
  const [resetting, setResetting] = useState(false);

  const load = async () => {
    if (!user) return;
    const [{ data: w }, { data: pos }, { data: tr }, { data: lg }, { data: snaps }] =
      await Promise.all([
        supabase.from("wallets").select("balance").eq("user_id", user.id).maybeSingle(),
        supabase
          .from("positions")
          .select("*, contract:contracts(*, market:markets(id,name,unit,category))")
          .eq("user_id", user.id),
        supabase
          .from("trades")
          .select("*, contract:contracts(kind, market:markets(id,name))")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("ledger_entries")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("wallet_snapshots")
          .select("snapped_at, balance")
          .eq("user_id", user.id)
          .order("snapped_at", { ascending: true })
          .limit(90),
      ]);

    const bal = w ? Number(w.balance) : 0;
    setBalance(bal);
    setPositions((pos || []).filter((p: any) => Number(p.yes_shares) > 0 || Number(p.no_shares) > 0));
    setTrades(tr || []);
    setLedger(lg || []);

    // Add today's current balance as the last data point
    const today = new Date().toISOString().slice(0, 10);
    const raw = (snaps || []) as { snapped_at: string; balance: number }[];
    const last = raw[raw.length - 1];
    if (!last || last.snapped_at !== today) {
      setSnapshots([...raw, { snapped_at: today, balance: bal }]);
    } else {
      setSnapshots(raw);
    }

    // Record today's snapshot (fire and forget)
    supabase.rpc("record_wallet_snapshot", { _user_id: user.id }).then(() => {});
  };

  useEffect(() => { load(); }, [user]);

  const onReset = async () => {
    if (!confirm("Reset paper balance to §10,000 and zero all positions? Rate-limited to once per 24h.")) return;
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

  const exportCSV = () => {
    const header = "date,market,kind,side,shares,cost,fee\n";
    const rows = trades
      .map((t) =>
        [
          format(new Date(t.created_at), "yyyy-MM-dd"),
          (t.contract?.market?.name ?? "").replace(/,/g, " "),
          t.contract?.kind ?? "",
          t.side,
          Number(t.shares).toFixed(4),
          Number(t.cost).toFixed(4),
          Number(t.fee ?? 0).toFixed(4),
        ].join(",")
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `driftworks-trades-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exposure = positions.map((p: any) => {
    const ry = Number(p.contract?.reserve_yes || 1);
    const rn = Number(p.contract?.reserve_no || 1);
    const probYes = rn / (ry + rn);
    const net = Number(p.yes_shares) - Number(p.no_shares);
    return {
      market: p.contract?.market?.name,
      kind: p.contract?.kind,
      category: p.contract?.market?.category || "Other",
      net,
      mark: Math.abs(net) * (net >= 0 ? probYes : 1 - probYes),
      direction: net >= 0 ? "YES" : "NO",
    };
  });

  const byCategory: Record<string, number> = {};
  for (const e of exposure) byCategory[e.category] = (byCategory[e.category] || 0) + e.mark;
  const totalExposure = exposure.reduce((a, b) => a + b.mark, 0);

  const pnl = balance - 10000;
  const chartData = snapshots.map((s) => ({
    date: s.snapped_at.slice(5),
    balance: Number(s.balance),
    pnl: Number(s.balance) - 10000,
  }));

  return (
    <div className="container py-8 max-w-6xl">
      <div className="flex justify-between items-start mb-1 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Portfolio</h1>
          <p className="text-sm text-muted-foreground">Paper-trading capital · all balances are virtual</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" asChild>
            <Link to="/backtest"><Activity className="w-4 h-4 mr-1.5" />Backtest</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={trades.length === 0}>
            <Download className="w-4 h-4 mr-1.5" />Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={onReset} disabled={resetting}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${resetting ? "animate-spin" : ""}`} />
            Reset balance
          </Button>
        </div>
      </div>

      {/* Balance + equity curve */}
      <div className="grid md:grid-cols-[auto_1fr] gap-4 my-6">
        <Card className="p-6 bg-gradient-surface flex flex-col justify-center min-w-[180px]">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Wallet balance</div>
          <div className="text-4xl font-mono-num text-primary mt-1">§{balance.toFixed(2)}</div>
          <div className={`text-sm font-mono-num mt-1 ${pnl >= 0 ? "text-bull" : "text-bear"}`}>
            {pnl >= 0 ? "+" : ""}§{Math.abs(pnl).toFixed(2)} ({((pnl / 10000) * 100).toFixed(1)}%)
          </div>
        </Card>

        {chartData.length > 1 && (
          <Card className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Balance history (90d)</div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <XAxis dataKey="date" fontSize={10} stroke="hsl(var(--muted-foreground))" />
                  <YAxis fontSize={10} stroke="hsl(var(--muted-foreground))" domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any) => [`§${Number(v).toFixed(2)}`, "Balance"]}
                  />
                  <ReferenceLine y={10000} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 2" />
                  <Line
                    type="monotone"
                    dataKey="balance"
                    stroke={pnl >= 0 ? "hsl(var(--bull))" : "hsl(var(--bear))"}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
      </div>

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
                <span className="font-medium"> "suggest hedges"</span> to find offsetting trades.
              </div>
            </div>
          )}
        </Card>
      )}

      <h2 className="font-medium mb-3">Open positions</h2>
      {positions.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground mb-8">
          No open positions yet.{" "}
          <Link to="/markets" className="text-primary underline">
            Browse markets
          </Link>
        </Card>
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
                  <div>
                    <span className="text-muted-foreground">YES </span>
                    <span className="font-mono-num">{Number(p.yes_shares).toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">NO </span>
                    <span className="font-mono-num">{Number(p.no_shares).toFixed(2)}</span>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Recent trades</h2>
            {trades.length > 0 && (
              <Button variant="ghost" size="sm" onClick={exportCSV} className="h-7 text-xs">
                <Download className="w-3 h-3 mr-1" />CSV
              </Button>
            )}
          </div>
          <Card className="divide-y divide-border/60">
            {trades.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No trades yet</div>
            ) : (
              trades.map((t) => (
                <div key={t.id} className="p-3 flex justify-between items-center text-sm">
                  <div>
                    <div className="font-medium leading-tight">{t.contract.market.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.contract.kind} · {t.side} · {Number(t.shares).toFixed(2)} sh
                    </div>
                  </div>
                  <div className="text-right text-xs font-mono-num">
                    <div>§{Number(t.cost).toFixed(2)}</div>
                    <div className="text-muted-foreground">{format(new Date(t.created_at), "MMM d")}</div>
                  </div>
                </div>
              ))
            )}
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
