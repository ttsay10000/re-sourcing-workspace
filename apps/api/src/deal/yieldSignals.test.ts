import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_MTR_SPREAD_PCT_POINTS,
  DEFAULT_MIN_BROKER_CAP_DELTA_PCT_POINTS,
  DEFAULT_MIN_MTR_SPREAD_PCT_POINTS,
  computeBrokerYieldComparison,
  computeYieldSignals,
  resolveMaxPlausibleMtrSpreadPctPoints,
  resolveMinBrokerCapDeltaPctPoints,
  resolveMinHealthyMtrSpreadPctPoints,
} from "./yieldSignals.js";

afterEach(() => {
  delete process.env.MTR_MIN_YIELD_SPREAD_PCT;
  delete process.env.MTR_MAX_YIELD_SPREAD_PCT;
  delete process.env.BROKER_CAP_MIN_DELTA_PCT;
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

  it("flags an implausibly large spread as a data outlier", () => {
    // Mirrors the 219-221 E 59th double-pulled rent roll: LTR 5.9%, MTR 14.6%.
    const signals = computeYieldSignals({ ltrYieldPct: 5.9, mtrYieldPct: 14.6 });
    expect(signals.spreadPctPoints).toBeCloseTo(8.7, 6);
    expect(signals.calloutCode).toBe("mtr_spread_outlier");
    expect(signals.calloutLabel).toContain("double-counted rent roll");
  });

  it("treats a spread exactly at the plausibility ceiling as healthy", () => {
    const signals = computeYieldSignals({
      ltrYieldPct: 5.0,
      mtrYieldPct: 5.0 + DEFAULT_MAX_MTR_SPREAD_PCT_POINTS,
    });
    expect(signals.calloutCode).toBeNull();
  });

  it("honors the implausible-spread env override and explicit param", () => {
    process.env.MTR_MAX_YIELD_SPREAD_PCT = "10";
    expect(resolveMaxPlausibleMtrSpreadPctPoints()).toBe(10);
    expect(computeYieldSignals({ ltrYieldPct: 5.9, mtrYieldPct: 14.6 }).calloutCode).toBeNull();

    process.env.MTR_MAX_YIELD_SPREAD_PCT = "not-a-number";
    expect(resolveMaxPlausibleMtrSpreadPctPoints()).toBe(DEFAULT_MAX_MTR_SPREAD_PCT_POINTS);

    const strict = computeYieldSignals({ ltrYieldPct: 5, mtrYieldPct: 8, maxSpreadPctPoints: 2.5 });
    expect(strict.calloutCode).toBe("mtr_spread_outlier");
  });
});

describe("computeBrokerYieldComparison", () => {
  it("flags a broker NOI that nets out vacancy below the reconstructed basis", () => {
    // Mirrors 219-221 E 59th: rent 1,009,922 − expenses 241,672 = 768,250 basis,
    // broker NOI 737,952 after a ~3% vacancy allowance, ask $12.5M.
    const comparison = computeBrokerYieldComparison({
      brokerNoi: 737_952,
      reconstructedNoi: 768_250,
      purchasePrice: 12_500_000,
    });
    expect(comparison.brokerCapRatePct).toBeCloseTo(5.9, 1);
    expect(comparison.brokerCapRateSource).toBe("implied_from_broker_noi");
    expect(comparison.reconstructedCapRatePct).toBeCloseTo(6.146, 3);
    expect(comparison.deltaPctPoints).toBeCloseTo(-0.2424, 3);
    expect(comparison.calloutCode).toBe("broker_cap_below_reconstructed");
    expect(comparison.calloutLabel).toContain("below");
    expect(comparison.calloutLabel).toContain("reconstructed");
  });

  it("flags an OM-stated cap rate built on pro forma rents above the reconstructed basis", () => {
    const comparison = computeBrokerYieldComparison({
      brokerNoi: 800_000,
      brokerStatedCapRatePct: 7.2,
      reconstructedNoi: 768_250,
      purchasePrice: 12_500_000,
    });
    expect(comparison.brokerCapRatePct).toBe(7.2);
    expect(comparison.brokerCapRateSource).toBe("om_stated");
    expect(comparison.calloutCode).toBe("broker_cap_above_reconstructed");
    expect(comparison.calloutLabel).toContain("pro forma");
  });

  it("stays quiet when broker and reconstructed yields agree within the threshold", () => {
    const comparison = computeBrokerYieldComparison({
      brokerNoi: 768_000,
      reconstructedNoi: 768_250,
      purchasePrice: 12_500_000,
    });
    expect(comparison.deltaPctPoints).not.toBeNull();
    expect(comparison.calloutCode).toBeNull();
    expect(comparison.calloutLabel).toBeNull();
  });

  it("returns nulls without a callout when price or either NOI is missing", () => {
    expect(
      computeBrokerYieldComparison({ brokerNoi: 700_000, reconstructedNoi: 750_000, purchasePrice: null })
        .calloutCode
    ).toBeNull();
    expect(
      computeBrokerYieldComparison({ brokerNoi: null, reconstructedNoi: 750_000, purchasePrice: 10_000_000 })
        .calloutCode
    ).toBeNull();
    expect(
      computeBrokerYieldComparison({ brokerNoi: 700_000, reconstructedNoi: null, purchasePrice: 10_000_000 })
        .calloutCode
    ).toBeNull();
  });

  it("honors an explicit threshold and the env override", () => {
    const relaxed = computeBrokerYieldComparison({
      brokerNoi: 700_000,
      reconstructedNoi: 750_000,
      purchasePrice: 10_000_000,
      minDeltaPctPoints: 1,
    });
    expect(relaxed.calloutCode).toBeNull();

    process.env.BROKER_CAP_MIN_DELTA_PCT = "2";
    expect(resolveMinBrokerCapDeltaPctPoints()).toBe(2);
    process.env.BROKER_CAP_MIN_DELTA_PCT = "not-a-number";
    expect(resolveMinBrokerCapDeltaPctPoints()).toBe(DEFAULT_MIN_BROKER_CAP_DELTA_PCT_POINTS);
  });
});
