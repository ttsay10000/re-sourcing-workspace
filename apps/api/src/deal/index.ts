export { computeDealScore, type DealScoringInputs, type DealScoringResult } from "./dealScoringEngine.js";
export { computeDealSignals, type ComputeDealSignalsInput, type ComputeDealSignalsOutput } from "./computeDealSignals.js";
export { cityToArea, areaFromCanonicalAddress } from "./cityToArea.js";
export { computeMortgage, type MortgageInputs, type MortgageResult } from "./mortgageAmortization.js";
export { computeFurnishedRental, type FurnishedRentalInputs, type FurnishedRentalResult } from "./furnishedRentalEstimator.js";
export { computeIrr, type EquityReturnInputs, type IrrResult } from "./irrCalculation.js";
export {
  computeRecommendedOffer,
  DEFAULT_AMORTIZATION_YEARS,
  DEFAULT_EXIT_CAP_PCT,
  DEFAULT_EXIT_CLOSING_COST_PCT,
  DEFAULT_EXPENSE_INCREASE_PCT,
  computeUnderwritingProjection,
  DEFAULT_INTEREST_RATE_PCT,
  DEFAULT_LTV_PCT,
  DEFAULT_MANAGEMENT_FEE_PCT,
  DEFAULT_PURCHASE_CLOSING_COST_PCT,
  DEFAULT_RENT_UPLIFT_PCT,
  DEFAULT_TARGET_IRR_PCT,
  resolveDossierAssumptions,
  DEFAULT_HOLD_PERIOD_YEARS,
  type DossierAssumptionOverrides,
  type RecommendedOfferAnalysis,
  type ResolvedDossierAssumptions,
  type UnderwritingProjection,
} from "./underwritingModel.js";
export {
  buildSensitivityAnalyses,
  RENTAL_UPLIFT_SENSITIVITY_VALUES,
  MANAGEMENT_FEE_SENSITIVITY_VALUES,
  type SensitivityAnalysis,
  type SensitivityScenario,
  type SensitivityKey,
} from "./sensitivityAnalysis.js";
