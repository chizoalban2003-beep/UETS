import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { buildBandSeries, TREND_MODEL_LABELS, type TrendModel } from "@/lib/trend";
import { TEMPLATES, PROVIDER_LABELS, type Template } from "@/lib/providers";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { z } from "zod";
import { Radio, Upload, Link2, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";

const SAMPLE_CSV = `2025-01-01,100
2025-01-08,102
2025-01-15,105
2025-01-22,103
2025-01-29,108
2025-02-05,112
2025-02-12,110
2025-02-19,116
2025-02-26,121
2025-03-05,119`;

const schema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(40).optional(),
  unit: z.string().trim().max(20).optional(),
});

type Mode = "template" | "csv" | "custom";
type MarketKind = "time_series" | "event";
type EventOracle = "kalshi" | "polymarket" | "manual";

export default function MarketNew() {
  const { user } = useAuth();
  const nav = useNavigate();

  const [marketKind, setMarketKind] = useState<MarketKind>("time_series");
  const [eventOracle, setEventOracle] = useState<EventOracle>("kalshi");
  const [eventOracleRef, setEventOracleRef] = useState("");

  const [mode, setMode] = useState<Mode>("template");
  const [template, setTemplate] = useState<Template | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("dataset");
  const [unit, setUnit] = useState("value");
  const [csv, setCsv] = useState(SAMPLE_CSV);
  const [model, setModel] = useState<TrendModel>("linear");
  const [bandWidth, setBandWidth] = useState(5);
  const [bandIsPct, setBandIsPct] = useState(true);
  const [resolutionAt, setResolutionAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [rulesMd, setRulesMd] = useState(
    "Resolution rule: At the resolution date, the final value is taken from the configured data source.\n\nDispute policy: Holders may dispute within 24h of the value being posted by locking a 50-credit bond.",
  );

  // Custom URL state
  const [customUrl, setCustomUrl] = useState("");
  const [jsonPath, setJsonPath] = useState("");
  const [fetchInterval, setFetchInterval] = useState(60);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<any | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const runReview = async () => {
    setReviewing(true);
    setReview(null);
    try {
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/market-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({
          name, description, rules_md: rulesMd, resolution_at: resolutionAt,
          data_source: mode === "template" ? template : { kind: mode, custom_url: customUrl, json_path: jsonPath },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "review failed");
      setReview(j.review);
    } catch (e: any) {
      toast.error(e?.message || "Review failed");
    }
    setReviewing(false);
  };

  const csvPoints = useMemo(() => parseCsv(csv), [csv]);
  const previewPoints = mode === "csv" ? csvPoints : (testResult?.ok ? syntheticPreview() : []);
  const series = previewPoints.length ? buildBandSeries(previewPoints, model, bandWidth, bandIsPct) : [];

  const pickTemplate = (t: Template) => {
    setTemplate(t);
    setName(t.label);
    setCategory(t.category);
    setUnit(t.unit);
    setModel(t.trend_model);
    setBandWidth(t.band_width);
    setBandIsPct(t.band_is_pct);
    setDescription(t.description);
    setFetchInterval(t.fetch_interval_minutes);
  };

  const testFetch = async () => {
    if (!customUrl.startsWith("https://")) {
      setTestResult({ ok: false, message: "URL must start with https://" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/test-oracle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ url: customUrl, json_path: jsonPath }),
      });
      const j = await r.json();
      if (!r.ok) {
        setTestResult({ ok: false, message: j.error || "fetch failed" });
      } else {
        setTestResult({ ok: true, message: `Got value: ${j.value}` });
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: String(e?.message || e) });
    }
    setTesting(false);
  };

  const submit = async () => {
    if (!user) return toast.error("Sign in first");
    const parsed = schema.safeParse({ name, description, category, unit });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);

    setBusy(true);

    let dataSourceId: string | null = null;

    try {
      if (marketKind === "event") {
        if (eventOracle !== "manual" && !eventOracleRef.trim()) {
          setBusy(false);
          return toast.error("Provide an oracle reference (ticker / token id)");
        }
        if (eventOracle === "manual" && rulesMd.trim().length < 60) {
          setBusy(false);
          return toast.error("Manual oracle requires detailed rules (60+ chars)");
        }
        if (eventOracle === "kalshi" || eventOracle === "polymarket") {
          const params = eventOracle === "kalshi"
            ? { ticker: eventOracleRef.trim() }
            : { token_id: eventOracleRef.trim() };
          const { data: ds, error: dsErr } = await supabase
            .from("data_sources")
            .insert({
              creator_id: user.id,
              kind: "provider",
              provider: eventOracle,
              provider_params: params as any,
              fetch_interval_minutes: 30,
            })
            .select()
            .single();
          if (dsErr || !ds) throw dsErr;
          dataSourceId = ds.id;
        }
      } else if (mode === "template" && template) {
        const { data: ds, error: dsErr } = await supabase
          .from("data_sources")
          .insert({
            creator_id: user.id,
            kind: "provider",
            provider: template.provider,
            provider_params: template.provider_params as any,
            fetch_interval_minutes: template.fetch_interval_minutes,
          })
          .select()
          .single();
        if (dsErr || !ds) throw dsErr;
        dataSourceId = ds.id;
      } else if (mode === "custom") {
        if (!testResult?.ok) {
          setBusy(false);
          return toast.error("Test the data source first");
        }
        const { data: ds, error: dsErr } = await supabase
          .from("data_sources")
          .insert({
            creator_id: user.id,
            kind: "custom_url",
            custom_url: customUrl,
            json_path: jsonPath || null,
            fetch_interval_minutes: fetchInterval,
          })
          .select()
          .single();
        if (dsErr || !ds) throw dsErr;
        dataSourceId = ds.id;
      } else if (mode === "csv") {
        if (csvPoints.length < 3) {
          setBusy(false);
          return toast.error("Add at least 3 data points");
        }
      }

      if (rulesMd.trim().length < 20) {
        setBusy(false);
        return toast.error("Rules must be at least 20 characters");
      }
      const { data: market, error } = await supabase
        .from("markets")
        .insert({
          creator_id: user.id,
          name,
          description: description || null,
          category: marketKind === "event" ? (category || "Event") : category,
          unit: marketKind === "event" ? "p(YES)" : unit,
          trend_model: model,
          band_width: bandWidth,
          band_is_pct: bandIsPct,
          resolution_at: new Date(resolutionAt + "T23:59:59Z").toISOString(),
          data_source_id: dataSourceId,
          rules_md: rulesMd,
          status: "draft" as any,
          market_kind: marketKind as any,
          event_oracle_kind: marketKind === "event" ? (eventOracle as any) : null,
          event_oracle_ref: marketKind === "event" ? (eventOracleRef.trim() || null) : null,
        })
        .select()
        .single();
      if (error || !market) throw error;

      // Seed initial data point(s)
      if (marketKind === "time_series" && mode === "csv") {
        const rows = csvPoints.map((p) => ({
          market_id: market.id,
          ts: new Date(p.ts).toISOString(),
          value: p.value,
        }));
        await supabase.from("market_data_points").insert(rows);
      } else if (dataSourceId) {
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-data`, {
          method: "POST",
          headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        }).catch(() => {});
      }

      setBusy(false);
      toast.success("Draft saved — review rules & stake to publish");
      nav(`/markets/${market.id}`);
    } catch (e: any) {
      setBusy(false);
      toast.error(e?.message || "Failed to create market");
    }
  };

  return (
    <div className="container py-10 max-w-6xl">
      <h1 className="text-3xl font-semibold tracking-tight mb-2">Create a market</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Pick a live dataset, plug in a URL, or upload your own. Set the elasticity band — traders price the distortion.
      </p>

      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="mb-6">
        <TabsList className="grid grid-cols-3 max-w-xl">
          <TabsTrigger value="template" className="gap-2"><Sparkles className="w-4 h-4" /> Template</TabsTrigger>
          <TabsTrigger value="custom" className="gap-2"><Link2 className="w-4 h-4" /> Custom URL</TabsTrigger>
          <TabsTrigger value="csv" className="gap-2"><Upload className="w-4 h-4" /> CSV</TabsTrigger>
        </TabsList>

        <TabsContent value="template" className="mt-4">
          <Card className="p-5">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickTemplate(t)}
                  className={`text-left p-4 rounded-lg border transition-colors ${
                    template?.id === t.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5">{t.category}</Badge>
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 gap-1 border-bull/40 text-bull">
                      <Radio className="w-3 h-3" /> Live
                    </Badge>
                  </div>
                  <div className="font-medium text-sm">{t.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{t.description}</div>
                  <div className="text-[10px] text-muted-foreground mt-2">
                    {PROVIDER_LABELS[t.provider]} · every {t.fetch_interval_minutes} min · {TREND_MODEL_LABELS[t.trend_model].label}
                  </div>
                </button>
              ))}
            </div>
            {template && (
              <div className="mt-4 text-xs text-muted-foreground">
                Selected: <span className="text-foreground font-medium">{template.label}</span> — fill in the resolution date below and create the market.
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="custom" className="mt-4">
          <Card className="p-5 space-y-4">
            <div className="space-y-2">
              <Label>HTTPS JSON endpoint</Label>
              <Input
                placeholder="https://api.example.com/metric.json"
                value={customUrl}
                onChange={(e) => { setCustomUrl(e.target.value); setTestResult(null); }}
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>JSON path to numeric value</Label>
                <Input
                  placeholder="e.g. data.price or 0.value"
                  value={jsonPath}
                  onChange={(e) => { setJsonPath(e.target.value); setTestResult(null); }}
                />
              </div>
              <div className="space-y-2">
                <Label>Fetch interval (minutes)</Label>
                <Input type="number" min={5} value={fetchInterval} onChange={(e) => setFetchInterval(Math.max(5, Number(e.target.value) || 60))} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={testFetch} disabled={testing || !customUrl}>
                {testing ? "Testing…" : "Test fetch"}
              </Button>
              {testResult && (
                <div className={`flex items-center gap-1 text-sm ${testResult.ok ? "text-bull" : "text-bear"}`}>
                  {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  {testResult.message}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              The server will fetch this URL on schedule and extract the number at the given path. Backfill is not possible for arbitrary URLs — the chart fills in over time.
            </p>
          </Card>
        </TabsContent>

        <TabsContent value="csv" className="mt-4">
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <Label>Series — <code className="text-xs">date,value</code> per line</Label>
              <span className="text-xs text-muted-foreground">{csvPoints.length} points</span>
            </div>
            <Textarea rows={10} value={csv} onChange={(e) => setCsv(e.target.value)} className="font-mono-num text-xs" />
          </Card>
        </TabsContent>
      </Tabs>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="p-5 space-y-4">
          <h2 className="font-medium">Basics</h2>
          <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BTC price elastic, Q2 2026" /></div>
          <div className="space-y-2"><Label>Description</Label><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Category</Label><Input value={category} onChange={(e) => setCategory(e.target.value)} /></div>
            <div className="space-y-2"><Label>Unit</Label><Input value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label>Resolution date</Label><Input type="date" value={resolutionAt} onChange={(e) => setResolutionAt(e.target.value)} /></div>
          <div className="space-y-2">
            <Label>Resolution & dispute rules</Label>
            <Textarea rows={5} value={rulesMd} onChange={(e) => setRulesMd(e.target.value)}
              placeholder="How will the final value be determined? What counts as a valid dispute?" />
            <p className="text-[11px] text-muted-foreground">Traders see this on the market page. Min 20 chars.</p>
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="font-medium">Trend & elasticity</h2>
          <div className="space-y-2">
            <Label>Trend model</Label>
            <Select value={model} onValueChange={(v) => setModel(v as TrendModel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TREND_MODEL_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{TREND_MODEL_LABELS[model].desc}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Band width</Label>
              <Input type="number" step="0.1" value={bandWidth} onChange={(e) => setBandWidth(Number(e.target.value))} disabled={model === "bollinger"} />
              {model === "bollinger" && <p className="text-[10px] text-muted-foreground">Bollinger sets band automatically (±2σ).</p>}
            </div>
            <div className="space-y-2 flex flex-col">
              <Label>Band as %</Label>
              <div className="flex items-center gap-2 h-10">
                <Switch checked={bandIsPct} onCheckedChange={setBandIsPct} disabled={model === "bollinger"} />
                <span className="text-sm text-muted-foreground">{bandIsPct ? "% of trend" : "absolute"}</span>
              </div>
            </div>
          </div>
        </Card>

        {mode === "csv" && (
          <Card className="p-5 md:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-medium">Preview</h2>
              <span className="text-xs text-muted-foreground">{csvPoints.length} points</span>
            </div>
            <div className="h-56 border border-border/60 rounded-md p-2 bg-card/40">
              {series.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series}>
                    <XAxis dataKey="ts" tickFormatter={(t) => new Date(t).toLocaleDateString()} fontSize={10} stroke="hsl(var(--muted-foreground))" />
                    <YAxis fontSize={10} stroke="hsl(var(--muted-foreground))" domain={["auto", "auto"]} />
                    <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} labelFormatter={(t) => new Date(t).toLocaleDateString()} />
                    <Line type="monotone" dataKey="upper" stroke="hsl(var(--primary) / 0.4)" strokeDasharray="4 4" dot={false} />
                    <Line type="monotone" dataKey="lower" stroke="hsl(var(--primary) / 0.4)" strokeDasharray="4 4" dot={false} />
                    <Line type="monotone" dataKey="trend" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Add data above to preview the band</div>
              )}
            </div>
          </Card>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={runReview} disabled={reviewing || !name || rulesMd.length < 20}>
          <Sparkles className="w-4 h-4 mr-1" />
          {reviewing ? "Reviewing…" : "Get AI fairness review"}
        </Button>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => nav("/markets")}>Cancel</Button>
          <Button onClick={submit} disabled={busy || (mode === "template" && !template) || (mode === "custom" && !testResult?.ok)}>
            {busy ? "Saving…" : "Save draft → review & stake"}
          </Button>
        </div>
      </div>

      {review && (
        <Card className="mt-4 p-4 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant={review.verdict === "approve" ? "default" : review.verdict === "reject" ? "destructive" : "outline"}>
              {review.verdict?.toUpperCase()}
            </Badge>
            <span className="text-xs text-muted-foreground">Clarity {review.clarity}/10 · Objectivity {review.objectivity}/10 · Safety {review.safety}/10</span>
          </div>
          {review.issues?.length > 0 && (
            <div>
              <div className="text-xs font-medium mb-1">Issues</div>
              <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                {review.issues.map((i: string, k: number) => <li key={k}>{i}</li>)}
              </ul>
            </div>
          )}
          {review.suggestions?.length > 0 && (
            <div>
              <div className="text-xs font-medium mb-1">Suggestions</div>
              <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                {review.suggestions.map((i: string, k: number) => <li key={k}>{i}</li>)}
              </ul>
            </div>
          )}
        </Card>
      )}
      <p className="text-xs text-muted-foreground mt-2 text-right">
        After saving you'll lock a creator stake (min $400) on the market page to publish it.
      </p>
    </div>
  );
}

function parseCsv(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [d, v] = l.split(/[,\t;]/).map((s) => s.trim());
      const ts = Date.parse(d);
      const value = Number(v);
      if (Number.isNaN(ts) || Number.isNaN(value)) return null;
      return { ts, value };
    })
    .filter((p): p is { ts: number; value: number } => p !== null);
}

// Synthetic single-point preview for live sources before any data arrives
function syntheticPreview() {
  const now = Date.now();
  const out = [];
  for (let i = 30; i >= 0; i--) {
    out.push({ ts: now - i * 86400000, value: 100 + Math.sin(i / 3) * 5 + i * 0.3 });
  }
  return out;
}
