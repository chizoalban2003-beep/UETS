// Shared trend math — used by bot-run, bot-backtest, caretaker-chat, etc.
// Keep in sync with src/lib/trend.ts (pure TypeScript, no Deno-specific APIs).

export type DataPoint = { ts: number; value: number };
export type TrendModel = "linear" | "moving_avg" | "exponential" | "log_linear" | "ewma" | "bollinger" | "seasonal";

const DAY = 86_400_000;

export function fitLinear(points: DataPoint[]): (ts: number) => number {
  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  const n = sorted.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => sorted[0].value;
  const x0 = sorted[0].ts;
  const xs = sorted.map((p) => (p.ts - x0) / DAY);
  const ys = sorted.map((p) => p.value);
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxy = xs.reduce((a, _, i) => a + xs[i] * ys[i], 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return (ts) => intercept + slope * ((ts - x0) / DAY);
}

export function fitMovingAvg(points: DataPoint[], window = 5): (ts: number) => number {
  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  return (ts) => {
    const upto = sorted.filter((p) => p.ts <= ts).slice(-window);
    if (!upto.length) return sorted[0]?.value ?? 0;
    return upto.reduce((a, b) => a + b.value, 0) / upto.length;
  };
}

export function fitEwma(points: DataPoint[], alpha = 0.2): (ts: number) => number {
  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  const series: { ts: number; ema: number }[] = [];
  let ema = sorted[0]?.value ?? 0;
  for (const p of sorted) {
    ema = alpha * p.value + (1 - alpha) * ema;
    series.push({ ts: p.ts, ema });
  }
  return (ts) => {
    const upto = series.filter((s) => s.ts <= ts);
    return (upto[upto.length - 1] ?? series[0])?.ema ?? 0;
  };
}

export function fitTrend(points: DataPoint[], model: TrendModel): (ts: number) => number {
  switch (model) {
    case "moving_avg": return fitMovingAvg(points);
    case "ewma": return fitEwma(points);
    case "exponential":
    case "log_linear": {
      const pos = points.filter((p) => p.value > 0);
      if (pos.length < 2) return () => points[points.length - 1]?.value ?? 0;
      const sorted = [...pos].sort((a, b) => a.ts - b.ts);
      const x0 = sorted[0].ts;
      const xs = sorted.map((p) => (p.ts - x0) / DAY);
      const ys = sorted.map((p) => Math.log(p.value));
      const sx = xs.reduce((a, b) => a + b, 0);
      const sy = ys.reduce((a, b) => a + b, 0);
      const sxy = xs.reduce((a, _, i) => a + xs[i] * ys[i], 0);
      const sxx = xs.reduce((a, b) => a + b * b, 0);
      const denom = sorted.length * sxx - sx * sx;
      const b = denom === 0 ? 0 : (sorted.length * sxy - sx * sy) / denom;
      const a = Math.exp((sy - b * sx) / sorted.length);
      return (ts) => a * Math.exp(b * ((ts - x0) / DAY));
    }
    default: return fitLinear(points);
  }
}

export function distortionScore(
  actual: number, trend: number, bandWidth: number, bandIsPct: boolean,
): number {
  const halfBand = bandIsPct ? Math.abs(trend) * (bandWidth / 100) : bandWidth;
  if (halfBand <= 0) return 0;
  const dev = Math.abs(actual - trend);
  if (dev <= halfBand) return 0;
  return Math.min(1, (dev - halfBand) / (2 * halfBand));
}

export function ammPriceYes(rY: number, rN: number): number {
  const t = rY + rN;
  return t === 0 ? 0.5 : rN / t;
}

export function ammQuoteBuy(rY: number, rN: number, shares: number, side: "yes" | "no"): number | null {
  const k = rY * rN;
  if (side === "yes") {
    if (shares >= rY) return null;
    return k / (rY - shares) - rN;
  } else {
    if (shares >= rN) return null;
    return k / (rN - shares) - rY;
  }
}
