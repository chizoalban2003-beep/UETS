// LiveMarketTicker — shows real-time distortion score for live markets.
// Subscribes to market_data_points via Realtime and updates the distortion meter.
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fitTrend, distortion, ammPriceYes, type DataPoint, type TrendModel } from "@/lib/trend";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Wifi, WifiOff } from "lucide-react";

interface Props {
  marketId: string;
  trendModel: TrendModel;
  bandWidth: number;
  bandIsPct: boolean;
  unit: string;
  reserveYes: number;
  reserveNo: number;
}

const HISTORY_LIMIT = 40;
const STALE_MULTIPLIER = 2;

export default function LiveMarketTicker({
  marketId,
  trendModel,
  bandWidth,
  bandIsPct,
  unit,
  reserveYes,
  reserveNo,
}: Props) {
  const [points, setPoints] = useState<DataPoint[]>([]);
  const [lastTs, setLastTs] = useState<number | null>(null);
  const [fetchIntervalMin, setFetchIntervalMin] = useState(5);
  const [stale, setStale] = useState(false);
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load historical points on mount and fetch interval from data_source
  useEffect(() => {
    (async () => {
      const [{ data: pts }, { data: ds }] = await Promise.all([
        supabase
          .from("market_data_points")
          .select("ts, value")
          .eq("market_id", marketId)
          .order("ts", { ascending: true })
          .limit(HISTORY_LIMIT),
        supabase
          .from("data_sources")
          .select("fetch_interval_minutes")
          .eq("market_id", marketId)
          .maybeSingle(),
      ]);
      if (pts && pts.length > 0) {
        const mapped: DataPoint[] = pts.map((p) => ({
          ts: new Date(p.ts).getTime(),
          value: Number(p.value),
        }));
        setPoints(mapped);
        setLastTs(mapped[mapped.length - 1].ts);
      }
      if (ds?.fetch_interval_minutes) setFetchIntervalMin(ds.fetch_interval_minutes);
    })();
  }, [marketId]);

  // Realtime subscription for new data points
  useEffect(() => {
    const ch = supabase
      .channel(`live-${marketId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "market_data_points", filter: `market_id=eq.${marketId}` },
        (payload) => {
          const raw = payload.new as { ts: string; value: string | number };
          const pt: DataPoint = { ts: new Date(raw.ts).getTime(), value: Number(raw.value) };
          setPoints((prev) => {
            const updated = [...prev, pt];
            return updated.slice(-HISTORY_LIMIT);
          });
          setLastTs(pt.ts);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [marketId]);

  // Stale detection
  useEffect(() => {
    if (staleTimer.current) clearTimeout(staleTimer.current);
    setStale(false);
    const ms = fetchIntervalMin * STALE_MULTIPLIER * 60 * 1000;
    staleTimer.current = setTimeout(() => setStale(true), ms);
    return () => { if (staleTimer.current) clearTimeout(staleTimer.current); };
  }, [lastTs, fetchIntervalMin]);

  if (points.length === 0) return null;

  const latest = points[points.length - 1];
  let trendValue: number | null = null;
  let distortionPct = 0;
  if (points.length >= 3) {
    try {
      const fit = fitTrend(points, trendModel);
      trendValue = fit.value(latest.ts);
      const d = distortion(latest.value, trendValue, bandWidth, bandIsPct);
      distortionPct = Math.min(1, Math.max(0, d)) * 100;
    } catch {
      // not enough data
    }
  }

  const probYes = ammPriceYes(reserveYes, reserveNo);
  const secsSinceLast = lastTs ? Math.floor((Date.now() - lastTs) / 1000) : null;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {stale ? (
            <WifiOff className="w-4 h-4 text-muted-foreground" />
          ) : (
            <Wifi className="w-4 h-4 text-primary animate-pulse" />
          )}
          <span className="text-sm font-medium">Live feed</span>
          {stale && <Badge variant="outline" className="text-xs text-muted-foreground">Stale</Badge>}
        </div>
        {secsSinceLast !== null && (
          <span className="text-xs text-muted-foreground">
            {secsSinceLast < 60 ? `${secsSinceLast}s ago` : `${Math.floor(secsSinceLast / 60)}m ago`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <div className="text-xs text-muted-foreground mb-0.5">Current</div>
          <div className="font-mono-num text-lg font-semibold">
            {latest.value.toFixed(2)}<span className="text-xs ml-0.5 text-muted-foreground">{unit}</span>
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-muted-foreground mb-0.5">Trend</div>
          <div className="font-mono-num text-lg">
            {trendValue !== null ? trendValue.toFixed(2) : "—"}
            {trendValue !== null && <span className="text-xs ml-0.5 text-muted-foreground">{unit}</span>}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-muted-foreground mb-0.5">AMM YES</div>
          <div className="font-mono-num text-lg">{(probYes * 100).toFixed(1)}¢</div>
        </div>
      </div>

      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">Distortion</span>
          <span className={distortionPct > 50 ? "text-bear font-medium" : "text-muted-foreground"}>
            {distortionPct.toFixed(0)}%
          </span>
        </div>
        <Progress
          value={distortionPct}
          className={`h-2 ${distortionPct > 70 ? "[&>div]:bg-bear" : distortionPct > 40 ? "[&>div]:bg-amber-500" : "[&>div]:bg-bull"}`}
        />
        <div className="flex justify-between text-xs mt-0.5 text-muted-foreground">
          <span>inside band</span>
          <span>max breach</span>
        </div>
      </div>
    </div>
  );
}
