import type {
  ExpenseLineItem,
  OmRentRollRow,
  PropertyDealDossierExpenseModelRow,
  PropertyDealDossierExpenseTreatment,
  PropertyDealDossierUnitModelRow,
  PropertyDetails,
} from "@re-sourcing/contracts";
import {
  resolvePreferredOmExpenseTable,
  resolvePreferredOmExpenseTotal,
  resolvePreferredOmRentRoll,
} from "../om/authoritativeOm.js";
import { resolveCurrentFinancialsFromDetails } from "../rental/currentFinancials.js";
import { isManagementFeeExpenseLine } from "./underwritingModel.js";

const COMMERCIAL_PATTERN =
  /\b(commercial|retail|office|storefront|store front|restaurant|cafe|gallery|medical|community facility)\b/i;
const RENT_STABILIZED_PATTERN = /(rent[\s-]*(?:stabilized|stabilised|controlled?)|\bRS\b)/i;
const ANCILLARY_SPACE_PATTERN = /\b(basement|cellar|storage|mechanical|boiler|laundry|garage|parking)\b/i;
const RESIDENTIAL_PATTERN = /\b(residential|apt|apartment|duplex|bed(?:room)?|bath|garden level|parlor|floor-through)\b/i;
const VACANT_LIKE_PATTERN = /\b(vacant|delivered vacant|available|owner[\s-]*occupied|owner occupied|owner's unit)\b/i;

const DEFAULT_FURNISHING_BASE_PER_UNIT = 8_000;
const DEFAULT_FURNISHING_BEDROOM_COST = 1_000;
const DEFAULT_FURNISHING_BATHROOM_COST = 750;
const DEFAULT_FURNISHING_BEDROOMS_PER_UNIT = 1;
const DEFAULT_FURNISHING_BATHS_PER_UNIT = 1;
const DEFAULT_FURNISHING_UNIT_SQFT = 900;
const MAX_FURNISHING_COST_PER_UNIT = 30_000;
const DEFAULT_ASSUMED_LTR_OCCUPANCY_PCT = 97;

export interface ResolvedUnitModelRow extends PropertyDealDossierUnitModelRow {
  rowId: string;
  unitLabel: string;
  currentAnnualRent: number | null;
  underwrittenAnnualRent: number | null;
  rentUpliftPct: number | null;
  occupancyPct: number | null;
  furnishingCost: number | null;
  onboardingFee: number | null;
  monthlyHospitalityExpense: number | null;
  includeInUnderwriting: boolean;
  isProtected: boolean;
  isCommercial: boolean;
  isRentStabilized: boolean;
  isVacantLike: boolean;
  modeledAnnualRent: number | null;
  defaultProjectedAnnualRent: number | null;
}

export interface ResolvedExpenseModelRow extends PropertyDealDossierExpenseModelRow {
  rowId: string;
  lineItem: string;
  amount: number | null;
  annualGrowthPct: number | null;
  treatment: PropertyDealDossierExpenseTreatment;
  isManagementLine: boolean;
}

export interface ResolvedDetailedCashFlowModel {
  unitModelRows: ResolvedUnitModelRow[];
  expenseModelRows: ResolvedExpenseModelRow[];
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function classificationText(record: Record<string, unknown>): string {
  return [
    record.unitCategory,
    record.tenantName,
    record.rentType,
    record.tenantStatus,
    record.leaseType,
    record.notes,
    record.note,
    record.unit,
    record.building,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

function annualRentFromRecord(record: Record<string, unknown>): number | null {
  const annual =
    toFiniteNumber(record.annualTotalRent) ??
    toFiniteNumber(record.annualBaseRent) ??
    toFiniteNumber(record.annualRent);
  if (annual != null && annual > 0) return annual;

  const monthly =
    toFiniteNumber(record.monthlyTotalRent) ??
    toFiniteNumber(record.monthlyBaseRent) ??
    toFiniteNumber(record.monthlyRent) ??
    toFiniteNumber(record.rent);
  if (monthly != null && monthly > 0) return monthly * 12;

  return null;
}

function lowerBoundRange(first: number | null, second: number | null): number | null {
  if (first == null) return null;
  if (second == null) return first;
  return Math.min(first, second);
}

function conservativeProjectedAnnualRentFromRecord(record: Record<string, unknown>): number | null {
  const directAnnual = lowerBoundRange(
    toFiniteNumber(record.projectedAnnualRentLow) ??
      toFiniteNumber(record.projectedAnnualRent) ??
      toFiniteNumber(record.projectedAnnualBaseRentLow) ??
      toFiniteNumber(record.projectedAnnualBaseRent),
    toFiniteNumber(record.projectedAnnualRentHigh) ??
      toFiniteNumber(record.projectedAnnualRentMax) ??
      toFiniteNumber(record.projectedAnnualBaseRentHigh)
  );
  if (directAnnual != null && directAnnual > 0) return directAnnual;

  const directMonthly = lowerBoundRange(
    toFiniteNumber(record.projectedMonthlyRentLow) ??
      toFiniteNumber(record.projectedMonthlyRent) ??
      toFiniteNumber(record.projectedMonthlyBaseRentLow) ??
      toFiniteNumber(record.projectedMonthlyBaseRent),
    toFiniteNumber(record.projectedMonthlyRentHigh) ??
      toFiniteNumber(record.projectedMonthlyRentMax) ??
      toFiniteNumber(record.projectedMonthlyBaseRentHigh)
  );
  if (directMonthly != null && directMonthly > 0) return directMonthly * 12;

  const text = classificationText(record);
  const annualMatch = text.match(
    /(?:projected|market)(?:\s+\w+){0,3}\s+annual\s+rent[^$]{0,20}\$?\s*([\d,]+)(?:\s*(?:-|to|–|—)\s*\$?\s*([\d,]+))?/i
  );
  if (annualMatch) {
    const low = lowerBoundRange(toFiniteNumber(annualMatch[1]), toFiniteNumber(annualMatch[2]));
    if (low != null && low > 0) return low;
  }

  const monthlyMatch = text.match(
    /(?:projected|market)(?:\s+\w+){0,3}\s+(?:monthly\s+)?rent[^$]{0,20}\$?\s*([\d,]+)(?:\s*(?:-|to|–|—)\s*\$?\s*([\d,]+))?/i
  );
  if (monthlyMatch) {
    const low = lowerBoundRange(toFiniteNumber(monthlyMatch[1]), toFiniteNumber(monthlyMatch[2]));
    if (low != null && low > 0) return low * 12;
  }

  return null;
}

function isVacantLikeRecord(record: Record<string, unknown>): boolean {
  if (record.occupied === false) return true;
  if (typeof record.occupied === "string" && /\bvacant\b/i.test(record.occupied)) return true;
  if (typeof record.tenantStatus === "string" && VACANT_LIKE_PATTERN.test(record.tenantStatus)) return true;
  return VACANT_LIKE_PATTERN.test(classificationText(record));
}

function slugPart(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function rentRowId(row: OmRentRollRow, index: number): string {
  const parts = [
    slugPart(typeof row.building === "string" ? row.building : null),
    slugPart(typeof row.unit === "string" ? row.unit : null),
    slugPart(typeof row.tenantName === "string" ? row.tenantName : null),
    slugPart(typeof row.unitCategory === "string" ? row.unitCategory : null),
  ].filter(Boolean);
  return parts.length > 0 ? `rent-${parts.join("-")}-${index + 1}` : `rent-row-${index + 1}`;
}

function expenseRowId(lineItem: string, index: number): string {
  const slug = slugPart(lineItem);
  return slug ? `expense-${slug}-${index + 1}` : `expense-row-${index + 1}`;
}

function roundCurrency(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}

function clampPct(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function modeledAnnualRentFromInputs(params: {
  underwrittenAnnualRent: number | null;
  rentUpliftPct: number | null;
  occupancyPct: number | null;
  includeInUnderwriting: boolean;
}): number | null {
  if (!params.includeInUnderwriting || params.underwrittenAnnualRent == null) return null;
  return roundCurrency(
    params.underwrittenAnnualRent *
      (1 + Math.max(0, params.rentUpliftPct ?? 0) / 100) *
      ((clampPct(params.occupancyPct) ?? 100) / 100)
  );
}

function grossUpEffectiveRentToGrossPotential(params: {
  annualRent: number | null;
  isProtected: boolean;
  rentBasis: "gross_before_vacancy" | "effective_after_vacancy" | "unknown";
  assumedLongTermOccupancyPct: number | null;
}): number | null {
  if (params.annualRent == null || params.isProtected || params.rentBasis !== "effective_after_vacancy") {
    return params.annualRent;
  }
  const occupancyPct = clampPct(params.assumedLongTermOccupancyPct) ?? DEFAULT_ASSUMED_LTR_OCCUPANCY_PCT;
  if (occupancyPct <= 0) return params.annualRent;
  return roundCurrency(params.annualRent / (occupancyPct / 100));
}

function defaultModeledOccupancyPct(params: {
  isVacantLike: boolean;
  isProtected: boolean;
  defaultVacancyPct: number | null;
}): number {
  if (params.isVacantLike) return 0;
  if (params.isProtected) return 100;
  return clampPct(100 - (params.defaultVacancyPct ?? 0)) ?? 100;
}

function roundFurnishingCost(value: number): number {
  return Math.max(0, Math.round(value / 500) * 500);
}

function furnishingSqftPremiumPerUnit(avgUnitSqft: number | null): number {
  if (avgUnitSqft == null || !Number.isFinite(avgUnitSqft)) return 0;
  const sqft = Math.max(0, avgUnitSqft);
  if (sqft <= 500) return 0;
  if (sqft <= 1_500) return sqft - 500;
  if (sqft <= 2_500) return 1_000 + (sqft - 1_500) * 11;
  return 12_000 + Math.min(8_000, (sqft - 2_500) * 8);
}

function estimateDefaultFurnishingCost(params: {
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  isProtected: boolean;
}): number {
  if (params.isProtected) return 0;
  const beds =
    params.beds != null && Number.isFinite(params.beds) ? Math.max(0, Math.round(params.beds)) : DEFAULT_FURNISHING_BEDROOMS_PER_UNIT;
  const baths =
    params.baths != null && Number.isFinite(params.baths) ? Math.max(0, params.baths) : DEFAULT_FURNISHING_BATHS_PER_UNIT;
  const sqft =
    params.sqft != null && Number.isFinite(params.sqft) ? Math.max(0, params.sqft) : DEFAULT_FURNISHING_UNIT_SQFT;
  const raw =
    DEFAULT_FURNISHING_BASE_PER_UNIT +
    beds * DEFAULT_FURNISHING_BEDROOM_COST +
    baths * DEFAULT_FURNISHING_BATHROOM_COST +
    furnishingSqftPremiumPerUnit(sqft);
  return roundFurnishingCost(Math.min(MAX_FURNISHING_COST_PER_UNIT, raw));
}

function defaultExpenseTreatment(lineItem: string): PropertyDealDossierExpenseTreatment {
  return isManagementFeeExpenseLine(lineItem) ? "replace_management" : "operating";
}

function defaultExpenseGrowthPct(params: {
  lineItem: string;
  annualExpenseGrowthPct: number | null;
  annualPropertyTaxGrowthPct: number | null;
  aggregateFallback?: boolean;
}): number | null {
  if (params.aggregateFallback) {
    return Math.max(params.annualExpenseGrowthPct ?? 0, params.annualPropertyTaxGrowthPct ?? 0);
  }
  return /tax/i.test(params.lineItem)
    ? params.annualPropertyTaxGrowthPct
    : params.annualExpenseGrowthPct;
}

function resolvedExpenseTreatment(
  row: PropertyDealDossierExpenseModelRow | null | undefined,
  lineItem: string
): PropertyDealDossierExpenseTreatment {
  if (
    row?.treatment === "operating" ||
    row?.treatment === "replace_management" ||
    row?.treatment === "exclude"
  ) {
    return row.treatment;
  }
  return defaultExpenseTreatment(lineItem);
}

export function resolveDetailedCashFlowModel(params: {
  details: PropertyDetails | null;
  defaultRentUpliftPct: number | null;
  defaultVacancyPct: number | null;
  defaultAnnualExpenseGrowthPct: number | null;
  defaultAnnualPropertyTaxGrowthPct: number | null;
  unitModelRows?: PropertyDealDossierUnitModelRow[] | null;
  expenseModelRows?: PropertyDealDossierExpenseModelRow[] | null;
}): ResolvedDetailedCashFlowModel {
  const sourceRentRoll = resolvePreferredOmRentRoll(params.details);
  const sourceExpenseRows = resolvePreferredOmExpenseTable(params.details);
  const currentFinancials = resolveCurrentFinancialsFromDetails(params.details);
  const aggregateExpenseTotal =
    resolvePreferredOmExpenseTotal(params.details) ?? currentFinancials.operatingExpenses ?? 0;

  const savedUnitRows = new Map(
    (params.unitModelRows ?? []).map((row) => [row.rowId, row] as const)
  );
  const seenUnitRowIds = new Set<string>();
  const unitModelRows: ResolvedUnitModelRow[] = sourceRentRoll.map((row, index) => {
    const rowId = rentRowId(row, index);
    seenUnitRowIds.add(rowId);
    const override = savedUnitRows.get(rowId);
    const record = row as Record<string, unknown>;
    const labels = classificationText(record);
    const isCommercial = COMMERCIAL_PATTERN.test(labels);
    const isRentStabilized = RENT_STABILIZED_PATTERN.test(labels);
    const clearlyResidential =
      !isCommercial &&
      !ANCILLARY_SPACE_PATTERN.test(labels) &&
      (RESIDENTIAL_PATTERN.test(labels) ||
        toFiniteNumber(record.beds) != null ||
        toFiniteNumber(record.baths) != null ||
        String(record.unitCategory ?? "").trim().toLowerCase() === "residential");
    const isVacantLike = isVacantLikeRecord(record);
    const isProtected = override?.isProtected ?? (isCommercial || isRentStabilized || !clearlyResidential);
    const currentAnnualRent = override?.currentAnnualRent ?? annualRentFromRecord(record);
    const normalizedCurrentAnnualRent = grossUpEffectiveRentToGrossPotential({
      annualRent: currentAnnualRent,
      isProtected,
      rentBasis: currentFinancials.rentBasis,
      assumedLongTermOccupancyPct: currentFinancials.assumedLongTermOccupancyPct,
    });
    const defaultProjectedAnnualRent =
      conservativeProjectedAnnualRentFromRecord(record) ?? normalizedCurrentAnnualRent;
    const underwrittenAnnualRent = override?.underwrittenAnnualRent ?? defaultProjectedAnnualRent;
    const rentUpliftPct =
      override?.rentUpliftPct ?? (isProtected ? 0 : params.defaultRentUpliftPct ?? 0);
    const occupancyPct =
      clampPct(override?.occupancyPct) ??
      defaultModeledOccupancyPct({
        isVacantLike,
        isProtected,
        defaultVacancyPct: params.defaultVacancyPct,
      });
    const furnishingCost =
      override?.furnishingCost ??
      estimateDefaultFurnishingCost({
        beds: override?.beds ?? toFiniteNumber(record.beds),
        baths: override?.baths ?? toFiniteNumber(record.baths),
        sqft: override?.sqft ?? toFiniteNumber(record.sqft),
        isProtected,
      });
    const onboardingFee = override?.onboardingFee ?? null;
    const monthlyHospitalityExpense = override?.monthlyHospitalityExpense ?? null;
    const includeInUnderwriting = override?.includeInUnderwriting ?? true;
    const modeledAnnualRent = modeledAnnualRentFromInputs({
      underwrittenAnnualRent,
      rentUpliftPct,
      occupancyPct,
      includeInUnderwriting,
    });

    return {
      rowId,
      unitLabel:
        override?.unitLabel ??
        (
          [typeof row.building === "string" ? row.building : null, typeof row.unit === "string" ? row.unit : null]
            .filter(Boolean)
            .join(" · ") ||
          (typeof row.tenantName === "string" && row.tenantName.trim().length > 0
            ? row.tenantName.trim()
            : null) ||
          `Unit ${index + 1}`
        ),
      building: override?.building ?? (typeof row.building === "string" ? row.building : null),
      unitCategory:
        override?.unitCategory ?? (typeof row.unitCategory === "string" ? row.unitCategory : null),
      tenantName: override?.tenantName ?? (typeof row.tenantName === "string" ? row.tenantName : null),
      currentAnnualRent,
      underwrittenAnnualRent,
      rentUpliftPct,
      occupancyPct,
      furnishingCost,
      onboardingFee,
      monthlyHospitalityExpense,
      includeInUnderwriting,
      isProtected,
      beds: override?.beds ?? toFiniteNumber(record.beds),
      baths: override?.baths ?? toFiniteNumber(record.baths),
      sqft: override?.sqft ?? toFiniteNumber(record.sqft),
      tenantStatus:
        override?.tenantStatus ?? (typeof row.tenantStatus === "string" ? row.tenantStatus : null),
      notes: override?.notes ?? (typeof row.notes === "string" ? row.notes : null),
      isCommercial,
      isRentStabilized,
      isVacantLike,
      modeledAnnualRent,
      defaultProjectedAnnualRent,
    };
  });

  for (const savedRow of params.unitModelRows ?? []) {
    if (seenUnitRowIds.has(savedRow.rowId)) continue;
    const isProtected = savedRow.isProtected ?? false;
    const isVacantLike = false;
    const includeInUnderwriting = savedRow.includeInUnderwriting ?? true;
    const underwrittenAnnualRent = savedRow.underwrittenAnnualRent ?? savedRow.currentAnnualRent ?? null;
    const rentUpliftPct = savedRow.rentUpliftPct ?? (isProtected ? 0 : params.defaultRentUpliftPct ?? 0);
    const occupancyPct =
      clampPct(savedRow.occupancyPct) ??
      defaultModeledOccupancyPct({
        isVacantLike,
        isProtected,
        defaultVacancyPct: params.defaultVacancyPct,
      });
    const furnishingCost =
      savedRow.furnishingCost ??
      estimateDefaultFurnishingCost({
        beds: savedRow.beds ?? null,
        baths: savedRow.baths ?? null,
        sqft: savedRow.sqft ?? null,
        isProtected,
      });
    const onboardingFee = savedRow.onboardingFee ?? null;
    const monthlyHospitalityExpense = savedRow.monthlyHospitalityExpense ?? null;
    unitModelRows.push({
      rowId: savedRow.rowId,
      unitLabel: savedRow.unitLabel ?? savedRow.rowId,
      building: savedRow.building ?? null,
      unitCategory: savedRow.unitCategory ?? null,
      tenantName: savedRow.tenantName ?? null,
      currentAnnualRent: savedRow.currentAnnualRent ?? null,
      underwrittenAnnualRent,
      rentUpliftPct,
      occupancyPct,
      furnishingCost,
      onboardingFee,
      monthlyHospitalityExpense,
      includeInUnderwriting,
      isProtected,
      beds: savedRow.beds ?? null,
      baths: savedRow.baths ?? null,
      sqft: savedRow.sqft ?? null,
      tenantStatus: savedRow.tenantStatus ?? null,
      notes: savedRow.notes ?? null,
      isCommercial: false,
      isRentStabilized: false,
      isVacantLike,
      modeledAnnualRent: modeledAnnualRentFromInputs({
        underwrittenAnnualRent,
        rentUpliftPct,
        occupancyPct,
        includeInUnderwriting,
      }),
      defaultProjectedAnnualRent: underwrittenAnnualRent,
    });
  }

  const savedExpenseRows = new Map(
    (params.expenseModelRows ?? []).map((row) => [row.rowId, row] as const)
  );
  const seenExpenseRowIds = new Set<string>();
  const expenseRowsSource =
    sourceExpenseRows.length > 0
      ? sourceExpenseRows.map((row, index) => ({
          rowId: expenseRowId(row.lineItem, index),
          lineItem: row.lineItem,
          amount: row.amount,
          aggregateFallback: false,
        }))
      : aggregateExpenseTotal > 0
        ? [
            {
              rowId: "expense-operating-expenses-aggregate",
              lineItem: "Operating expenses",
              amount: aggregateExpenseTotal,
              aggregateFallback: true,
            },
          ]
        : [];

  const expenseModelRows: ResolvedExpenseModelRow[] = expenseRowsSource.map((row) => {
    seenExpenseRowIds.add(row.rowId);
    const override = savedExpenseRows.get(row.rowId);
    const lineItem = override?.lineItem?.trim() || row.lineItem;
    const treatment = resolvedExpenseTreatment(override, lineItem);
    return {
      rowId: row.rowId,
      lineItem,
      amount: override?.amount ?? row.amount,
      annualGrowthPct:
        override?.annualGrowthPct ??
        defaultExpenseGrowthPct({
          lineItem,
          annualExpenseGrowthPct: params.defaultAnnualExpenseGrowthPct,
          annualPropertyTaxGrowthPct: params.defaultAnnualPropertyTaxGrowthPct,
          aggregateFallback: row.aggregateFallback,
        }),
      treatment,
      isManagementLine: isManagementFeeExpenseLine(lineItem),
    };
  });

  for (const savedRow of params.expenseModelRows ?? []) {
    if (seenExpenseRowIds.has(savedRow.rowId)) continue;
    const lineItem = savedRow.lineItem.trim();
    if (!lineItem) continue;
    expenseModelRows.push({
      rowId: savedRow.rowId,
      lineItem,
      amount: savedRow.amount ?? null,
      annualGrowthPct:
        savedRow.annualGrowthPct ??
        defaultExpenseGrowthPct({
          lineItem,
          annualExpenseGrowthPct: params.defaultAnnualExpenseGrowthPct,
          annualPropertyTaxGrowthPct: params.defaultAnnualPropertyTaxGrowthPct,
        }),
      treatment: resolvedExpenseTreatment(savedRow, lineItem),
      isManagementLine: isManagementFeeExpenseLine(lineItem),
    });
  }

  return {
    unitModelRows,
    expenseModelRows,
  };
}

export function expenseModelRowsToProjectionRows(
  rows: ResolvedExpenseModelRow[]
): Array<ExpenseLineItem & { annualGrowthPct?: number | null; treatment?: PropertyDealDossierExpenseTreatment | null }> {
  return rows
    .filter((row) => row.amount != null && Number.isFinite(row.amount) && row.amount >= 0)
    .map((row) => ({
      lineItem: row.lineItem,
      amount: row.amount ?? 0,
      annualGrowthPct: row.annualGrowthPct ?? null,
      treatment: row.treatment,
    }));
}

export function unitModelRowsToProjectionRows(
  rows: ResolvedUnitModelRow[]
): Array<{
  rowId: string;
  unitLabel: string;
  currentAnnualRent?: number | null;
  underwrittenAnnualRent?: number | null;
  rentUpliftPct?: number | null;
  occupancyPct?: number | null;
  furnishingCost?: number | null;
  onboardingFee?: number | null;
  monthlyHospitalityExpense?: number | null;
  includeInUnderwriting?: boolean | null;
  isProtected?: boolean | null;
}> {
  return rows.map((row) => ({
    rowId: row.rowId,
    unitLabel: row.unitLabel,
    currentAnnualRent: row.currentAnnualRent,
    underwrittenAnnualRent: row.underwrittenAnnualRent,
    rentUpliftPct: row.rentUpliftPct,
    occupancyPct: row.occupancyPct,
    furnishingCost: row.furnishingCost,
    onboardingFee: row.onboardingFee,
    monthlyHospitalityExpense: row.monthlyHospitalityExpense,
    includeInUnderwriting: row.includeInUnderwriting,
    isProtected: row.isProtected,
  }));
}
