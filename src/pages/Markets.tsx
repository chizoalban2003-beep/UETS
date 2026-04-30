import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import MarketSparkline from "@/components/MarketSparkline";
import { formatDistanceToNow } from "date-fns";

type Market = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  trend_model: "linear" | "moving_avg" | "exponential";
  band_width: number;
  band_is_pct: boolean;
  resolution_at: string;
  status: "open" | "resolving" | "resolved";
};

export default function Markets() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    supabase
      .from("markets")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setMarkets((data as Market[]) || []);
        setLoading(false);
      });
  }, []);

  const filtered = markets.filter(
    (m) => !q || m.name.toLowerCase().includes(q.toLowerCase()) || (m.category || "").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="container py-10">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Markets</h1>
          <p className="text-muted-foreground text-sm mt-1">Trade distortion and snap-back on any trend.</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9 w-64" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button asChild><Link to="/markets/new"><Plus className="w-4 h-4 mr-1" />New market</Link></Button>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading markets…</div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <h3 className="font-medium mb-2">No markets yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Be the first — create a market on any dataset with a trend.</p>
          <Button asChild><Link to="/markets/new">Create the first market</Link></Button>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((m) => (
            <Link key={m.id} to={`/markets/${m.id}`}>
              <Card className="p-5 hover:border-primary/50 transition-colors h-full bg-gradient-surface">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">{m.category || "general"}</div>
                    <h3 className="font-medium leading-snug mt-0.5">{m.name}</h3>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider ${
                    m.status === "open" ? "bg-bull/15 text-bull" : m.status === "resolved" ? "bg-muted text-muted-foreground" : "bg-accent/15 text-accent"
                  }`}>{m.status}</span>
                </div>
                <div className="h-24 -mx-2"><MarketSparkline marketId={m.id} model={m.trend_model} bandWidth={Number(m.band_width)} bandIsPct={m.band_is_pct} /></div>
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{m.unit || "value"}</span>
                  <span>resolves {formatDistanceToNow(new Date(m.resolution_at), { addSuffix: true })}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
