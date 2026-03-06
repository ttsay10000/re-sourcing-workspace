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
 * Formula: adjusted NOI = gross rent × (1 + rent uplift) − expenses × (1 + expense uplift),
 * with management fee added to expenses (on adjusted gross). So:
 *   adjusted gross income = current gross × rentUplift
 *   current expenses = gross − NOI (implied)
 *   adjusted expenses = current expenses × expenseIncrease + management fee × adjusted gross
 *   adjusted NOI = adjusted gross − adjusted expenses
 * adjustedCapRatePct is set here as adjustedNoi / purchasePrice × 100 when price is provided.
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
  const adjustedBaseExpenses = currentExpenses * expenseIncrease;
  const managementFeeAmount = adjustedGrossIncome * managementFee;
  const adjustedExpenses = adjustedBaseExpenses + managementFeeAmount;
  const adjustedNoi = adjustedGrossIncome - adjustedExpenses;

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
