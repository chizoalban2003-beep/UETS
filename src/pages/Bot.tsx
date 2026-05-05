import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Bot, Play, Check, X, TrendingUp, TrendingDown, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { formatNum } from "@/lib/trend";
import { Link } from "react-router-dom";
import CaretakerModeSlider, { type CaretakerMode } from "@/components/CaretakerModeSlider";

function CaretakerModePanel() {
  const { user } = useAuth();
  const [mode, setMode] = useState<CaretakerMode>("suggest");
  const [skill, setSkill] = useState<"beginner" | "intermediate" | "advanced">("beginner");
  useEffect(() => {
    document.title = "Bot · Driftworks";
    if (!user) return;
    supabase.from("profiles").select("skill_level,caretaker_mode").eq("id", user.id).maybeSingle().then(({ data }) => {
      if (data) {
        setMode(((data as any).caretaker_mode || "suggest") as CaretakerMode);
        setSkill(((data as any).skill_level || "beginner") as any);
      }
    });
  }, [user]);
  const updateMode = async (m: CaretakerMode) => {
    if (!user) return;
    setMode(m);
    await supabase.from("profiles").update({ caretaker_mode: m }).eq("id", user.id);
    toast.success(`Caretaker → ${m}`);
  };
  const updateSkill = async (s: typeof skill) => {
    if (!user) return;
    setSkill(s);
    await supabase.from("profiles").update({ skill_level: s }).eq("id", user.id);
  };
  return (
    <Card className="p-6 space-y-4 border-primary/30 bg-gradient-surface">
      <div>
        <Label className="mb-1 block">Caretaker mode</Label>
        <p className="text-xs text-muted-foreground mb-3">One slider controls how much the AI does for you across the whole app.</p>
        <CaretakerModeSlider value={mode} onChange={updateMode} />
      </div>
      <div>
        <Label className="mb-2 block">Your skill level</Label>
        <div className="flex gap-2 flex-wrap">
          {(["beginner", "intermediate", "advanced"] as const).map((s) => (
            <Button key={s} size="sm" variant={skill === s ? "default" : "outline"} className="capitalize" onClick={() => updateSkill(s)}>{s}</Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">Drives how much the Caretaker explains vs. assumes you know.</p>
      </div>
    </Card>
  );
}

type BotMode = "off" | "suggest" | "approve" | "auto";
type BotStrategy = "mean_reversion" | "momentum" | "custom";

type BotRow = {
  user_id: string;
  mode: BotMode;
  strategy: BotStrategy;
  enabled_market_ids: string[];
  max_position_size: number;
  max_daily_loss: number;
  custom_prompt: string | null;
};

type Suggestion = {
  id: string;
  market_id: string;
  contract_id: string;
  side: string;
  shares: number;
  est_cost: number;
  confidence: number;
  rationale: string;
  status: "pending" | "approved" | "rejected" | "skipped" | "executed";
  created_at: string;
  resolved_at: string | null;
  trade_id: string | null;
};

type MarketLite = { id: string; name: string; status: string };

type TradeRow = {
  id: string;
  contract_id: string;
  side: string;
  shares: number;
  price: number;
  cost: number;
  fee: number;
  by_bot: boolean;
  created_at: string;
};

const MODE_LABEL: Record<BotMode, string> = {
  off: "Off",
  suggest: "Suggest",
  approve: "Approve",
  auto: "Full auto",
};

export default function BotPage() {
  const { user } = useAuth();
  const [bot, setBot] = useState<BotRow | null>(null);
  const [markets, setMarkets] = useState<MarketLite[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [botTrades, setBotTrades] = useState<TradeRow[]>([]);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);

  const marketName = (id: string) => markets.find((m) => m.id === id)?.name ?? id.slice(0, 6);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: b }, { data: m }, { data: s }, { data: t }] = await Promise.all([
        supabase.from("bots").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("markets").select("id,name,status").order("created_at", { ascending: false }),
        supabase
          .from("bot_suggestions")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("trades")
          .select("*")
          .eq("user_id", user.id)
          .eq("by_bot", true)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      setBot(b as BotRow | null);
      setMarkets((m as MarketLite[]) ?? []);
      setSuggestions((s as Suggestion[]) ?? []);
      setBotTrades((t as TradeRow[]) ?? []);
    })();
  }, [user]);

  // Realtime suggestions feed
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`bot-suggestions-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bot_suggestions", filter: `user_id=eq.${user.id}` },
        async () => {
          const { data } = await supabase
            .from("bot_suggestions")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(50);
          setSuggestions((data as Suggestion[]) ?? []);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  async function saveBot(patch: Partial<BotRow>) {
    if (!bot || !user) return;
    setSaving(true);
    const next = { ...bot, ...patch };
    const { error } = await supabase
      .from("bots")
      .update({
        mode: next.mode,
        strategy: next.strategy,
        enabled_market_ids: next.enabled_market_ids,
        max_position_size: next.max_position_size,
        max_daily_loss: next.max_daily_loss,
        custom_prompt: next.custom_prompt,
      })
      .eq("user_id", user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      setBot(next);
      toast.success("Bot updated");
    }
  }

  async function runBot() {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("bot-run");
    setRunning(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if ((data as any)?.error) {
      toast.error((data as any).error);
      return;
    }
    toast.success(`Bot ran. ${(data as any)?.suggestions?.length ?? 0} new suggestions.`);
  }

  async function approve(s: Suggestion) {
    const { data, error } = await supabase.rpc("execute_trade", {
      _contract_id: s.contract_id,
      _side: s.side as any,
      _shares: s.shares,
      _by_bot: true,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase
      .from("bot_suggestions")
      .update({ status: "executed", trade_id: (data as any).id, resolved_at: new Date().toISOString() })
      .eq("id", s.id);
    toast.success("Trade executed");
  }

  async function reject(s: Suggestion) {
    await supabase
      .from("bot_suggestions")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("id", s.id);
  }

  if (!bot) {
    return (
      <div className="container py-10">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const openMarkets = markets.filter((m) => m.status === "open");
  const pending = suggestions.filter((s) => s.status === "pending");
  const history = suggestions.filter((s) => s.status !== "pending");
  const totalBotPnl = botTrades.reduce(
    (acc, t) => acc + (t.side.startsWith("sell") ? Number(t.cost) : -Number(t.cost)),
    0,
  );
  const wins = botTrades.filter((t) => t.side.startsWith("sell")).length;
  const totalTrades = botTrades.length;

  const dismissedKey = user ? `bot-onboarding-dismissed-${user.id}` : "";
  const showOnboarding =
    !!user &&
    bot.enabled_market_ids.length > 0 &&
    botTrades.length === 0 &&
    typeof window !== "undefined" &&
    !window.localStorage.getItem(dismissedKey);

  return (
    <div className="container py-10 max-w-6xl">
      {showOnboarding && (
        <Card className="p-4 mb-6 border-primary/40 bg-gradient-surface flex items-start gap-3 flex-wrap">
          <Sparkles className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-medium mb-1">
              We auto-subscribed you to {bot.enabled_market_ids.length} live markets.
            </p>
            <p className="text-xs text-muted-foreground">
              Bot is in <strong>Suggest</strong> mode — review trade ideas in the feed and approve
              the ones you like. Switch to Auto when you're ready to let it run.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => saveBot({ mode: "auto" })}>
              Switch to Auto
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                window.localStorage.setItem(dismissedKey, "1");
                // force rerender
                setBot({ ...bot });
              }}
            >
              Dismiss
            </Button>
          </div>
        </Card>
      )}

      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight mb-1">Trading bot</h1>
          <p className="text-sm text-muted-foreground">
            Suggest, approve, or full-auto trades on your enabled markets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={bot.mode === "off" ? "secondary" : "default"} className="capitalize">
            {MODE_LABEL[bot.mode]}
          </Badge>
          <Button onClick={runBot} disabled={running || bot.mode === "off"}>
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Run now
          </Button>
        </div>
      </div>

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="feed">
            Suggestion feed
            {pending.length > 0 && (
              <Badge variant="default" className="ml-2 h-5 px-1.5">
                {pending.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-6 mt-6">
          <CaretakerModePanel />
          <Card className="p-6 space-y-5">
            <div>
              <Label className="mb-2 block">Bot trade-execution mode (legacy controls)</Label>
              <p className="text-xs text-muted-foreground mb-2">For most users, the Caretaker mode above is the only switch you need. These finer controls only affect the rule-based bot.</p>
              <Select value={bot.mode} onValueChange={(v) => saveBot({ mode: v as BotMode })}>
                <SelectTrigger className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off — disabled</SelectItem>
                  <SelectItem value="suggest">Suggest — show ideas only</SelectItem>
                  <SelectItem value="approve">Approve — one-click execute</SelectItem>
                  <SelectItem value="auto">Full auto — execute within limits</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-2 block">Strategy</Label>
              <Select
                value={bot.strategy}
                onValueChange={(v) => saveBot({ strategy: v as BotStrategy })}
              >
                <SelectTrigger className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mean_reversion">Mean-reversion (bet on snap-back)</SelectItem>
                  <SelectItem value="momentum">Momentum (bet on continued stretch)</SelectItem>
                  <SelectItem value="custom">Custom (plain English)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {bot.strategy === "custom" && (
              <div>
                <Label className="mb-2 block">Custom strategy prompt</Label>
                <Textarea
                  value={bot.custom_prompt ?? ""}
                  onChange={(e) => setBot({ ...bot, custom_prompt: e.target.value })}
                  onBlur={() => saveBot({ custom_prompt: bot.custom_prompt })}
                  placeholder="e.g. Only buy distortion YES when distortion > 0.4 and value is above trend. Be conservative on low-liquidity markets."
                  rows={4}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 max-w-md">
              <div>
                <Label className="mb-2 block">Max position size (shares)</Label>
                <Input
                  type="number"
                  value={bot.max_position_size}
                  onChange={(e) => setBot({ ...bot, max_position_size: Number(e.target.value) })}
                  onBlur={() => saveBot({ max_position_size: bot.max_position_size })}
                />
              </div>
              <div>
                <Label className="mb-2 block">Max daily loss</Label>
                <Input
                  type="number"
                  value={bot.max_daily_loss}
                  onChange={(e) => setBot({ ...bot, max_daily_loss: Number(e.target.value) })}
                  onBlur={() => saveBot({ max_daily_loss: bot.max_daily_loss })}
                />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-medium">Enabled markets</h2>
                <p className="text-sm text-muted-foreground">Bot will only trade these.</p>
              </div>
              <Badge variant="secondary">{bot.enabled_market_ids.length} enabled</Badge>
            </div>
            {openMarkets.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No open markets yet.{" "}
                <Link to="/markets/new" className="text-primary underline">
                  Create one
                </Link>
                .
              </p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {openMarkets.map((m) => {
                  const enabled = bot.enabled_market_ids.includes(m.id);
                  return (
                    <label
                      key={m.id}
                      className="flex items-center gap-3 p-3 rounded-md border hover:bg-accent/40 cursor-pointer"
                    >
                      <Checkbox
                        checked={enabled}
                        onCheckedChange={(v) => {
                          const next = v
                            ? [...bot.enabled_market_ids, m.id]
                            : bot.enabled_market_ids.filter((x) => x !== m.id);
                          saveBot({ enabled_market_ids: next });
                        }}
                      />
                      <span className="font-medium text-sm flex-1">{m.name}</span>
                      <Link
                        to={`/markets/${m.id}`}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        view →
                      </Link>
                    </label>
                  );
                })}
              </div>
            )}
            {saving && (
              <p className="text-xs text-muted-foreground mt-3 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Saving…
              </p>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="feed" className="space-y-4 mt-6">
          {suggestions.length === 0 ? (
            <Card className="p-10 text-center bg-gradient-surface">
              <Bot className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No suggestions yet. Configure your bot and click "Run now".
              </p>
            </Card>
          ) : (
            suggestions.map((s) => (
              <Card key={s.id} className="p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Link
                        to={`/markets/${s.market_id}`}
                        className="font-medium hover:text-primary"
                      >
                        {marketName(s.market_id)}
                      </Link>
                      <Badge
                        variant="outline"
                        className={
                          s.side.includes("yes")
                            ? "text-bull border-bull/30"
                            : s.side.includes("no")
                              ? "text-bear border-bear/30"
                              : ""
                        }
                      >
                        {s.side.replace("_", " ")}
                      </Badge>
                      {s.status === "pending" && <Badge variant="secondary">pending</Badge>}
                      {s.status === "executed" && (
                        <Badge className="bg-bull/15 text-bull border-bull/30">executed</Badge>
                      )}
                      {s.status === "rejected" && <Badge variant="destructive">rejected</Badge>}
                      {s.status === "skipped" && <Badge variant="outline">skipped</Badge>}
                      <span className="text-xs text-muted-foreground">
                        confidence {(s.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-sm text-foreground/90 mb-2">{s.rationale}</p>
                    <div className="flex gap-4 text-xs text-muted-foreground font-mono">
                      <span>{formatNum(s.shares)} shares</span>
                      <span>est cost {formatNum(s.est_cost)}</span>
                      <span>{new Date(s.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                  {s.status === "pending" && bot.mode !== "auto" && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => reject(s)}>
                        <X className="w-4 h-4 mr-1" /> Reject
                      </Button>
                      <Button size="sm" onClick={() => approve(s)}>
                        <Check className="w-4 h-4 mr-1" /> Approve
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="report" className="space-y-4 mt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-5">
              <div className="text-xs text-muted-foreground mb-1">Bot trades</div>
              <div className="text-2xl font-mono font-semibold">{totalTrades}</div>
            </Card>
            <Card className="p-5">
              <div className="text-xs text-muted-foreground mb-1">Realized cashflow</div>
              <div
                className={`text-2xl font-mono font-semibold ${
                  totalBotPnl >= 0 ? "text-bull" : "text-bear"
                }`}
              >
                {totalBotPnl >= 0 ? (
                  <TrendingUp className="w-5 h-5 inline mr-1" />
                ) : (
                  <TrendingDown className="w-5 h-5 inline mr-1" />
                )}
                {formatNum(totalBotPnl)}
              </div>
            </Card>
            <Card className="p-5">
              <div className="text-xs text-muted-foreground mb-1">Sells / total</div>
              <div className="text-2xl font-mono font-semibold">
                {wins} / {totalTrades}
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <h2 className="font-medium mb-4">Recent bot trades</h2>
            {botTrades.length === 0 ? (
              <p className="text-sm text-muted-foreground">No automated trades yet.</p>
            ) : (
              <div className="divide-y">
                {botTrades.map((t) => (
                  <div key={t.id} className="py-3 flex justify-between items-center text-sm">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="capitalize">
                        {t.side.replace("_", " ")}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatNum(t.shares)} sh @ {formatNum(t.price, 3)}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-mono">{formatNum(t.cost)}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(t.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-medium mb-3">Suggestion history</h2>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No completed suggestions yet.</p>
            ) : (
              <div className="divide-y">
                {history.map((s) => (
                  <div key={s.id} className="py-3 text-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{marketName(s.market_id)}</span>
                      <Badge variant="outline" className="text-xs">
                        {s.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(s.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{s.rationale}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
