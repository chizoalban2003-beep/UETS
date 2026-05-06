import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNum } from "@/lib/trend";
import { User, CalendarDays, BarChart2, Coins, CheckCircle, Settings, UserPlus, UserMinus } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type CreatorProfile = {
  id: string;
  display_name: string;
  referral_code: string;
  market_count: number;
  total_fees_earned: number;
  resolution_rate: number;
  member_since: string;
};

type MarketRow = {
  id: string;
  name: string;
  status: string;
  fees_accrued: number;
  resolution_at: string | null;
  category: string | null;
};

const STATUS_VARIANT: Record<string, string> = {
  open: "text-bull border-bull/40",
  pending_review: "text-amber-500 border-amber-500/40",
  pending_resolution: "text-yellow-500 border-yellow-500/40",
  resolved: "text-muted-foreground",
  cancelled: "text-bear border-bear/40",
};

export default function CreatorProfile() {
  const { creatorId } = useParams<{ creatorId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  useEffect(() => {
    if (!creatorId) return;

    const fetches: Promise<any>[] = [
      supabase.from("creator_profiles").select("*").eq("id", creatorId).maybeSingle(),
      supabase
        .from("markets")
        .select("id,name,status,fees_accrued,resolution_at,category")
        .eq("creator_id", creatorId)
        .not("status", "eq", "draft")
        .order("fees_accrued", { ascending: false }),
    ];
    if (user) {
      fetches.push(
        supabase
          .from("user_follows")
          .select("follower_id")
          .eq("follower_id", user.id)
          .eq("following_id", creatorId)
          .maybeSingle(),
      );
    }

    Promise.all(fetches).then(([{ data: prof }, { data: mkts }, followResult]) => {
      setProfile(prof as CreatorProfile | null);
      setMarkets((mkts as MarketRow[]) || []);
      if (prof) document.title = `${(prof as any).display_name} · Driftworks`;
      if (followResult) setIsFollowing(!!followResult.data);
      setLoading(false);
    });
  }, [creatorId, user]);

  const toggleFollow = async () => {
    if (!user) { toast.error("Sign in to follow creators"); return; }
    setFollowBusy(true);
    if (isFollowing) {
      await supabase.from("user_follows").delete()
        .eq("follower_id", user.id).eq("following_id", creatorId!);
      setIsFollowing(false);
      toast.success("Unfollowed");
    } else {
      await supabase.from("user_follows").upsert(
        { follower_id: user.id, following_id: creatorId },
        { onConflict: "follower_id,following_id" },
      );
      setIsFollowing(true);
      toast.success("Following");
    }
    setFollowBusy(false);
  };

  if (loading) {
    return (
      <div className="container py-10 max-w-4xl">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="container py-10 max-w-4xl">
        <Card className="p-12 text-center text-sm text-muted-foreground">Creator not found.</Card>
      </div>
    );
  }

  const isMe = user?.id === creatorId;
  const resolutionPct = profile.resolution_rate != null
    ? (Number(profile.resolution_rate) * 100).toFixed(0)
    : null;

  return (
    <div className="container py-10 max-w-4xl">
      {/* Header card */}
      <Card className="mb-8">
        <CardContent className="pt-6 pb-6">
          <div className="flex flex-wrap items-start gap-5">
            <div className="w-14 h-14 rounded-full bg-gradient-primary flex items-center justify-center shrink-0">
              <User className="w-7 h-7 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-xl font-semibold tracking-tight truncate">{profile.display_name}</h1>
                {isMe && (
                  <Badge variant="secondary" className="text-[10px]">You</Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CalendarDays className="w-3.5 h-3.5" />
                  Member since {profile.member_since ? format(new Date(profile.member_since), "MMM yyyy") : "—"}
                </span>
                <span className="flex items-center gap-1">
                  <BarChart2 className="w-3.5 h-3.5" />
                  {profile.market_count ?? 0} markets
                </span>
                <span className="flex items-center gap-1">
                  <Coins className="w-3.5 h-3.5" />
                  §{formatNum(Number(profile.total_fees_earned ?? 0))} earned
                </span>
                {resolutionPct !== null && (
                  <span className="flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" />
                    {resolutionPct}% resolution rate
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              {!isMe && (
                <Button
                  variant={isFollowing ? "outline" : "default"}
                  size="sm"
                  disabled={followBusy}
                  onClick={toggleFollow}
                >
                  {isFollowing ? (
                    <><UserMinus className="w-3.5 h-3.5 mr-1.5" />Unfollow</>
                  ) : (
                    <><UserPlus className="w-3.5 h-3.5 mr-1.5" />Follow</>
                  )}
                </Button>
              )}
              {isMe && (
                <Button variant="outline" size="sm" onClick={() => navigate("/settings")} className="shrink-0">
                  <Settings className="w-3.5 h-3.5 mr-1.5" />
                  Edit profile
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Markets grid */}
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Markets</h2>
      {markets.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">No public markets yet.</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {markets.map((m) => (
            <Link key={m.id} to={`/markets/${m.id}`} className="block group">
              <Card className="p-4 h-full transition-all group-hover:border-primary/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      {m.category && (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.category}</span>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${STATUS_VARIANT[m.status] ?? ""}`}
                      >
                        {m.status === "pending_review" ? "Under review" : m.status}
                      </Badge>
                    </div>
                    <div className="font-medium text-sm leading-snug group-hover:underline">{m.name}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground shrink-0">
                    <div>Fees</div>
                    <div className="font-mono-num text-bull">§{formatNum(Number(m.fees_accrued ?? 0))}</div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

type CreatorProfile = {
  id: string;
  display_name: string;
  referral_code: string;
  market_count: number;
  total_fees_earned: number;
  resolution_rate: number;
  member_since: string;
};

type MarketRow = {
  id: string;
  name: string;
  status: string;
  fees_accrued: number;
  resolution_at: string | null;
  category: string | null;
};

const STATUS_VARIANT: Record<string, string> = {
  open: "text-bull border-bull/40",
  pending_review: "text-amber-500 border-amber-500/40",
  pending_resolution: "text-yellow-500 border-yellow-500/40",
  resolved: "text-muted-foreground",
  cancelled: "text-bear border-bear/40",
};

export default function CreatorProfile() {
  const { creatorId } = useParams<{ creatorId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!creatorId) return;

    Promise.all([
      supabase.from("creator_profiles").select("*").eq("id", creatorId).maybeSingle(),
      supabase
        .from("markets")
        .select("id,name,status,fees_accrued,resolution_at,category")
        .eq("creator_id", creatorId)
        .not("status", "eq", "draft")
        .order("fees_accrued", { ascending: false }),
    ]).then(([{ data: prof }, { data: mkts }]) => {
      setProfile(prof as CreatorProfile | null);
      setMarkets((mkts as MarketRow[]) || []);
      if (prof) document.title = `${(prof as any).display_name} · Driftworks`;
      setLoading(false);
    });
  }, [creatorId]);

  if (loading) {
    return (
      <div className="container py-10 max-w-4xl">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="container py-10 max-w-4xl">
        <Card className="p-12 text-center text-sm text-muted-foreground">Creator not found.</Card>
      </div>
    );
  }

  const isMe = user?.id === creatorId;
  const resolutionPct = profile.resolution_rate != null
    ? (Number(profile.resolution_rate) * 100).toFixed(0)
    : null;

  return (
    <div className="container py-10 max-w-4xl">
      {/* Header card */}
      <Card className="mb-8">
        <CardContent className="pt-6 pb-6">
          <div className="flex flex-wrap items-start gap-5">
            <div className="w-14 h-14 rounded-full bg-gradient-primary flex items-center justify-center shrink-0">
              <User className="w-7 h-7 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-xl font-semibold tracking-tight truncate">{profile.display_name}</h1>
                {isMe && (
                  <Badge variant="secondary" className="text-[10px]">You</Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CalendarDays className="w-3.5 h-3.5" />
                  Member since {profile.member_since ? format(new Date(profile.member_since), "MMM yyyy") : "—"}
                </span>
                <span className="flex items-center gap-1">
                  <BarChart2 className="w-3.5 h-3.5" />
                  {profile.market_count ?? 0} markets
                </span>
                <span className="flex items-center gap-1">
                  <Coins className="w-3.5 h-3.5" />
                  §{formatNum(Number(profile.total_fees_earned ?? 0))} earned
                </span>
                {resolutionPct !== null && (
                  <span className="flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" />
                    {resolutionPct}% resolution rate
                  </span>
                )}
              </div>
            </div>
            {isMe && (
              <Button variant="outline" size="sm" onClick={() => navigate("/settings")} className="shrink-0">
                <Settings className="w-3.5 h-3.5 mr-1.5" />
                Edit profile
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Markets grid */}
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Markets</h2>
      {markets.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">No public markets yet.</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {markets.map((m) => (
            <Link key={m.id} to={`/markets/${m.id}`} className="block group">
              <Card className="p-4 h-full transition-all group-hover:border-primary/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      {m.category && (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.category}</span>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${STATUS_VARIANT[m.status] ?? ""}`}
                      >
                        {m.status === "pending_review" ? "Under review" : m.status}
                      </Badge>
                    </div>
                    <div className="font-medium text-sm leading-snug group-hover:underline">{m.name}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground shrink-0">
                    <div>Fees</div>
                    <div className="font-mono-num text-bull">§{formatNum(Number(m.fees_accrued ?? 0))}</div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
