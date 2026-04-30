// Trend fitting + elastic-band math. Pure functions, used by UI and bot.

export type DataPoint = { ts: number; value: number };
export type TrendModel =
  | "linear"
  | "moving_avg"
  | "exponential"
  | "log_linear"
  | "seasonal"
  | "bollinger"
  | "ewma";

export type TrendFit = {
  model: TrendModel;
  predict: (ts: number) => number;
  bandAt?: (ts: number) => number; // optional adaptive half-band (overrides band_width)
  params: Record<string, number>;
};

const DAY = 86400000;

export function fitTrend(
  points: DataPoint[],
  model: TrendModel,
  opts?: { window?: number; alpha?: number; k?: number; period?: number },
): TrendFit {
  if (points.length === 0) return { model, predict: () => 0, params: {} };
  const sorted = [...points].sort((a, b) => a.ts - b.ts);

  if (model === "linear") {
    const n = sorted.length;
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
    return {
      model,
      predict: (ts) => intercept + slope * ((ts - x0) / DAY),
      params: { slope, intercept, x0 },
    };
  }

  if (model === "moving_avg") {
    const window = Math.max(1, Math.min(opts?.window ?? 5, sorted.length));
    return {
      model,
      predict: (ts) => {
        const upto = sorted.filter((p) => p.ts <= ts);
        const slice = upto.slice(-window);
        if (slice.length === 0) return sorted[0].value;
        return slice.reduce((a, b) => a + b.value, 0) / slice.length;
      },
      params: { window },
    };
  }

  if (model === "exponential" || model === "log_linear") {
    const x0 = sorted[0].ts;
    const ptsPos = sorted.filter((p) => p.value > 0);
    if (ptsPos.length < 2) {
      const v = sorted[sorted.length - 1].value;
      return { model, predict: () => v, params: {} };
    }
    const n = ptsPos.length;
    const xs = ptsPos.map((p) => (p.ts - x0) / DAY);
    const ys = ptsPos.map((p) => Math.log(p.value));
    const sx = xs.reduce((a, b) => a + b, 0);
    const sy = ys.reduce((a, b) => a + b, 0);
    const sxy = xs.reduce((a, _, i) => a + xs[i] * ys[i], 0);
    const sxx = xs.reduce((a, b) => a + b * b, 0);
    const denom = n * sxx - sx * sx;
    const b = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
    const a = Math.exp((sy - b * sx) / n);
    return {
      model,
      predict: (ts) => a * Math.exp(b * ((ts - x0) / DAY)),
      params: { a, b, x0 },
    };
  }

  if (model === "ewma") {
    const alpha = opts?.alpha ?? 0.2;
    // precompute series
    const series: { ts: number; ema: number }[] = [];
    let ema = sorted[0].value;
    for (const p of sorted) {
      ema = alpha * p.value + (1 - alpha) * ema;
      series.push({ ts: p.ts, ema });
    }
    return {
      model,
      predict: (ts) => {
        const upto = series.filter((s) => s.ts <= ts);
        return (upto[upto.length - 1] || series[0]).ema;
      },
      params: { alpha },
    };
  }

  if (model === "bollinger") {
    const window = Math.max(2, Math.min(opts?.window ?? 20, sorted.length));
    const k = opts?.k ?? 2;
    return {
      model,
      predict: (ts) => {
        const slice = sorted.filter((p) => p.ts <= ts).slice(-window);
        if (!slice.length) return sorted[0].value;
        const mean = slice.reduce((a, b) => a + b.value, 0) / slice.length;
        return mean;
      },
      bandAt: (ts) => {
        const slice = sorted.filter((p) => p.ts <= ts).slice(-window);
        if (slice.length < 2) return 0;
        const mean = slice.reduce((a, b) => a + b.value, 0) / slice.length;
        const v = slice.reduce((a, b) => a + (b.value - mean) ** 2, 0) / (slice.length - 1);
        return k * Math.sqrt(v);
      },
      params: { window, k },
    };
  }

  // seasonal: rolling mean + repeating residual at fixed period (in days)
  if (model === "seasonal") {
    const window = Math.max(2, Math.min(opts?.window ?? 14, sorted.length));
    const period = Math.max(1, opts?.period ?? 7); // days
    return {
      model,
      predict: (ts) => {
        const slice = sorted.filter((p) => p.ts <= ts).slice(-window);
        if (!slice.length) return sorted[0].value;
        const mean = slice.reduce((a, b) => a + b.value, 0) / slice.length;
        // crude seasonal: average residual at same phase
        const phase = Math.floor((ts / DAY)) % period;
        const samePhase = sorted.filter((p) => Math.floor(p.ts / DAY) % period === phase);
        if (!samePhase.length) return mean;
        const phaseMean = samePhase.reduce((a, b) => a + b.value, 0) / samePhase.length;
        const overall = sorted.reduce((a, b) => a + b.value, 0) / sorted.length;
        return mean + (phaseMean - overall);
      },
      params: { window, period },
    };
  }

  return { model, predict: () => sorted[sorted.length - 1].value, params: {} };
}

export function buildBandSeries(
  points: DataPoint[],
  model: TrendModel,
  bandWidth: number,
  bandIsPct: boolean,
) {
  const fit = fitTrend(points, model);
  return points
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .map((p) => {
      const trend = fit.predict(p.ts);
      const halfBand = fit.bandAt
        ? fit.bandAt(p.ts)
        : bandIsPct ? Math.abs(trend) * (bandWidth / 100) : bandWidth;
      return {
        ts: p.ts,
        value: p.value,
        trend,
        upper: trend + halfBand,
        lower: trend - halfBand,
      };
    });
}

export function distortion(actual: number, trend: number, bandWidth: number, bandIsPct: boolean): number {
  const halfBand = bandIsPct ? Math.abs(trend) * (bandWidth / 100) : bandWidth;
  if (halfBand <= 0) return 0;
  const dev = Math.abs(actual - trend);
  if (dev <= halfBand) return 0;
  return Math.min(1, (dev - halfBand) / (2 * halfBand));
}

export function ammPriceYes(reserveYes: number, reserveNo: number) {
  const total = reserveYes + reserveNo;
  if (total === 0) return 0.5;
  return reserveNo / total;
}

export function ammQuoteBuy(reserveYes: number, reserveNo: number, shares: number, side: "yes" | "no") {
  const k = reserveYes * reserveNo;
  if (side === "yes") {
    if (shares >= reserveYes) return null;
    const newYes = reserveYes - shares;
    const newNo = k / newYes;
    return newNo - reserveNo;
  } else {
    if (shares >= reserveNo) return null;
    const newNo = reserveNo - shares;
    const newYes = k / newNo;
    return newYes - reserveYes;
  }
}

export function formatNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(digits) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(digits) + "k";
  return n.toFixed(digits);
}

export const TREND_MODEL_LABELS: Record<TrendModel, { label: string; desc: string }> = {
  linear: { label: "Linear", desc: "Straight-line regression. Good for steady drift." },
  moving_avg: { label: "Moving average", desc: "Average of last N points. Smooths noise." },
  exponential: { label: "Exponential", desc: "Compounding growth (or decay)." },
  log_linear: { label: "Log-linear", desc: "Same as exponential, framed in log space." },
  ewma: { label: "EWMA", desc: "Exponentially-weighted MA. Reacts faster than plain MA." },
  bollinger: { label: "Bollinger", desc: "Adaptive band ± k·stdev. Auto-sizes elasticity." },
  seasonal: { label: "Seasonal", desc: "Repeating cycle on top of the mean (e.g. weekly)." },
};
