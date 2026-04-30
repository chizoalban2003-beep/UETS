import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { buildBandSeries, distortion, ammPriceYes, ammQuoteBuy, formatNum } from "@/lib/trend";
import { PROVIDER_LABELS } from "@/lib/providers";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import DataSourceBadge from "@/components/DataSourceBadge";
import MarketLifecycle from "@/components/MarketLifecycle";
import { Radio, AlertCircle, ShieldAlert, FileText } from "lucide-react";

type Market = any;
type Contract = any;
type Position = any;

export default function MarketDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [market, setMarket] = useState<Market | null>(null);
  const [points, setPoints] = useState<{ ts: number; value: number }[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [dataSource, setDataSource] = useState<any>(null);
  const [resolveValue, setResolveValue] = useState("");
  const [stake, setStake] = useState(400);
  const [disputes, setDisputes] = useState<any[]>([]);
  const [disputeReason, setDisputeReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: m }, { data: pts }, { data: cts }, { data: dsp }] = await Promise.all([
      supabase.from("markets").select("*").eq("id", id).maybeSingle(),
      supabase.from("market_data_points").select("ts,value").eq("market_id", id).order("ts"),
      supabase.from("contracts").select("*").eq("market_id", id),
      supabase.from("market_disputes").select("*").eq("market_id", id).order("created_at", { ascending: false }),
    ]);
    setMarket(m);
    setDisputes(dsp || []);
    setPoints((pts || []).map((p) => ({ ts: new Date(p.ts).getTime(), value: Number(p.value) })));
    setContracts(cts || []);
    if (m?.data_source_id) {
      const { data: ds } = await supabase.from("data_sources").select("*").eq("id", m.data_source_id).maybeSingle();
      setDataSource(ds);
    } else {
      setDataSource(null);
    }
    if (user && cts) {
      const { data: pos } = await supabase
        .from("positions")
        .select("*")
        .eq("user_id", user.id)
        .in("contract_id", cts.map((c: any) => c.id));
      const map: Record<string, Position> = {};
      (pos || []).forEach((p: any) => (map[p.contract_id] = p));
      setPositions(map);
    }
  }, [id, user]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime contracts (so prices update live) + new data points
  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`market-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contracts", filter: `market_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "market_data_points", filter: `market_id=eq.${id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, load]);

  if (!market) return <div className="container py-10 text-muted-foreground">Loading…</div>;

  const series = points.length > 0
    ? buildBandSeries(points, market.trend_model, Number(market.band_width), market.band_is_pct)
    : [];
  const last = series[series.length - 1];
  const currentDistortion = last ? distortion(last.value, last.trend, Number(market.band_width), market.band_is_pct) : 0;

  const distContract = contracts.find((c) => c.kind === "distortion");
  const snapContract = contracts.find((c) => c.kind === "snapback");

  const isCreator = user?.id === market.creator_id;

  return (
    <div className="container py-8 max-w-7xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">{market.category || "general"}</div>
            {dataSource && <DataSourceBadge size="xs" />}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight mt-1">{market.name}</h1>
          {market.description && <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{market.description}</p>}
        </div>
        <div className="text-right text-sm space-y-1">
          <Badge variant="outline" className="text-xs">{market.status}</Badge>
          <div className="text-xs text-muted-foreground">resolves {format(new Date(market.resolution_at), "PP")}</div>
          {Number(market.creator_stake) > 0 && (
            <div className="text-xs text-muted-foreground">
              Creator stake <span className="font-mono-num text-foreground">${Number(market.creator_stake).toFixed(0)}</span>
            </div>
          )}
        </div>
      </div>

      <Card className="p-3 mb-6"><MarketLifecycle status={market.status} /></Card>

      {dataSource && (
        <Card className="p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-bull/10 flex items-center justify-center">
              <Radio className="w-4 h-4 text-bull" />
            </div>
            <div>
              <div className="text-sm font-medium">
                {dataSource.kind === "provider"
                  ? `Live from ${PROVIDER_LABELS[dataSource.provider as keyof typeof PROVIDER_LABELS] || dataSource.provider}`
                  : "Custom URL oracle"}
              </div>
              <div className="text-xs text-muted-foreground">
                Updates every {dataSource.fetch_interval_minutes} min ·{" "}
                {dataSource.last_fetched_at
                  ? `last ${formatDistanceToNow(new Date(dataSource.last_fetched_at), { addSuffix: true })}`
                  : "awaiting first fetch"}
              </div>
            </div>
          </div>
          {dataSource.last_error && (
            <div className="flex items-center gap-1 text-xs text-bear">
              <AlertCircle className="w-3 h-3" /> {dataSource.last_error}
            </div>
          )}
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Chart + stats */}
        <Card className="lg:col-span-2 p-5">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <Stat label="Latest value" value={last ? formatNum(last.value) : "—"} sub={market.unit || ""} />
            <Stat label="Trend now" value={last ? formatNum(last.trend) : "—"} sub={market.trend_model.replace("_", " ")} />
            <Stat
              label="Distortion"
              value={(currentDistortion * 100).toFixed(0) + "%"}
              sub={currentDistortion > 0.5 ? "stretched" : currentDistortion > 0 ? "outside band" : "inside band"}
              tone={currentDistortion > 0.5 ? "bear" : currentDistortion > 0 ? "accent" : "bull"}
            />
          </div>
          <div className="h-80">
            {series.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">no data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series}>
                  <XAxis dataKey="ts" tickFormatter={(t) => format(new Date(t), "MMM d")} fontSize={11} stroke="hsl(var(--muted-foreground))" />
                  <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={(t) => format(new Date(t), "PP")}
                    formatter={(v: any) => formatNum(Number(v))}
                  />
                  <Line type="monotone" dataKey="upper" stroke="hsl(var(--primary) / 0.4)" strokeDasharray="4 4" dot={false} name="band upper" />
                  <Line type="monotone" dataKey="lower" stroke="hsl(var(--primary) / 0.4)" strokeDasharray="4 4" dot={false} name="band lower" />
                  <Line type="monotone" dataKey="trend" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} name="trend" />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 2 }} name="actual" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Trade panel */}
        <div className="space-y-4">
          {distContract && (
            <ContractPanel
              title="Distortion"
              description="Pays out proportional to how stretched the trend ends up."
              contract={distContract}
              position={positions[distContract.id]}
              onTraded={load}
              disabled={market.status !== "open"}
            />
          )}
          {snapContract && (
            <ContractPanel
              title="Snap-back"
              description="Binary: does the value finish inside the band?"
              contract={snapContract}
              position={positions[snapContract.id]}
              onTraded={load}
              disabled={market.status !== "open"}
              accent
            />
          )}
        </div>
      </div>

      {/* Resolve panel for creator */}
      {isCreator && market.status === "open" && (
        <Card className="p-5 mt-6">
          <h3 className="font-medium mb-2">Resolve this market</h3>
          <p className="text-sm text-muted-foreground mb-3">As the creator, enter the final observed value to settle all positions.</p>
          <div className="flex gap-2 max-w-sm">
            <Input type="number" step="any" placeholder="Final value" value={resolveValue} onChange={(e) => setResolveValue(e.target.value)} />
            <Button
              onClick={async () => {
                const v = Number(resolveValue);
                if (Number.isNaN(v)) return toast.error("Enter a number");
                const { error } = await supabase.rpc("resolve_market", { _market_id: market.id, _final_value: v });
                if (error) return toast.error(error.message);
                toast.success("Market resolved & payouts distributed");
                load();
              }}
            >
              Resolve
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bull" | "bear" | "accent" }) {
  const cls = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : tone === "accent" ? "text-accent" : "text-foreground";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-mono-num ${cls} leading-tight mt-0.5`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function ContractPanel({
  title, description, contract, position, onTraded, disabled, accent,
}: {
  title: string; description: string; contract: any; position: any;
  onTraded: () => void; disabled?: boolean; accent?: boolean;
}) {
  const { user } = useAuth();
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [shares, setShares] = useState(10);
  const [busy, setBusy] = useState(false);

  const ry = Number(contract.reserve_yes);
  const rn = Number(contract.reserve_no);
  const probYes = ammPriceYes(ry, rn);
  const cost = ammQuoteBuy(ry, rn, shares, side);
  const fee = cost ? cost * (contract.fee_bps / 10000) : 0;

  const trade = async (action: "buy_yes" | "buy_no" | "sell_yes" | "sell_no") => {
    if (!user) return toast.error("Sign in to trade");
    setBusy(true);
    const { error } = await supabase.rpc("execute_trade", {
      _contract_id: contract.id,
      _side: action,
      _shares: shares,
      _by_bot: false,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Trade executed");
    onTraded();
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className={`font-medium ${accent ? "text-accent" : "text-primary"}`}>{title}</h3>
        <span className="text-xs font-mono-num text-muted-foreground">{(probYes * 100).toFixed(1)}¢ YES</span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">{description}</p>

      <Tabs value={side} onValueChange={(v) => setSide(v as "yes" | "no")}>
        <TabsList className="grid grid-cols-2 mb-3">
          <TabsTrigger value="yes" className="data-[state=active]:bg-bull/20 data-[state=active]:text-bull">YES</TabsTrigger>
          <TabsTrigger value="no" className="data-[state=active]:bg-bear/20 data-[state=active]:text-bear">NO</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="space-y-2 mb-3">
        <Label className="text-xs">Shares</Label>
        <Input type="number" min={1} step={1} value={shares} onChange={(e) => setShares(Math.max(1, Number(e.target.value) || 0))} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground mb-3">
        <span>Est. cost</span>
        <span className="font-mono-num text-foreground">{cost === null ? "—" : `$${(cost + fee).toFixed(2)}`}</span>
      </div>

      <Button className="w-full" disabled={disabled || busy} onClick={() => trade(side === "yes" ? "buy_yes" : "buy_no")}>
        Buy {shares} {side.toUpperCase()}
      </Button>

      {position && (Number(position.yes_shares) > 0 || Number(position.no_shares) > 0) && (
        <div className="mt-4 pt-4 border-t border-border/60 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">YES held</span><span className="font-mono-num">{Number(position.yes_shares).toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">NO held</span><span className="font-mono-num">{Number(position.no_shares).toFixed(2)}</span></div>
          <div className="flex gap-2 mt-2">
            {Number(position.yes_shares) > 0 && (
              <Button size="sm" variant="outline" className="flex-1" disabled={busy || disabled}
                onClick={() => trade("sell_yes")}>Sell YES</Button>
            )}
            {Number(position.no_shares) > 0 && (
              <Button size="sm" variant="outline" className="flex-1" disabled={busy || disabled}
                onClick={() => trade("sell_no")}>Sell NO</Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
