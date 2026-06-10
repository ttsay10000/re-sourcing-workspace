import { describe, expect, it } from "vitest";
import { resolveOperatingYield, sanitizeRatePct } from "./operatingYield.js";

describe("resolveOperatingYield", () => {
  it("uses a positive stored signal as-is", () => {
    const result = resolveOperatingYield({ signalLtrPct: 5.82, fallbackNoi: null, fallbackAsk: null });
    expect(result).toEqual({ ltrYieldPct: 5.82, yieldSource: "signal", flag: null, flagDetail: null });
  });

  it("falls through a 0% stored signal to a valid derived yield instead of reporting 0", () => {
    const result = resolveOperatingYield({ signalLtrPct: 0, fallbackNoi: 240_000, fallbackAsk: 4_000_000 });
    expect(result.ltrYieldPct).toBeCloseTo(6, 5);
    expect(result.yieldSource).toBe("derived");
    expect(result.flag).toBeNull();
  });

  it("flags zero_noi when the extraction chain produced a $0 NOI", () => {
    const result = resolveOperatingYield({ signalLtrPct: null, fallbackNoi: 0, fallbackAsk: 4_000_000 });
    expect(result.ltrYieldPct).toBeNull();
    expect(result.flag).toBe("zero_noi");
    expect(result.flagDetail).toContain("NOI is $0");
  });

  it("flags zero_cap_signal when only a 0% stored signal exists", () => {
    const result = resolveOperatingYield({ signalLtrPct: 0, fallbackNoi: null, fallbackAsk: null });
    expect(result.ltrYieldPct).toBeNull();
    expect(result.flag).toBe("zero_cap_signal");
  });

  it("flags negative yields rather than charting them", () => {
    const result = resolveOperatingYield({ signalLtrPct: null, fallbackNoi: -50_000, fallbackAsk: 1_000_000 });
    expect(result.ltrYieldPct).toBeNull();
    expect(result.flag).toBe("negative_yield");
  });

  it("returns an unflagged empty result when no inputs exist", () => {
    const result = resolveOperatingYield({ signalLtrPct: null, fallbackNoi: null, fallbackAsk: null });
    expect(result).toEqual({ ltrYieldPct: null, yieldSource: null, flag: null, flagDetail: null });
  });

  it("sanitizeRatePct nulls zero and negative rates", () => {
    expect(sanitizeRatePct(4.2)).toBe(4.2);
    expect(sanitizeRatePct(0)).toBeNull();
    expect(sanitizeRatePct(-1)).toBeNull();
    expect(sanitizeRatePct(null)).toBeNull();
  });
});
