/**
 * Mortgage amortization: P, r, n → monthly payment, annual debt service, balance schedule.
 * Profile stores defaultInterestRate as percent (e.g. 6.5); pass annualRate = value / 100.
 */

export interface MortgageInputs {
  /** Loan principal. */
  principal: number;
  /** Annual interest rate as decimal (e.g. 0.065 for 6.5%). */
  annualRate: number;
  /** Amortization period in years. */
  amortizationYears: number;
}

export interface MortgageResult {
  /** Monthly payment. */
  monthlyPayment: number;
  /** Annual debt service (monthly * 12). */
  annualDebtService: number;
  /** Total payments over full amortization. */
  totalPayments: number;
  /** Total interest over full amortization. */
  totalInterest: number;
}

/**
 * Compute monthly payment: P * (r * (1+r)^n) / ((1+r)^n - 1)
 * where r = monthly rate, n = number of months.
 */
export function computeMortgage(inputs: MortgageInputs): MortgageResult {
  const { principal, annualRate, amortizationYears } = inputs;
  if (principal <= 0 || amortizationYears <= 0) {
    return { monthlyPayment: 0, annualDebtService: 0, totalPayments: 0, totalInterest: 0 };
  }
  const monthlyRate = Math.max(0, annualRate) / 12;
  const numMonths = amortizationYears * 12;
  const payment =
    monthlyRate <= 0
      ? principal / numMonths
      : (principal * (monthlyRate * Math.pow(1 + monthlyRate, numMonths))) /
        (Math.pow(1 + monthlyRate, numMonths) - 1);
  const monthlyPayment = Math.round(payment * 100) / 100;
  const annualDebtService = monthlyPayment * 12;
  const totalPayments = monthlyPayment * numMonths;
  const totalInterest = totalPayments - principal;
  return {
    monthlyPayment,
    annualDebtService,
    totalPayments,
    totalInterest,
  };
}
