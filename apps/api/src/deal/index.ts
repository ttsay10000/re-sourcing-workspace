export { computeDealScore, type DealScoringInputs, type DealScoringResult } from "./dealScoringEngine.js";
export { computeDealSignals, type ComputeDealSignalsInput, type ComputeDealSignalsOutput } from "./computeDealSignals.js";
export { cityToArea, areaFromCanonicalAddress } from "./cityToArea.js";
export { computeMortgage, type MortgageInputs, type MortgageResult } from "./mortgageAmortization.js";
export { computeFurnishedRental, type FurnishedRentalInputs, type FurnishedRentalResult } from "./furnishedRentalEstimator.js";
export { computeIrr, type EquityReturnInputs, type IrrResult } from "./irrCalculation.js";
export {
  computeUnderwritingProjection,
  resolveDossierAssumptions,
  DEFAULT_HOLD_PERIOD_YEARS,
  type DossierAssumptionOverrides,
  type ResolvedDossierAssumptions,
  type UnderwritingProjection,
} from "./underwritingModel.js";
export {
  buildSensitivityAnalyses,
  RENTAL_UPLIFT_SENSITIVITY_VALUES,
  EXPENSE_INCREASE_SENSITIVITY_VALUES,
  MANAGEMENT_FEE_SENSITIVITY_VALUES,
  type SensitivityAnalysis,
  type SensitivityScenario,
  type SensitivityKey,
} from "./sensitivityAnalysis.js";
