/**
 * IRR calculation: cash flows and exit → IRR, equity multiple, CoC.
 * Uses Newton-Raphson to find rate where NPV = 0.
 */

export interface IrrInputs {
  /** Initial equity (negative: outflow at t=0). */
  initialEquity: number;
  /** Annual cash flows (e.g. [cf1, cf2, ...] for years 1..n). */
  annualCashFlows: number[];
  /** Sale proceeds at exit (e.g. year n). */
  saleProceeds: number;
}

export interface IrrResult {
  /** Internal rate of return as decimal (e.g. 0.12 = 12%). */
  irr: number | null;
  /** Equity multiple = (sum of cash flows + sale proceeds) / |initialEquity|. */
  equityMultiple: number;
  /** Cash-on-cash (average annual cash flow / equity). Only for first year if single period. */
  coc: number | null;
}

function npv(rate: number, flows: number[]): number {
  let sum = 0;
  for (let t = 0; t < flows.length; t++) {
    sum += flows[t]! / Math.pow(1 + rate, t);
  }
  return sum;
}

/**
 * Compute IRR using Newton-Raphson.
 * Cash flows: t=0 = -equity; t=1..n = annual operating CF; sale is at end of year n (same period as last CF).
 */
export function computeIrr(inputs: IrrInputs): IrrResult {
  const { initialEquity, annualCashFlows, saleProceeds } = inputs;
  const equityOutflow = -Math.abs(initialEquity);
  const n = annualCashFlows.length;
  const lastCf = n > 0 ? (annualCashFlows[n - 1] ?? 0) + saleProceeds : saleProceeds;
  const flows =
    n <= 1 ? [equityOutflow, lastCf] : [equityOutflow, ...annualCashFlows.slice(0, n - 1), lastCf];
  const totalInflows = annualCashFlows.reduce((a, b) => a + b, 0) + saleProceeds;
  const equityMultiple = initialEquity !== 0 ? totalInflows / Math.abs(initialEquity) : 0;

  let rate = 0.1;
  const maxIter = 100;
  const tol = 1e-7;
  for (let i = 0; i < maxIter; i++) {
    const v = npv(rate, flows);
    if (Math.abs(v) < tol) {
      const coc =
        annualCashFlows.length > 0 && initialEquity !== 0
          ? annualCashFlows[0]! / Math.abs(initialEquity)
          : null;
      return { irr: rate, equityMultiple, coc };
    }
    const eps = 1e-8;
    const dv = (npv(rate + eps, flows) - v) / eps;
    if (Math.abs(dv) < 1e-12) break;
    rate = rate - v / dv;
    if (rate <= -1 || rate > 10) break;
  }
  const coc =
    annualCashFlows.length > 0 && initialEquity !== 0
      ? annualCashFlows[0]! / Math.abs(initialEquity)
      : null;
  return { irr: null, equityMultiple, coc };
}

/**
 * Build sale proceeds from exit NOI and exit cap rate: sale = noiExit / (exitCap/100).
 */
export function saleProceedsFromExitCap(noiExit: number, exitCapPct: number): number {
  if (exitCapPct <= 0 || noiExit < 0) return 0;
  return noiExit / (exitCapPct / 100);
}
