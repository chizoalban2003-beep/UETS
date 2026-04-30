import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from "recharts";
import { toast } from "sonner";

type BacktestResult = {
  per_market: Array<{
    market_id: string;
    name: string;
    trades: Array<{ ts: string; side: string; shares: number; price: number; pnl_running: number }>;
    final_pnl: number;
    win_rate: number;
    max_drawdown: number;
  }>;
  equity_curve: Array<{ ts: string; equity: number }>;
  aggregate: { total_pnl: number; trade_count: number; win_rate: number; max_drawdown: number; sharpe: number };
};

export default function Backtest() {
  const { user } = useAuth();
  const [markets, setMarkets] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lookback, setLookback] = useState<number>(30);
  const [strategy, setStrategy] = useState<string>("mean_reversion");
  const [maxPos, setMaxPos] = useState<number>(50);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("markets")
        .select("id,name,category,status,data_source_id")
        .eq("status", "open")
        .not("data_source_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(40);
      setMarkets(data || []);
      if (data && data.length) {
        setSelected(new Set(data.slice(0, 3).map((m: any) => m.id)));
      }
    })();
  }, []);

  const run = async () => {
    if (!user) return;
    if (selected.size === 0) return toast.error("Pick at least one market");
    setRunning(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("bot-backtest", {
        body: {
          market_ids: Array.from(selected),
          lookback_days: lookback,
          strategy,
          max_position_size: maxPos,
        },
      });
      if (error) throw error;
      setResult(data as BacktestResult);
    } catch (e: any) {
      toast.error(e?.message || "Backtest failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="container py-8 max-w-6xl">
      <h1 className="text-3xl font-semibold tracking-tight mb-1">Bot backtest</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Replay how the bot would have performed against historical data. No trades are placed.
      </p>

      <div className="grid lg:grid-cols-[320px_1fr] gap-6">
        <Card className="p-5 h-fit">
          <h2 className="font-medium mb-4">Setup</h2>

          <div className="mb-4">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Strategy</label>
            <Select value={strategy} onValueChange={setStrategy}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mean_reversion">Mean reversion</SelectItem>
                <SelectItem value="momentum">Momentum</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mb-4">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Lookback: <span className="text-foreground font-mono-num">{lookback}d</span>
            </label>
            <Slider value={[lookback]} onValueChange={(v) => setLookback(v[0])} min={7} max={90} step={1} className="mt-2" />
          </div>

          <div className="mb-4">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Max position size: <span className="text-foreground font-mono-num">{maxPos} sh</span>
            </label>
            <Slider value={[maxPos]} onValueChange={(v) => setMaxPos(v[0])} min={10} max={500} step={10} className="mt-2" />
          </div>

          <div className="mb-4">
            <label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
              Markets ({selected.size})
            </label>
            <div className="max-h-64 overflow-auto space-y-1 border border-border/60 rounded-md p-2">
              {markets.length === 0 && <div className="text-xs text-muted-foreground p-2">No live markets yet</div>}
              {markets.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-secondary/40 rounded px-1 py-0.5">
                  <Checkbox
                    checked={selected.has(m.id)}
                    onCheckedChange={(c) => {
                      const next = new Set(selected);
                      if (c) next.add(m.id);
                      else next.delete(m.id);
                      setSelected(next);
                    }}
                  />
                  <span className="leading-tight">{m.name}</span>
                </label>
              ))}
            </div>
          </div>

          <Button onClick={run} disabled={running} className="w-full">
            {running ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Replaying…</> : "Run backtest"}
          </Button>
        </Card>

        <div className="space-y-4">
          {!result && !running && (
            <Card className="p-12 text-center text-sm text-muted-foreground">
              Configure on the left, then run a backtest to see the equity curve and trade log.
            </Card>
          )}

          {result && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Total P&L" value={`§${result.aggregate.total_pnl.toFixed(2)}`} positive={result.aggregate.total_pnl >= 0} />
                <Stat label="Trades" value={String(result.aggregate.trade_count)} />
                <Stat label="Win rate" value={`${(result.aggregate.win_rate * 100).toFixed(1)}%`} />
                <Stat label="Max drawdown" value={`§${result.aggregate.max_drawdown.toFixed(2)}`} positive={false} />
              </div>

              <Card className="p-5">
                <h3 className="font-medium mb-3 flex items-center gap-2"><Activity className="w-4 h-4" />Equity curve</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={result.equity_curve}>
                      <XAxis dataKey="ts" tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                      <ReferenceLine y={0} stroke="hsl(var(--border))" />
                      <Line type="monotone" dataKey="equity" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card>
                <div className="p-4 border-b border-border/60 font-medium">Per-market results</div>
                <div className="divide-y divide-border/60">
                  {result.per_market.map((m) => (
                    <div key={m.market_id} className="p-4 flex justify-between items-center">
                      <div>
                        <div className="font-medium">{m.name}</div>
                        <div className="text-xs text-muted-foreground">{m.trades.length} trades · win rate {(m.win_rate * 100).toFixed(1)}%</div>
                      </div>
                      <div className={`font-mono-num text-sm ${m.final_pnl >= 0 ? "text-bull" : "text-bear"}`}>
                        {m.final_pnl >= 0 ? <TrendingUp className="w-3.5 h-3.5 inline mr-1" /> : <TrendingDown className="w-3.5 h-3.5 inline mr-1" />}
                        {m.final_pnl >= 0 ? "+" : ""}§{m.final_pnl.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-mono-num mt-1 ${positive === undefined ? "" : positive ? "text-bull" : "text-bear"}`}>{value}</div>
    </Card>
  );
}
