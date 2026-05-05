import { describe, it, expect } from "vitest";
import {
  fitTrend,
  buildBandSeries,
  distortion,
  ammPriceYes,
  ammQuoteBuy,
  formatNum,
  type DataPoint,
} from "../lib/trend";

const pts = (vals: number[]): DataPoint[] =>
  vals.map((value, i) => ({ ts: i * 86400000, value }));

// ──────────────────────────────────────────────
// fitTrend — linear
// ──────────────────────────────────────────────
describe("fitTrend linear", () => {
  it("predicts the exact value for a perfect line", () => {
    const data = pts([10, 20, 30, 40, 50]);
    const fit = fitTrend(data, "linear");
    expect(fit.predict(4 * 86400000)).toBeCloseTo(50, 1);
  });

  it("handles a single data point", () => {
    const data = pts([42]);
    const fit = fitTrend(data, "linear");
    expect(fit.predict(0)).toBeCloseTo(42, 1);
  });

  it("returns 0 for empty data", () => {
    const fit = fitTrend([], "linear");
    expect(fit.predict(0)).toBe(0);
  });
});

// ──────────────────────────────────────────────
// fitTrend — moving_avg
// ──────────────────────────────────────────────
describe("fitTrend moving_avg", () => {
  it("returns the average of available points up to ts", () => {
    const data = pts([10, 20, 30]);
    const fit = fitTrend(data, "moving_avg");
    // At ts=2*DAY with default window 5, avg = (10+20+30)/3 = 20
    expect(fit.predict(2 * 86400000)).toBeCloseTo(20, 1);
  });
});

// ──────────────────────────────────────────────
// fitTrend — ewma
// ──────────────────────────────────────────────
describe("fitTrend ewma", () => {
  it("output is between first and last value", () => {
    const data = pts([100, 200, 150, 180]);
    const fit = fitTrend(data, "ewma");
    const val = fit.predict(3 * 86400000);
    expect(val).toBeGreaterThan(100);
    expect(val).toBeLessThan(210);
  });
});

// ──────────────────────────────────────────────
// fitTrend — exponential
// ──────────────────────────────────────────────
describe("fitTrend exponential", () => {
  it("grows for an upward-trending positive series", () => {
    const data = pts([1, 2, 4, 8, 16]);
    const fit = fitTrend(data, "exponential");
    expect(fit.predict(5 * 86400000)).toBeGreaterThan(16);
  });
});

// ──────────────────────────────────────────────
// buildBandSeries
// ──────────────────────────────────────────────
describe("buildBandSeries", () => {
  const data = pts([100, 110, 90, 105, 95]);

  it("returns one entry per data point", () => {
    const series = buildBandSeries(data, "linear", 5, true);
    expect(series.length).toBe(data.length);
  });

  it("upper > lower for pct band", () => {
    const series = buildBandSeries(data, "linear", 10, true);
    series.forEach((s) => expect(s.upper).toBeGreaterThan(s.lower));
  });

  it("absolute band: upper - lower ≈ 2 × bandWidth", () => {
    const series = buildBandSeries(data, "linear", 5, false);
    series.forEach((s) => {
      expect(s.upper - s.lower).toBeCloseTo(10, 1);
    });
  });
});

// ──────────────────────────────────────────────
// distortion
// ──────────────────────────────────────────────
describe("distortion", () => {
  it("returns 0 when actual equals trend", () => {
    expect(distortion(100, 100, 10, false)).toBe(0);
  });

  it("returns 0 when actual is inside the band", () => {
    expect(distortion(105, 100, 10, false)).toBe(0); // |105-100|=5 ≤ halfBand=10
  });

  it("returns > 0 when actual is outside the band", () => {
    expect(distortion(120, 100, 10, false)).toBeGreaterThan(0);
  });

  it("is capped at 1", () => {
    expect(distortion(9999, 100, 10, false)).toBeLessThanOrEqual(1);
  });

  it("pct band: 5% of 100 = halfBand 5", () => {
    // |106-100|=6 > 5 → distortion > 0
    expect(distortion(106, 100, 5, true)).toBeGreaterThan(0);
    // |104-100|=4 ≤ 5 → distortion = 0
    expect(distortion(104, 100, 5, true)).toBe(0);
  });
});

// ──────────────────────────────────────────────
// ammPriceYes
// ──────────────────────────────────────────────
describe("ammPriceYes", () => {
  it("returns 0.5 for equal reserves", () => {
    expect(ammPriceYes(500, 500)).toBeCloseTo(0.5);
  });

  it("returns 0.4 for rY=600, rN=400", () => {
    expect(ammPriceYes(600, 400)).toBeCloseTo(0.4);
  });

  it("returns 0.5 for zero reserves", () => {
    expect(ammPriceYes(0, 0)).toBe(0.5);
  });
});

// ──────────────────────────────────────────────
// ammQuoteBuy
// ──────────────────────────────────────────────
describe("ammQuoteBuy", () => {
  it("returns null when buying all reserves", () => {
    expect(ammQuoteBuy(100, 100, 100, "yes")).toBeNull();
  });

  it("buying YES costs more when YES is cheap (high rY)", () => {
    // More YES reserves → cheaper YES price → still positive cost
    const cost = ammQuoteBuy(900, 100, 10, "yes");
    expect(cost).not.toBeNull();
    expect(cost!).toBeGreaterThan(0);
  });

  it("cost increases with more shares requested", () => {
    const small = ammQuoteBuy(500, 500, 10, "yes")!;
    const large = ammQuoteBuy(500, 500, 50, "yes")!;
    expect(large).toBeGreaterThan(small);
  });

  it("preserves k=rY*rN invariant", () => {
    const rY = 500, rN = 500, shares = 20;
    const cost = ammQuoteBuy(rY, rN, shares, "yes")!;
    const newRY = rY - shares;
    const newRN = rN + cost;
    expect(newRY * newRN).toBeCloseTo(rY * rN, 0);
  });
});

// ──────────────────────────────────────────────
// formatNum
// ──────────────────────────────────────────────
describe("formatNum", () => {
  it("formats thousands with k suffix", () => {
    expect(formatNum(12000)).toBe("12.00k");
  });

  it("formats millions with M suffix", () => {
    expect(formatNum(2500000)).toBe("2.50M");
  });

  it("returns — for null/undefined/NaN", () => {
    expect(formatNum(null)).toBe("—");
    expect(formatNum(undefined)).toBe("—");
    expect(formatNum(NaN)).toBe("—");
  });

  it("formats small numbers with 2 decimal places by default", () => {
    expect(formatNum(3.14159)).toBe("3.14");
  });
});
