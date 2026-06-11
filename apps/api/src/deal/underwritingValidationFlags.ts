/**
 * Deterministic deal-level validation flags computed from the underwriting
 * projection: lender-feasibility (DSCR), exit-cap-vs-entry-cap compression,
 * tax load vs income, and agency-minimum floors. These complement the
 * OM-extraction flags in om/omValidationFlags.ts, which run before financing
 * context exists; everything here needs the resolved assumptions and the
 * projected cash flows.
 */
import type { OmValidationFlag } from "@re-sourcing/contracts";
import type { UnderwritingProjection } from "./underwritingModel.js";
import { formatPct } from "../om/omValidationFlags.js";

const FLAG_SOURCE = "underwriting_model";

/** Lenders generally size to 1.25x; below 1.0x the property cannot cover its own debt. */
export const DSCR_WARNING_FLOOR = 1.25;
export const DSCR_ERROR_FLOOR = 1.0;
/** Exit cap meaningfully below entry cap books cap-rate compression as profit. */
export const EXIT_CAP_BELOW_ENTRY_TOLERANCE_PCT = 0.25;
/** NYC class-2 multifamily tax load typically lands inside this band of gross income. */
export const TAXES_PCT_EGI_LOW = 12;
export const TAXES_PCT_EGI_HIGH = 35;
/** Agency economic-vacancy floor. */
export const ECONOMIC_VACANCY_FLOOR_PCT = 5;
/** Agency replacement-reserve convention per unit per year. */
export const RESERVES_FLOOR_PER_UNIT_ANNUAL = 250;

function formatRatio(value: number): string {
  return `${(Math.round(value * 100) / 100).toFixed(2)}x`;
}


export interface UnderwritingValidationFlagParams {
  projection: UnderwritingProjection;
  /** In-place cap rate at the modeled purchase price, in percent points. */
  entryCapRatePct: number | null;
  /** Current gross rent + other income, annual. Basis for the tax-load band. */
  egiBasisAnnual: number | null;
  /** Current annual property-tax expense resolved from the operating statement. */
  taxExpenseAnnual: number | null;
  unitCount: number | null;
}

/**
 * Build deal-level flags from a computed projection. Also folds the
 * projection's own model-shape warnings into flag form so every caveat rides
 * one structured channel.
 */
