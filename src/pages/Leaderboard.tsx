import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, TrendingUp, TrendingDown, ShieldCheck } from "lucide-react";
import { formatNum } from "@/lib/trend";
import { useAuth } from "@/hooks/useAuth";

type Row = {
  user_id: string;
  display_name: string;
  balance: number;
  pnl: number;
  pnl_pct: number;
  trade_count: number;
  real_capital_eligible: boolean;
};

export default function Leaderboard() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Leaderboard · Driftworks";
    supabase
      .from("leaderboard")
      .select("*")
      .then(({ data }) => {
        setRows((data as Row[]) || []);
        setLoading(false);
      });
  }, []);

  const medal = (i: number) =>
    i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;

  return (
    <div className="container py-10 max-w-4xl">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-lg bg-gradient-primary shadow-glow flex items-center justify-center">
          <Trophy className="w-5 h-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="text-xs text-muted-foreground">
            Top 100 paper traders ranked by portfolio balance. Starting balance: §10,000.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          No traders yet. Make some trades to appear here!
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => {
            const isMe = r.user_id === user?.id;
            return (
              <Card
                key={r.user_id}
                className={`p-4 flex items-center gap-4 transition-colors ${
                  isMe ? "border-primary/60 bg-primary/5" : "bg-gradient-surface"
                }`}
              >
                <div className="text-xl font-mono w-8 text-center shrink-0">
                  {medal(i)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      to={`/creators/${r.user_id}`}
                      className="font-medium text-sm truncate hover:underline"
                    >
                      {r.display_name}
                    </Link>
                    {isMe && (
                      <Badge variant="secondary" className="text-[10px]">
                        You
                      </Badge>
                    )}
                    {r.real_capital_eligible && (
                      <ShieldCheck className="w-3.5 h-3.5 text-bull shrink-0" title="Real-capital eligible" />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {r.trade_count} trades
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="font-mono-num text-base font-semibold">
                    §{formatNum(r.balance)}
                  </div>
                  <div
                    className={`flex items-center gap-1 text-xs font-mono justify-end ${
                      r.pnl >= 0 ? "text-bull" : "text-bear"
                    }`}
                  >
                    {r.pnl >= 0 ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    {r.pnl >= 0 ? "+" : ""}
                    {formatNum(r.pnl)} ({r.pnl_pct >= 0 ? "+" : ""}
                    {r.pnl_pct}%)
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground text-center mt-8">
        Balances update in real time. Starting balance §10,000. No real money involved.
      </p>
    </div>
  );
}
