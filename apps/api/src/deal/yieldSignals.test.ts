import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MIN_MTR_SPREAD_PCT_POINTS,
  computeYieldSignals,
  resolveMinHealthyMtrSpreadPctPoints,
} from "./yieldSignals.js";

afterEach(() => {
  delete process.env.MTR_MIN_YIELD_SPREAD_PCT;
});

describe("computeYieldSignals", () => {
  it("returns no callout when MTR comfortably beats LTR", () => {
    const signals = computeYieldSignals({ ltrYieldPct: 5.0, mtrYieldPct: 6.5 });
    expect(signals.spreadPctPoints).toBeCloseTo(1.5, 6);
    expect(signals.calloutCode).toBeNull();
    expect(signals.calloutLabel).toBeNull();
  });

  it("flags MTR below LTR and recommends sourcing as LTR", () => {
    const signals = computeYieldSignals({ ltrYieldPct: 5.6, mtrYieldPct: 5.1 });
    expect(signals.spreadPctPoints).toBeCloseTo(-0.5, 6);
    expect(signals.calloutCode).toBe("mtr_below_ltr");
    expect(signals.calloutLabel).toContain("below the LTR yield");
    expect(signals.calloutLabel).toContain("LTR deal");
  });

  it("flags a weak MTR bump under the default threshold", () => {
    const signals = computeYieldSignals({ ltrYieldPct: 5.0, mtrYieldPct: 5.4 });
    expect(signals.spreadPctPoints).toBeCloseTo(0.4, 6);
    expect(signals.calloutCode).toBe("mtr_weak_uplift");
    expect(signals.calloutLabel).toContain("+0.4pt");
  });

  it("treats a spread exactly at the threshold as healthy", () => {
    const signals = computeYieldSignals({
      ltrYieldPct: 5.0,
      mtrYieldPct: 5.0 + DEFAULT_MIN_MTR_SPREAD_PCT_POINTS,
    });
    expect(signals.calloutCode).toBeNull();
  });

  it("returns nulls without a callout when either yield is missing", () => {
    expect(computeYieldSignals({ ltrYieldPct: null, mtrYieldPct: 6 }).calloutCode).toBeNull();
    expect(computeYieldSignals({ ltrYieldPct: 6, mtrYieldPct: null }).spreadPctPoints).toBeNull();
    expect(computeYieldSignals({ ltrYieldPct: Number.NaN, mtrYieldPct: 6 }).ltrYieldPct).toBeNull();
  });

  it("honors an explicit threshold and the env override", () => {
    const strict = computeYieldSignals({ ltrYieldPct: 5, mtrYieldPct: 6, minSpreadPctPoints: 1.5 });
    expect(strict.calloutCode).toBe("mtr_weak_uplift");

    process.env.MTR_MIN_YIELD_SPREAD_PCT = "0.25";
    expect(resolveMinHealthyMtrSpreadPctPoints()).toBe(0.25);
    const relaxed = computeYieldSignals({ ltrYieldPct: 5, mtrYieldPct: 5.4 });
    expect(relaxed.calloutCode).toBeNull();

    process.env.MTR_MIN_YIELD_SPREAD_PCT = "not-a-number";
    expect(resolveMinHealthyMtrSpreadPctPoints()).toBe(DEFAULT_MIN_MTR_SPREAD_PCT_POINTS);
  });
});
