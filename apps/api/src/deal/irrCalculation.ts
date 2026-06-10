/** Return metric helpers for the equity cash flow series. */

export interface EquityReturnInputs {
  /** Full equity cash flow series, including year 0 negative equity and final-year sale proceeds. */
  equityCashFlows: number[];
  /** Pretax periodic cash flows, excluding sale proceeds, for cash-on-cash calculations. */
  operatingCashFlows?: number[];
}

export type IrrNullReason = "no_sign_change" | "did_not_converge";

export interface IrrResult {
  /** Internal rate of return as decimal (e.g. 0.12 = 12%). */
  irr: number | null;
  /** Why irr is null, when it is. */
  irrNullReason?: IrrNullReason;
  /** Equity multiple = total positive cash received / |year 0 equity|. */
  equityMultiple: number;
  /** Year 1 cash-on-cash return. */
  year1CashOnCashReturn: number | null;
  /** Average annual cash-on-cash return across operating years. */
  averageCashOnCashReturn: number | null;
}

/**
 * Persisted return metrics (deal_signals.irr_pct/coc_pct, dossier summary irrPct/cocPct)
 * hold decimal rates (0.12 = 12%) despite the Pct suffix. UI surfaces render percent
 * points, so convert at the API read boundary. Values above 1.5 are assumed to already
 * be percent points (a 150%+ return is implausible; this guards odd legacy rows).
 */
export function returnRateToPctPoints(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.abs(value) > 1.5 ? value : value * 100;
}

function npv(rate: number, flows: number[]): number {
  let sum = 0;
  for (let t = 0; t < flows.length; t++) {
    sum += flows[t]! / Math.pow(1 + rate, t);
  }
  return sum;
}

/**
 * Bisection fallback for when Newton-Raphson diverges (typically deeply
 * negative IRRs, where the year-0 flow dominates and Newton overshoots past
 * rate = -1). Scans a rate grid for an NPV sign change, then bisects.
 */
function solveIrrByBisection(flows: number[]): number | null {
  const grid: number[] = [];
  for (let rate = -0.99; rate < -0.5; rate += 0.01) grid.push(rate);
  for (let rate = -0.5; rate < 1; rate += 0.025) grid.push(rate);
  for (let rate = 1; rate <= 10; rate += 0.25) grid.push(rate);

  let lo: number | null = null;
  let hi: number | null = null;
  let prevRate = grid[0]!;
  let prevNpv = npv(prevRate, flows);
  for (let i = 1; i < grid.length; i++) {
    const rate = grid[i]!;
    const value = npv(rate, flows);
    if (Number.isFinite(prevNpv) && Number.isFinite(value) && prevNpv * value <= 0) {
      lo = prevRate;
      hi = rate;
      break;
    }
    prevRate = rate;
    prevNpv = value;
  }
  if (lo == null || hi == null) return null;

  let low: number = lo;
  let high: number = hi;
  let lowNpv = npv(low, flows);
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const midNpv = npv(mid, flows);
    if (Math.abs(midNpv) < 1e-7 || (high - low) / 2 < 1e-9) return mid;
    if (lowNpv * midNpv <= 0) {
      high = mid;
    } else {
      low = mid;
      lowNpv = midNpv;
    }
  }
  return (low + high) / 2;
}

/**
 * Compute IRR using Newton-Raphson over the supplied equity cash flow series.
 */
export function computeIrr(inputs: EquityReturnInputs): IrrResult {
  const { equityCashFlows, operatingCashFlows } = inputs;
  const flows = equityCashFlows.map((value) => (Number.isFinite(value) ? value : 0));
  const initialEquity = Math.abs(flows[0] ?? 0);
  const operatingFlows = (operatingCashFlows ?? flows.slice(1)).map((value) => (Number.isFinite(value) ? value : 0));
  const annualCashFlows = flows.slice(1);
  const totalInflows = annualCashFlows.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const equityMultiple = initialEquity !== 0 ? totalInflows / initialEquity : 0;
  const year1CashOnCashReturn =
    operatingFlows.length > 0 && initialEquity !== 0 ? operatingFlows[0]! / initialEquity : null;
  const averageCashOnCashReturn =
    operatingFlows.length > 0 && initialEquity !== 0
      ? operatingFlows.reduce((sum, value) => sum + value, 0) / operatingFlows.length / initialEquity
      : null;

  // IRR only exists when the series changes sign (money out, then money in).
  const hasNegative = flows.some((value) => value < 0);
  const hasPositive = flows.some((value) => value > 0);
  if (!hasNegative || !hasPositive) {
    return {
      irr: null,
      irrNullReason: "no_sign_change",
      equityMultiple,
      year1CashOnCashReturn,
      averageCashOnCashReturn,
    };
  }

  let rate = 0.1;
  const maxIter = 100;
  const tol = 1e-7;
  for (let i = 0; i < maxIter; i++) {
    const v = npv(rate, flows);
    if (Math.abs(v) < tol) {
      return {
        irr: rate,
        equityMultiple,
        year1CashOnCashReturn,
        averageCashOnCashReturn,
      };
    }
    const eps = 1e-8;
    const dv = (npv(rate + eps, flows) - v) / eps;
    if (Math.abs(dv) < 1e-12) break;
    rate = rate - v / dv;
    if (rate <= -1 || rate > 10) break;
  }

  // Newton diverged; money-losing deals have real (negative) IRRs that should
  // render as numbers rather than null.
  const bisected = solveIrrByBisection(flows);
  if (bisected != null) {
    return {
      irr: bisected,
      equityMultiple,
      year1CashOnCashReturn,
      averageCashOnCashReturn,
    };
  }
  return {
    irr: null,
    irrNullReason: "did_not_converge",
    equityMultiple,
    year1CashOnCashReturn,
    averageCashOnCashReturn,
  };
}
