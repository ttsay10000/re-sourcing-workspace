/**
 * Furnished rental estimator: adjust rents by uplift, apply expense increase and management fee,
 * output adjusted NOI and adjusted cap rate.
 *
 * When using profile defaults: profile stores percentages (e.g. 15, 2, 5). Convert to:
 * rentUplift = 1 + defaultRentUplift/100, expenseIncrease = 1 + defaultExpenseIncrease/100,
 * managementFee = defaultManagementFee/100.
 */

export interface FurnishedRentalInputs {
  /** Current gross rent (annual). */
  currentGrossRent: number;
  /** Current NOI (annual). */
  currentNoi: number;
  /** Rent uplift multiplier (e.g. 1.15 = 15% upside). */
  rentUplift: number;
  /** Expense increase multiplier (e.g. 1.02 = 2% increase). */
  expenseIncrease?: number;
  /** Management fee as decimal of gross income (e.g. 0.05 = 5%). */
  managementFee?: number;
}

export interface FurnishedRentalResult {
  /** Adjusted gross income (current gross * rent uplift). */
  adjustedGrossIncome: number;
  /** Current expenses implied (gross - NOI). */
  currentExpenses: number;
  /** Adjusted expenses (current * expense increase) + management fee on adjusted gross. */
  adjustedExpenses: number;
  /** Adjusted NOI. */
  adjustedNoi: number;
  /** Adjusted cap rate = adjusted NOI / purchase price (caller provides price). */
  adjustedCapRatePct: number | null;
}

/**
 * Compute adjusted revenue and expenses for furnished rental scenario.
 *
 * Adjusted NOI formula (from assumptions: rental uplift, expense uplift, management fee %):
 *   adjusted NOI = (gross rents × rental uplift) − (expenses × expense uplift) − (management fee % × gross rents × rental uplift)
 *
 * So:
 *   adjusted gross income = current gross × rentUplift
 *   current expenses = gross − NOI (implied)
 *   adjusted NOI = adjusted gross − (expenses × expenseIncrease) − (managementFee × adjusted gross)
 * adjustedCapRatePct = adjustedNoi / purchasePrice × 100 when price is provided.
 */
export function computeFurnishedRental(inputs: FurnishedRentalInputs, purchasePrice: number | null): FurnishedRentalResult {
  const {
    currentGrossRent,
    currentNoi,
    rentUplift,
    expenseIncrease = 1,
    managementFee = 0,
  } = inputs;

  const uplift = Math.max(0, rentUplift);
  const adjustedGrossIncome = currentGrossRent * uplift;
  const currentExpenses = Math.max(0, currentGrossRent - currentNoi);
  const adjustedExpensesOnly = currentExpenses * expenseIncrease;
  const managementFeeAmount = managementFee * adjustedGrossIncome;
  const adjustedNoi = adjustedGrossIncome - adjustedExpensesOnly - managementFeeAmount;
  const adjustedExpenses = adjustedExpensesOnly + managementFeeAmount;

  const adjustedCapRatePct =
    purchasePrice != null && purchasePrice > 0 ? (adjustedNoi / purchasePrice) * 100 : null;

  return {
    adjustedGrossIncome,
    currentExpenses,
    adjustedExpenses,
    adjustedNoi,
    adjustedCapRatePct,
  };
}
