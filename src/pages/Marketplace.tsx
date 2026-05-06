import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TrendingUp, Search, Zap, Users } from "lucide-react";
import { formatNum } from "@/lib/trend";
import { formatDistanceToNow } from "date-fns";

type Row = {
  id: string;
  name: string;
  category: string | null;
  fees_accrued: number;
  status: string;
  market_kind: string | null;
  resolution_at: string;
  data_source_id: string | null;
  trade_count?: number;
};

type SortKey = "fees" | "resolution" | "name";

export default function Marketplace() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [followedRows, setFollowedRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [followedLoading, setFollowedLoading] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("fees");

  useEffect(() => {
    document.title = "Marketplace · Driftworks";
    (async () => {
      const { data } = await supabase
        .from("markets")
        .select("id, name, category, fees_accrued, status, market_kind, resolution_at, data_source_id")
        .in("status", ["open", "pending_resolution", "disputable", "resolved"])
        .order("fees_accrued", { ascending: false })
        .limit(100);
      setRows((data as Row[]) || []);
      setLoading(false);
    })();
  }, []);

  // Load followed markets when user is signed in
  useEffect(() => {
    if (!user) { setFollowedRows([]); return; }
    setFollowedLoading(true);
    (async () => {
      // Get IDs of creators this user follows
      const { data: follows } = await supabase
        .from("user_follows")
        .select("following_id")
        .eq("follower_id", user.id);
      const creatorIds = (follows ?? []).map((f: any) => f.following_id);
      if (creatorIds.length === 0) { setFollowedRows([]); setFollowedLoading(false); return; }
      const { data } = await supabase
        .from("markets")
        .select("id, name, category, fees_accrued, status, market_kind, resolution_at, data_source_id")
        .in("creator_id", creatorIds)
        .in("status", ["open", "pending_resolution", "disputable"])
        .order("created_at", { ascending: false })
        .limit(50);
      setFollowedRows((data as Row[]) || []);
      setFollowedLoading(false);
    })();
  }, [user]);

  const filtered = useMemo(() => rows
    .filter((r) =>
      !q ||
      r.name.toLowerCase().includes(q.toLowerCase()) ||
      (r.category || "").toLowerCase().includes(q.toLowerCase())
    )
    .sort((a, b) => {
      if (sort === "fees") return Number(b.fees_accrued) - Number(a.fees_accrued);
      if (sort === "resolution") return new Date(a.resolution_at).getTime() - new Date(b.resolution_at).getTime();
      return a.name.localeCompare(b.name);
    }), [rows, q, sort]);

  const totalFees = rows.reduce((s, r) => s + Number(r.fees_accrued), 0);
  const liveCount = rows.filter((r) => r.data_source_id).length;
  const openCount = rows.filter((r) => r.status === "open").length;

  const MarketRow = ({ m, i }: { m: Row; i: number }) => (
    <Link key={m.id} to={`/markets/${m.id}`}>
      <Card className="hover:border-primary/50 transition-colors">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              {i >= 0 && <span className="text-xs font-mono text-muted-foreground w-5 text-right">{i + 1}</span>}
              <CardTitle className="text-base">{m.name}</CardTitle>
            </div>
            <div className="flex gap-2 shrink-0">
              {m.data_source_id && (
                <Badge variant="outline" className="text-bull border-bull/30 text-[10px] gap-1">
                  <Zap className="w-2.5 h-2.5" />Live
                </Badge>
              )}
              {m.market_kind === "event" && <Badge variant="outline" className="text-[10px]">Event</Badge>}
              <Badge variant="secondary" className="text-[10px]">{m.status}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 flex items-center justify-between text-sm text-muted-foreground">
          <span>{m.category || "Uncategorized"}</span>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-muted-foreground">
              {formatDistanceToNow(new Date(m.resolution_at), { addSuffix: true })}
            </span>
            {Number(m.fees_accrued) > 0 && (
              <span className="flex items-center gap-1 text-bull font-mono-num">
                <TrendingUp className="w-3 h-3" />
                §{formatNum(m.fees_accrued, 0)} fees
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Marketplace</h1>
        <p className="text-muted-foreground mt-1">
          Discover markets ranked by activity. {openCount} open · {liveCount} live-data · §{formatNum(totalFees)} total fees.
        </p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Open markets", value: openCount },
          { label: "Live-oracle", value: liveCount },
          { label: "Total fees §", value: formatNum(totalFees) },
        ].map(({ label, value }) => (
          <Card key={label} className="p-3 text-center bg-gradient-surface">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="font-mono-num text-xl font-semibold mt-0.5">{value}</div>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="all">
        <div className="flex flex-wrap gap-3 mb-5 items-center justify-between">
          <TabsList>
            <TabsTrigger value="all">All markets</TabsTrigger>
            {user && (
              <TabsTrigger value="following">
                <Users className="w-3.5 h-3.5 mr-1.5" />
                Following
              </TabsTrigger>
            )}
          </TabsList>

          {/* Search + sort */}
          <div className="flex gap-3 flex-wrap">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9 w-48" placeholder="Search markets…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex gap-2">
              {(["fees", "resolution", "name"] as SortKey[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSort(s)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    sort === s
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                  }`}
                >
                  {s === "fees" ? "Top fees" : s === "resolution" ? "Resolving soon" : "Name"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <TabsContent value="all">
          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid gap-3">
              {filtered.map((m, i) => <MarketRow key={m.id} m={m} i={i} />)}
              {filtered.length === 0 && <p className="text-muted-foreground">No markets match your search.</p>}
            </div>
          )}
        </TabsContent>

        {user && (
          <TabsContent value="following">
            {followedLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : followedRows.length === 0 ? (
              <Card className="p-10 text-center text-sm text-muted-foreground">
                Follow creators from their profile pages to see their markets here.
              </Card>
            ) : (
              <div className="grid gap-3">
                {followedRows.map((m) => <MarketRow key={m.id} m={m} i={-1} />)}
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

type Row = {
  id: string;
  name: string;
  category: string | null;
  fees_accrued: number;
  status: string;
  market_kind: string | null;
  resolution_at: string;
  data_source_id: string | null;
  trade_count?: number;
};

type SortKey = "fees" | "resolution" | "name";

export default function Marketplace() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("fees");

  useEffect(() => {
    document.title = "Marketplace · Driftworks";
    (async () => {
      const { data } = await supabase
        .from("markets")
        .select("id, name, category, fees_accrued, status, market_kind, resolution_at, data_source_id")
        .in("status", ["open", "pending_resolution", "disputable", "resolved"])
        .order("fees_accrued", { ascending: false })
        .limit(100);
      setRows((data as Row[]) || []);
      setLoading(false);
    })();
  }, []);

  const filtered = rows
    .filter((r) =>
      !q ||
      r.name.toLowerCase().includes(q.toLowerCase()) ||
      (r.category || "").toLowerCase().includes(q.toLowerCase())
    )
    .sort((a, b) => {
      if (sort === "fees") return Number(b.fees_accrued) - Number(a.fees_accrued);
      if (sort === "resolution") return new Date(a.resolution_at).getTime() - new Date(b.resolution_at).getTime();
      return a.name.localeCompare(b.name);
    });

  const totalFees = rows.reduce((s, r) => s + Number(r.fees_accrued), 0);
  const liveCount = rows.filter((r) => r.data_source_id).length;
  const openCount = rows.filter((r) => r.status === "open").length;

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Marketplace</h1>
        <p className="text-muted-foreground mt-1">
          Discover markets ranked by activity. {openCount} open · {liveCount} live-data · §{formatNum(totalFees)} total fees.
        </p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Open markets", value: openCount },
          { label: "Live-oracle", value: liveCount },
          { label: "Total fees §", value: formatNum(totalFees) },
        ].map(({ label, value }) => (
          <Card key={label} className="p-3 text-center bg-gradient-surface">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="font-mono-num text-xl font-semibold mt-0.5">{value}</div>
          </Card>
        ))}
      </div>

      {/* Search + sort */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search markets…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-2">
          {(["fees", "resolution", "name"] as SortKey[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                sort === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
              }`}
            >
              {s === "fees" ? "Top fees" : s === "resolution" ? "Resolving soon" : "Name"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-3">
          {filtered.map((m, i) => (
            <Link key={m.id} to={`/markets/${m.id}`}>
              <Card className="hover:border-primary/50 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground w-5 text-right">{i + 1}</span>
                      <CardTitle className="text-base">{m.name}</CardTitle>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {m.data_source_id && (
                        <Badge variant="outline" className="text-bull border-bull/30 text-[10px] gap-1">
                          <Zap className="w-2.5 h-2.5" />Live
                        </Badge>
                      )}
                      {m.market_kind === "event" && <Badge variant="outline" className="text-[10px]">Event</Badge>}
                      <Badge variant="secondary" className="text-[10px]">{m.status}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 flex items-center justify-between text-sm text-muted-foreground">
                  <span>{m.category || "Uncategorized"}</span>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-muted-foreground">
                      {formatDistanceToNow(new Date(m.resolution_at), { addSuffix: true })}
                    </span>
                    {Number(m.fees_accrued) > 0 && (
                      <span className="flex items-center gap-1 text-bull font-mono-num">
                        <TrendingUp className="w-3 h-3" />
                        §{formatNum(m.fees_accrued, 0)} fees
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {filtered.length === 0 && <p className="text-muted-foreground">No markets match your search.</p>}
        </div>
      )}
    </div>
  );
}
