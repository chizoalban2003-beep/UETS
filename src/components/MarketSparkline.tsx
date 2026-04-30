import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LineChart, Line, ResponsiveContainer, YAxis, XAxis } from "recharts";
import { buildBandSeries } from "@/lib/trend";

type Props = {
  marketId: string;
  model: "linear" | "moving_avg" | "exponential";
  bandWidth: number;
  bandIsPct: boolean;
};

export default function MarketSparkline({ marketId, model, bandWidth, bandIsPct }: Props) {
  const [series, setSeries] = useState<{ ts: number; value: number; trend: number; upper: number; lower: number }[]>([]);

  useEffect(() => {
    supabase
      .from("market_data_points")
      .select("ts,value")
      .eq("market_id", marketId)
      .order("ts")
      .then(({ data }) => {
        if (!data || data.length === 0) return setSeries([]);
        const pts = data.map((d) => ({ ts: new Date(d.ts).getTime(), value: Number(d.value) }));
        setSeries(buildBandSeries(pts, model, bandWidth, bandIsPct));
      });
  }, [marketId, model, bandWidth, bandIsPct]);

  if (series.length === 0) {
    return <div className="h-full flex items-center justify-center text-xs text-muted-foreground">no data yet</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={series} margin={{ top: 4, bottom: 0, left: 4, right: 4 }}>
        <XAxis dataKey="ts" hide />
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Line type="monotone" dataKey="upper" stroke="hsl(var(--primary) / 0.35)" strokeWidth={1} dot={false} />
        <Line type="monotone" dataKey="lower" stroke="hsl(var(--primary) / 0.35)" strokeWidth={1} dot={false} />
        <Line type="monotone" dataKey="trend" stroke="hsl(var(--accent))" strokeWidth={1.5} dot={false} />
        <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
