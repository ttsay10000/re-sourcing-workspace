import { describe, expect, it } from "vitest";
import { computeIrr } from "./irrCalculation.js";

describe("computeIrr", () => {
  it("solves a standard positive IRR", () => {
    // -1000 grows to 1331 over 3 years => exactly 10%.
    const result = computeIrr({ equityCashFlows: [-1_000, 0, 0, 1_331] });
    expect(result.irr).not.toBeNull();
    expect(result.irr!).toBeCloseTo(0.1, 6);
  });

  it("returns a negative IRR for a money-losing deal instead of null", () => {
    // Total inflows 800 on 1000 invested: real, mildly negative IRR.
    const result = computeIrr({ equityCashFlows: [-1_000, 100, 100, 600] });
    expect(result.irr).not.toBeNull();
    expect(result.irr!).toBeLessThan(0);
    expect(result.irr!).toBeCloseTo(-0.081, 2);
    expect(result.irrNullReason).toBeUndefined();
  });

  it("recovers a deeply negative IRR via bisection when Newton diverges", () => {
    // 1000 in, only 50 back in year 3: IRR = (50/1000)^(1/3) - 1 ≈ -63.2%.
    const result = computeIrr({ equityCashFlows: [-1_000, 0, 0, 50] });
    expect(result.irr).not.toBeNull();
    expect(result.irr!).toBeCloseTo(Math.cbrt(50 / 1_000) - 1, 3);
  });

  it("still reports no_sign_change when the series never turns positive", () => {
    const result = computeIrr({ equityCashFlows: [-1_000, -50, -50, 0] });
    expect(result.irr).toBeNull();
    expect(result.irrNullReason).toBe("no_sign_change");
  });
});
