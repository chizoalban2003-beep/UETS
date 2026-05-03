import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";

type Row = {
  id: string;
  name: string;
  category: string | null;
  fees_accrued: number;
  status: string;
  market_kind: string;
};

export default function Marketplace() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Marketplace · Driftworks";
    (async () => {
      const { data } = await supabase
        .from("markets")
        .select("id, name, category, fees_accrued, status, market_kind")
        .in("status", ["open", "pending_resolution", "disputable", "resolved"])
        .order("fees_accrued", { ascending: false })
        .limit(50);
      setRows((data as Row[]) || []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Marketplace</h1>
        <p className="text-muted-foreground mt-1">Top markets by lifetime fees — discover where the action is.</p>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-3">
          {rows.map((m) => (
            <Link key={m.id} to={`/markets/${m.id}`}>
              <Card className="hover:border-primary/50 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">{m.name}</CardTitle>
                    <div className="flex gap-2 shrink-0">
                      {m.market_kind === "event" && <Badge variant="outline">Event</Badge>}
                      <Badge variant="secondary">{m.status}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 flex items-center justify-between text-sm text-muted-foreground">
                  <span>{m.category || "Uncategorized"}</span>
                  <span className="flex items-center gap-1 text-bull">
                    <TrendingUp className="w-3 h-3" />
                    §{Number(m.fees_accrued).toFixed(0)} fees
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
          {rows.length === 0 && <p className="text-muted-foreground">No markets yet.</p>}
        </div>
      )}
    </div>
  );
}
