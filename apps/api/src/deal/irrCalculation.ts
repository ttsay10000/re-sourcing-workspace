/** Return metric helpers for the equity cash flow series. */

export interface EquityReturnInputs {
  /** Full equity cash flow series, including year 0 negative equity and final-year sale proceeds. */
  equityCashFlows: number[];
  /** Operating cash flows only, excluding sale proceeds, for cash-on-cash calculations. */
  operatingCashFlows?: number[];
}

export interface IrrResult {
  /** Internal rate of return as decimal (e.g. 0.12 = 12%). */
  irr: number | null;
  /** Equity multiple = total positive cash received / |year 0 equity|. */
  equityMultiple: number;
  /** Year 1 cash-on-cash return. */
  year1CashOnCashReturn: number | null;
  /** Average annual cash-on-cash return across operating years. */
  averageCashOnCashReturn: number | null;
}

function npv(rate: number, flows: number[]): number {
  let sum = 0;
  for (let t = 0; t < flows.length; t++) {
    sum += flows[t]! / Math.pow(1 + rate, t);
  }
  return sum;
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
  return {
    irr: null,
    equityMultiple,
    year1CashOnCashReturn,
    averageCashOnCashReturn,
  };
}
