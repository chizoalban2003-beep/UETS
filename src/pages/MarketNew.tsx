import { useState } from "react";
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
import { toast } from "sonner";
import { buildBandSeries } from "@/lib/trend";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { z } from "zod";

const SAMPLE = `2025-01-01,100
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

export default function MarketNew() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("dataset");
  const [unit, setUnit] = useState("value");
  const [csv, setCsv] = useState(SAMPLE);
  const [model, setModel] = useState<"linear" | "moving_avg" | "exponential">("linear");
  const [bandWidth, setBandWidth] = useState(5);
  const [bandIsPct, setBandIsPct] = useState(true);
  const [resolutionAt, setResolutionAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [busy, setBusy] = useState(false);

  const points = parseCsv(csv);
  const series = points.length > 0 ? buildBandSeries(points, model, bandWidth, bandIsPct) : [];

  const submit = async () => {
    const parsed = schema.safeParse({ name, description, category, unit });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    if (points.length < 3) return toast.error("Add at least 3 data points");
    if (!user) return toast.error("Sign in first");

    setBusy(true);
    const { data: market, error } = await supabase
      .from("markets")
      .insert({
        creator_id: user.id,
        name, description: description || null, category, unit,
        trend_model: model,
        band_width: bandWidth, band_is_pct: bandIsPct,
        resolution_at: new Date(resolutionAt + "T23:59:59Z").toISOString(),
      })
      .select()
      .single();
    if (error || !market) {
      setBusy(false);
      return toast.error(error?.message || "Failed");
    }
    const rows = points.map((p) => ({ market_id: market.id, ts: new Date(p.ts).toISOString(), value: p.value }));
    const { error: pErr } = await supabase.from("market_data_points").insert(rows);
    setBusy(false);
    if (pErr) return toast.error(pErr.message);
    toast.success("Market created");
    nav(`/markets/${market.id}`);
  };

  return (
    <div className="container py-10 max-w-5xl">
      <h1 className="text-3xl font-semibold tracking-tight mb-2">Create a market</h1>
      <p className="text-muted-foreground text-sm mb-8">Define a trend, set the elasticity band, and let traders price the distortion.</p>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="p-6 space-y-4">
          <h2 className="font-medium">Basics</h2>
          <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. NYC Avg Daily Temperature, Q1 2026" /></div>
          <div className="space-y-2"><Label>Description</Label><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this market track? How will it resolve?" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Category</Label><Input value={category} onChange={(e) => setCategory(e.target.value)} /></div>
            <div className="space-y-2"><Label>Unit</Label><Input value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label>Resolution date</Label><Input type="date" value={resolutionAt} onChange={(e) => setResolutionAt(e.target.value)} /></div>
        </Card>

        <Card className="p-6 space-y-4">
          <h2 className="font-medium">Trend & elasticity</h2>
          <div className="space-y-2">
            <Label>Trend model</Label>
            <Select value={model} onValueChange={(v) => setModel(v as typeof model)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="linear">Linear regression</SelectItem>
                <SelectItem value="moving_avg">Moving average</SelectItem>
                <SelectItem value="exponential">Exponential</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Band width</Label><Input type="number" step="0.1" value={bandWidth} onChange={(e) => setBandWidth(Number(e.target.value))} /></div>
            <div className="space-y-2 flex flex-col">
              <Label>Band as %</Label>
              <div className="flex items-center gap-2 h-10">
                <Switch checked={bandIsPct} onCheckedChange={setBandIsPct} />
                <span className="text-sm text-muted-foreground">{bandIsPct ? "% of trend" : "absolute"}</span>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">The band is the "natural" range. Reality outside it = distortion.</p>
        </Card>

        <Card className="p-6 md:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Data series (CSV: <code className="text-xs">date,value</code>)</h2>
            <span className="text-xs text-muted-foreground">{points.length} point{points.length !== 1 ? "s" : ""}</span>
          </div>
          <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} className="font-mono-num text-xs" />
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
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="outline" onClick={() => nav("/markets")}>Cancel</Button>
        <Button onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create market"}</Button>
      </div>
    </div>
  );
}

function parseCsv(text: string): { ts: number; value: number }[] {
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
