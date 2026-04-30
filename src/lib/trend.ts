// Trend fitting + elastic-band math. Pure functions, used by UI and bot.

export type DataPoint = { ts: number; value: number }; // ts in ms
export type TrendModel = "linear" | "moving_avg" | "exponential";

export type TrendFit = {
  model: TrendModel;
  // returns predicted value at timestamp ms
  predict: (ts: number) => number;
  params: Record<string, number>;
};

export function fitTrend(points: DataPoint[], model: TrendModel, opts?: { window?: number }): TrendFit {
  if (points.length === 0) {
    return { model, predict: () => 0, params: {} };
  }
  const sorted = [...points].sort((a, b) => a.ts - b.ts);

  if (model === "linear") {
    const n = sorted.length;
    const x0 = sorted[0].ts;
    const xs = sorted.map((p) => (p.ts - x0) / 86400000); // days
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
      predict: (ts) => intercept + slope * ((ts - x0) / 86400000),
      params: { slope, intercept, x0 },
    };
  }

  if (model === "moving_avg") {
    const window = Math.max(1, Math.min(opts?.window ?? 5, sorted.length));
    return {
      model,
      predict: (ts) => {
        // average of last `window` points up to ts
        const upto = sorted.filter((p) => p.ts <= ts);
        const slice = upto.slice(-window);
        if (slice.length === 0) return sorted[0].value;
        return slice.reduce((a, b) => a + b.value, 0) / slice.length;
      },
      params: { window },
    };
  }

  // exponential: y = a * exp(b * x), fit log-linear
  const x0 = sorted[0].ts;
  const ptsPos = sorted.filter((p) => p.value > 0);
  if (ptsPos.length < 2) {
    const v = sorted[sorted.length - 1].value;
    return { model, predict: () => v, params: {} };
  }
  const n = ptsPos.length;
  const xs = ptsPos.map((p) => (p.ts - x0) / 86400000);
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
    predict: (ts) => a * Math.exp(b * ((ts - x0) / 86400000)),
    params: { a, b, x0 },
  };
}

// Build the chart series: {ts, value, trend, upper, lower}
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
      const halfBand = bandIsPct ? Math.abs(trend) * (bandWidth / 100) : bandWidth;
      return {
        ts: p.ts,
        value: p.value,
        trend,
        upper: trend + halfBand,
        lower: trend - halfBand,
      };
    });
}

// Distortion in [0, 1] — 0 inside band, 1 stretched 2x band beyond
export function distortion(actual: number, trend: number, bandWidth: number, bandIsPct: boolean): number {
  const halfBand = bandIsPct ? Math.abs(trend) * (bandWidth / 100) : bandWidth;
  if (halfBand <= 0) return 0;
  const dev = Math.abs(actual - trend);
  if (dev <= halfBand) return 0;
  return Math.min(1, (dev - halfBand) / (2 * halfBand));
}

// AMM helpers (mirror server function)
export function ammPriceYes(reserveYes: number, reserveNo: number) {
  // probability YES ≈ reserve_no / (reserve_yes + reserve_no)
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
    return newNo - reserveNo; // cost
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
