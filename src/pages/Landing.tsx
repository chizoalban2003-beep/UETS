import { Link } from "react-router-dom";
import { ArrowRight, Activity, Zap, Bot, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Landing() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-elastic opacity-60 pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.18),transparent_60%)] pointer-events-none" />
        <div className="container relative py-20 md:py-32">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/60 border border-border text-xs text-muted-foreground mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> Driftworks · Demo open · Real capital after assessment
            </div>
            <h1 className="text-5xl md:text-7xl font-semibold tracking-tight leading-[1.05]">
              Trade the <span className="bg-gradient-primary bg-clip-text text-transparent">drift</span>.<br />
              Hedge the snap-back.
            </h1>
            <p className="mt-6 text-lg text-muted-foreground max-w-xl">
              Driftworks turns any trended dataset — prices, weather, climate, on-chain
              metrics — into a tradable market. Trade the distortion from trend, hedge the
              snap-back, and let an AI caretaker run the playbook.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Button size="lg" asChild><Link to="/markets">Browse markets <ArrowRight className="w-4 h-4 ml-1" /></Link></Button>
              <Button size="lg" variant="outline" asChild><Link to="/assessment">Real-capital assessment</Link></Button>
            </div>
          </div>
        </div>
      </section>

      {/* Three pillars */}
      <section className="container py-16 md:py-24">
        <div className="grid md:grid-cols-3 gap-6">
          <Card className="p-6 bg-gradient-surface border-border/60">
            <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center mb-4">
              <TrendingUp className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Any trend, any dataset</h3>
            <p className="text-sm text-muted-foreground">Upload time series, pick a trend model (linear, moving average, exponential), set the elasticity band. The market builds itself.</p>
          </Card>
          <Card className="p-6 bg-gradient-surface border-border/60">
            <div className="w-10 h-10 rounded-md bg-accent/10 text-accent flex items-center justify-center mb-4">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Two-instrument design</h3>
            <p className="text-sm text-muted-foreground"><span className="text-primary">Distortion</span> contracts pay scalar-style on how far reality stretches from the trend. <span className="text-accent">Snap-back</span> contracts are binary — does it return inside the band?</p>
          </Card>
          <Card className="p-6 bg-gradient-surface border-border/60">
            <div className="w-10 h-10 rounded-md bg-bull/10 text-bull flex items-center justify-center mb-4">
              <Bot className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-semibold mb-2">AI bot, your rules</h3>
            <p className="text-sm text-muted-foreground">Suggest, approve, or full-auto. Mean-reversion, momentum, or a custom strategy you describe in plain English. Every trade comes with rationale.</p>
          </Card>
        </div>
      </section>

      {/* How it works */}
      <section className="container pb-24">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight mb-4">The elastic-trend metaphor</h2>
            <p className="text-muted-foreground mb-4">Every trend is a relaxed elastic. Real-world data stretches it above or compresses it below. The further it deviates from the band, the more potential energy is stored — and the bigger the snap-back, or the bigger the regime change.</p>
            <ul className="space-y-3 text-sm">
              <li className="flex gap-3"><span className="text-primary font-mono-num">01</span><span>Creator defines the dataset, fits a trend, sets a band width.</span></li>
              <li className="flex gap-3"><span className="text-primary font-mono-num">02</span><span>Traders take YES/NO positions on distortion + snap-back via an AMM.</span></li>
              <li className="flex gap-3"><span className="text-primary font-mono-num">03</span><span>At resolution, payouts come from how stretched the elastic ended up.</span></li>
            </ul>
          </div>
          <Card className="p-6 bg-gradient-surface border-border/60">
            <div className="text-sm text-muted-foreground mb-4">Example: a temperature index with a linear trend and a 5% band.</div>
            <ElasticDemo />
          </Card>
        </div>
      </section>
    </div>
  );
}

import { LineChart, Line, ReferenceArea, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

function ElasticDemo() {
  const data = Array.from({ length: 24 }, (_, i) => {
    const trend = 100 + i * 1.2;
    const noise = Math.sin(i / 1.8) * 6 + (i > 18 ? (i - 18) * 4 : 0);
    return { i, value: trend + noise, trend, upper: trend * 1.05, lower: trend * 0.95 };
  });
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
          <XAxis dataKey="i" hide />
          <YAxis hide domain={["dataMin - 5", "dataMax + 5"]} />
          <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
          <Line type="monotone" dataKey="upper" stroke="hsl(var(--primary) / 0.4)" strokeDasharray="4 4" dot={false} />
          <Line type="monotone" dataKey="lower" stroke="hsl(var(--primary) / 0.4)" strokeDasharray="4 4" dot={false} />
          <Line type="monotone" dataKey="trend" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