export function buildUnderwritingValidationFlags(
  params: UnderwritingValidationFlagParams
): OmValidationFlag[] {
  const { projection, entryCapRatePct, egiBasisAnnual, taxExpenseAnnual, unitCount } = params;
  const flags: OmValidationFlag[] = [];
  const assumptions = projection.assumptions;
  const holdYears = Math.max(1, Math.round(assumptions.holdPeriodYears));

  // --- DSCR floor (after reserves, matching the dossier's DSCR row) ---
  const dscrByYear: number[] = [];
  for (let year = 1; year <= holdYears; year++) {
    const debtService = projection.yearly.debtService[year] ?? 0;
    if (Math.abs(debtService) <= 0.005) continue;
    const cashFlowFromOperations = projection.yearly.cashFlowFromOperations[year] ?? 0;
    dscrByYear.push(cashFlowFromOperations / debtService);
  }
  if (dscrByYear.length > 0) {
    const minDscr = Math.min(...dscrByYear);
    if (minDscr < DSCR_ERROR_FLOOR) {
      flags.push({
        flagType: "dscr_below_floor",
        field: "dscr",
        severity: "error",
        brokerValue: minDscr,
        externalValue: DSCR_WARNING_FLOOR,
        message: `Minimum DSCR over the hold is ${formatRatio(minDscr)} — operating cash flow does not cover debt service (negative leverage). Lenders typically require ${formatRatio(DSCR_WARNING_FLOOR)}.`,
        source: FLAG_SOURCE,
      });
    } else if (minDscr < DSCR_WARNING_FLOOR) {
      flags.push({
        flagType: "dscr_below_floor",
        field: "dscr",
        severity: "warning",
        brokerValue: minDscr,
        externalValue: DSCR_WARNING_FLOOR,
        message: `Minimum DSCR over the hold is ${formatRatio(minDscr)}, below the ${formatRatio(DSCR_WARNING_FLOOR)} most lenders size to — expect a smaller loan or more equity.`,
        source: FLAG_SOURCE,
      });
    }
  }

  // --- Exit cap below entry cap (returns driven by assumed compression) ---
  const exitCapPct = assumptions.exit.exitCapPct;
  if (
    entryCapRatePct != null &&
    Number.isFinite(entryCapRatePct) &&
    entryCapRatePct > 0 &&
    Number.isFinite(exitCapPct) &&
    exitCapPct > 0 &&
    exitCapPct < entryCapRatePct - EXIT_CAP_BELOW_ENTRY_TOLERANCE_PCT
  ) {
    flags.push({
      flagType: "exit_cap_below_entry",
      field: "exitCapPct",
      severity: "warning",
      brokerValue: exitCapPct,
      externalValue: entryCapRatePct,
      message: `Exit cap (${formatPct(exitCapPct)}) is below the going-in cap (${formatPct(entryCapRatePct)}); the model is booking cap-rate compression as profit. Underwrite exit at or above entry unless there is a specific repositioning story.`,
      source: FLAG_SOURCE,
    });
  }

  // --- Tax load vs income ---
  if (
    taxExpenseAnnual != null &&
    taxExpenseAnnual > 0 &&
    egiBasisAnnual != null &&
    egiBasisAnnual > 0
  ) {
    const taxesPctEgi = (taxExpenseAnnual / egiBasisAnnual) * 100;
    if (taxesPctEgi > TAXES_PCT_EGI_HIGH) {
      flags.push({
        flagType: "taxes_pct_egi_outlier",
        field: "taxes",
        severity: "warning",
        brokerValue: taxesPctEgi,
        externalValue: TAXES_PCT_EGI_HIGH,
        message: `Property taxes are ${formatPct(taxesPctEgi)} of gross income (NYC multifamily typically ${TAXES_PCT_EGI_LOW}–${TAXES_PCT_EGI_HIGH}%) — heavy tax load; check assessment trajectory and any pending tax certiorari.`,
        source: FLAG_SOURCE,
      });
    } else if (taxesPctEgi < TAXES_PCT_EGI_LOW) {
      flags.push({
        flagType: "taxes_pct_egi_outlier",
        field: "taxes",
        severity: "warning",
        brokerValue: taxesPctEgi,
        externalValue: TAXES_PCT_EGI_LOW,
        message: `Property taxes are only ${formatPct(taxesPctEgi)} of gross income (NYC multifamily typically ${TAXES_PCT_EGI_LOW}–${TAXES_PCT_EGI_HIGH}%) — verify against the DOF tax bill; the OM may show abated, capped, or stale taxes.`,
        source: FLAG_SOURCE,
      });
    }
  }

  // --- Agency floors ---
  const vacancyPct = assumptions.operating.vacancyPct;
  if (Number.isFinite(vacancyPct) && vacancyPct < ECONOMIC_VACANCY_FLOOR_PCT) {
    flags.push({
      flagType: "vacancy_below_floor",
      field: "vacancyPct",
      severity: "info",
      brokerValue: vacancyPct,
      externalValue: ECONOMIC_VACANCY_FLOOR_PCT,
      message: `Underwritten vacancy (${formatPct(vacancyPct)}) is below the ${ECONOMIC_VACANCY_FLOOR_PCT}% economic-vacancy floor agency lenders apply.`,
      source: FLAG_SOURCE,
    });
  }
  if (unitCount != null && unitCount > 0) {
    const reservesPerUnit = Math.max(0, assumptions.operating.recurringCapexAnnual) / unitCount;
    if (reservesPerUnit < RESERVES_FLOOR_PER_UNIT_ANNUAL) {
      flags.push({
        flagType: "reserves_below_floor",
        field: "recurringCapexAnnual",
        severity: "info",
        brokerValue: reservesPerUnit,
        externalValue: RESERVES_FLOOR_PER_UNIT_ANNUAL,
        message: `Replacement reserves of $${Math.round(reservesPerUnit).toLocaleString("en-US")}/unit/yr are below the $${RESERVES_FLOOR_PER_UNIT_ANNUAL}/unit/yr agency convention.`,
        source: FLAG_SOURCE,
      });
    }
  }

  // --- Model-shape warnings from the projection itself ---
  for (const warning of projection.warnings) {
    flags.push({
      flagType: warning.code,
      severity: "warning",
      message: warning.message,
      source: FLAG_SOURCE,
    });
  }

  return flags;
}
