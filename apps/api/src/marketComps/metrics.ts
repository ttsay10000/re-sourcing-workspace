/**
 * Market Comps metric extraction + aggregation.
 *
 * One property → one OperatingMetricsRow (revenue/expense/NOI per unit & PSF,
 * occupancy, pricing, rent by unit type, expense categories), built from the
 * latest deal signals + the authoritative OM snapshot paths. Comp sets
 * (Same Submarket / Borough / All NYC) aggregate those rows into
 * median/p25/p75 stats with subject-vs-median variance — every comparison in
 * the UI carries dispersion, not just a single number.
 */

export interface RentRollUnitLike {
  beds?: unknown;
  sqft?: unknown;
  monthlyRent?: unknown;
  monthlyTotalRent?: unknown;
  monthlyBaseRent?: unknown;
  annualRent?: unknown;
  annualTotalRent?: unknown;
  unitCategory?: unknown;
  occupied?: unknown;
  tenantStatus?: unknown;
}

export interface ExpenseLineLike {
  lineItem?: unknown;
  amount?: unknown;
}

export interface OperatingMetricsSource {
  propertyId: string;
  address: string;
  neighborhoodRaw: string | null;
  borough: string | null;
  units: number | null;
  gsf: number | null;
  yearBuilt: number | null;
  propertyType: string | null;
  askingPrice: number | null;
  /** Latest deal_signals values (already percent / dollars). */
  signalCapRatePct: number | null;
  signalPricePsf: number | null;
  signalPricePerUnit: number | null;
  signalExpenseRatioPct: number | null;
  signalNoi: number | null;
  /** OM income block. */
  effectiveGrossIncome: number | null;
  grossRentalIncome: number | null;
  otherIncome: number | null;
  reportedOccupancyPct: number | null;
  reportedVacancyPct: number | null;
  /** OM expense block. */
  totalExpenses: number | null;
  operatingExpensesFallback: number | null;
  noiReported: number | null;
  rentRoll: RentRollUnitLike[];
  expenseLines: ExpenseLineLike[];
}

export type UnitTypeKey = "studio" | "br1" | "br2" | "br3plus";

export const UNIT_TYPE_LABELS: Record<UnitTypeKey, string> = {
  studio: "Studio",
  br1: "1 BR",
  br2: "2 BR",
  br3plus: "3+ BR",
};

export type ExpenseCategoryKey =
  | "taxes"
  | "insurance"
  | "utilities"
  | "water_sewer"
  | "repairs_maintenance"
  | "payroll"
  | "management"
  | "other";

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategoryKey, string> = {
  taxes: "Real Estate Taxes",
  insurance: "Insurance",
  utilities: "Utilities",
  water_sewer: "Water & Sewer",
  repairs_maintenance: "Repairs & Maintenance",
  payroll: "Payroll / Super",
  management: "Management Fee",
  other: "Other",
};

export interface OperatingMetricsRow {
  propertyId: string;
  address: string;
  neighborhoodRaw: string | null;
  neighborhoodKey: string | null;
  neighborhoodName: string | null;
  borough: string | null;
  units: number | null;
  gsf: number | null;
  yearBuilt: number | null;
  propertyType: string | null;

  occupancyPct: number | null;
  revenue: number | null;
  revenuePerUnit: number | null;
  revenuePsf: number | null;
  expenses: number | null;
  expensePerUnit: number | null;
  expensePsf: number | null;
  expenseRatioPct: number | null;
  noi: number | null;
  noiPerUnit: number | null;
  noiPsf: number | null;
  noiMarginPct: number | null;
  capRatePct: number | null;
  askingPrice: number | null;
  pricePerUnit: number | null;
  pricePsf: number | null;
  avgMonthlyRentPerUnit: number | null;

  /** Median monthly rent (and annual rent PSF) per unit-type bucket. */
  rentByUnitType: Partial<Record<UnitTypeKey, { monthlyRent: number; rentPsf: number | null; unitCount: number }>>;
  /** Annualized $ per category. */
  expenseByCategory: Partial<Record<ExpenseCategoryKey, number>>;
}

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function positive(value: number | null): number | null {
  return value != null && value > 0 ? value : null;
}

export function unitTypeKeyForBeds(beds: number | null): UnitTypeKey | null {
  if (beds == null || beds < 0) return null;
  if (beds < 0.5) return "studio";
  if (beds < 1.5) return "br1";
  if (beds < 2.5) return "br2";
  return "br3plus";
}

const EXPENSE_CATEGORY_PATTERNS: Array<{ key: ExpenseCategoryKey; pattern: RegExp }> = [
  { key: "taxes", pattern: /tax/i },
  { key: "insurance", pattern: /insur/i },
  { key: "water_sewer", pattern: /water|sewer/i },
  { key: "utilities", pattern: /utilit|electric|gas|fuel|heat|energy/i },
  { key: "repairs_maintenance", pattern: /repair|maint|clean|landscap|exterminat|elevator/i },
  { key: "payroll", pattern: /payroll|super|labor|staff|porter/i },
  { key: "management", pattern: /manage/i },
];

export function categorizeExpenseLine(label: string): ExpenseCategoryKey {
  for (const { key, pattern } of EXPENSE_CATEGORY_PATTERNS) {
    if (pattern.test(label)) return key;
  }
  return "other";
}

function median(sortedAscending: number[]): number | null {
  if (sortedAscending.length === 0) return null;
  const middle = Math.floor((sortedAscending.length - 1) / 2);
  return sortedAscending.length % 2 === 1
    ? sortedAscending[middle]
    : (sortedAscending[middle] + sortedAscending[middle + 1]) / 2;
}

export function percentileOf(sortedAscending: number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  const index = (sortedAscending.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedAscending[lower];
  const weight = index - lower;
  return sortedAscending[lower] * (1 - weight) + sortedAscending[upper] * weight;
}

/** A vacant-building OM reports 0% occupancy — that is signal, not noise. */
function occupancyOf(source: OperatingMetricsSource): number | null {
  const reported = source.reportedOccupancyPct;
  if (reported != null && reported >= 0 && reported <= 100) return reported;
  const vacancy = source.reportedVacancyPct;
  if (vacancy != null && vacancy >= 0 && vacancy <= 100) return 100 - vacancy;

  const statuses = source.rentRoll
    .map((unit) => {
      if (typeof unit.occupied === "boolean") return unit.occupied;
      const status = `${unit.occupied ?? unit.tenantStatus ?? ""}`.toLowerCase();
      if (/occupied|leased/.test(status)) return true;
      if (/vacant/.test(status)) return false;
      return null;
    })
    .filter((value): value is boolean => value != null);
  if (statuses.length >= 3) {
    return Math.round((statuses.filter(Boolean).length / statuses.length) * 1000) / 10;
  }
  return null;
}

function monthlyRentOf(unit: RentRollUnitLike): number | null {
  const monthly =
    positive(toFiniteNumber(unit.monthlyRent)) ??
    positive(toFiniteNumber(unit.monthlyTotalRent)) ??
    positive(toFiniteNumber(unit.monthlyBaseRent));
  if (monthly != null) return monthly;
  const annual = positive(toFiniteNumber(unit.annualRent)) ?? positive(toFiniteNumber(unit.annualTotalRent));
  return annual != null ? annual / 12 : null;
}

function isResidentialUnit(unit: RentRollUnitLike): boolean {
  const category = `${unit.unitCategory ?? ""}`.toLowerCase();
  if (!category) return true;
  return !/commercial|retail|office|storage|garage|cell|antenna|billboard/.test(category);
}

export function buildOperatingMetricsRow(source: OperatingMetricsSource): OperatingMetricsRow {
  const units = positive(source.units);
  const gsf = positive(source.gsf);

  const revenue =
    positive(source.effectiveGrossIncome) ??
    (positive(source.grossRentalIncome) != null
      ? (source.grossRentalIncome as number) + (positive(source.otherIncome) ?? 0)
      : null);

  const expenses = positive(source.totalExpenses) ?? positive(source.operatingExpensesFallback);

  const noi =
    revenue != null && expenses != null
      ? revenue - expenses
      : positive(source.signalNoi) ?? positive(source.noiReported);

  const ask = positive(source.askingPrice);
  const capRatePct =
    positive(source.signalCapRatePct) ??
    (noi != null && noi > 0 && ask != null ? Math.round((noi / ask) * 10000) / 100 : null);

  const expenseRatioPct =
    positive(source.signalExpenseRatioPct) ??
    (revenue != null && expenses != null && revenue > 0 ? Math.round((expenses / revenue) * 1000) / 10 : null);

  const rentByUnitType: OperatingMetricsRow["rentByUnitType"] = {};
  const buckets = new Map<UnitTypeKey, { rents: number[]; psfs: number[] }>();
  for (const unit of source.rentRoll) {
    if (!isResidentialUnit(unit)) continue;
    const key = unitTypeKeyForBeds(toFiniteNumber(unit.beds));
    const rent = monthlyRentOf(unit);
    if (key == null || rent == null) continue;
    const bucket = buckets.get(key) ?? { rents: [], psfs: [] };
    bucket.rents.push(rent);
    const sqft = positive(toFiniteNumber(unit.sqft));
    if (sqft != null && sqft > 100) bucket.psfs.push((rent * 12) / sqft);
    buckets.set(key, bucket);
  }
  for (const [key, bucket] of buckets) {
    const rents = bucket.rents.sort((a, b) => a - b);
    const psfs = bucket.psfs.sort((a, b) => a - b);
    rentByUnitType[key] = {
      monthlyRent: median(rents) as number,
      rentPsf: median(psfs),
      unitCount: rents.length,
    };
  }

  const allRents = source.rentRoll
    .filter(isResidentialUnit)
    .map(monthlyRentOf)
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);

  const expenseByCategory: OperatingMetricsRow["expenseByCategory"] = {};
  for (const line of source.expenseLines) {
    const label = `${line.lineItem ?? ""}`.trim();
    const amount = positive(toFiniteNumber(line.amount));
    if (!label || amount == null) continue;
    const key = categorizeExpenseLine(label);
    expenseByCategory[key] = (expenseByCategory[key] ?? 0) + amount;
  }

  return {
    propertyId: source.propertyId,
    address: source.address,
    neighborhoodRaw: source.neighborhoodRaw,
    neighborhoodKey: null,
    neighborhoodName: source.neighborhoodRaw,
    borough: source.borough,
    units,
    gsf,
    yearBuilt: positive(source.yearBuilt),
    propertyType: source.propertyType,

    occupancyPct: occupancyOf(source),
    revenue,
    revenuePerUnit: revenue != null && units != null ? revenue / units : null,
    revenuePsf: revenue != null && gsf != null ? revenue / gsf : null,
    expenses,
    expensePerUnit: expenses != null && units != null ? expenses / units : null,
    expensePsf: expenses != null && gsf != null ? expenses / gsf : null,
    expenseRatioPct,
    noi,
    noiPerUnit: noi != null && units != null ? noi / units : null,
    noiPsf: noi != null && gsf != null ? noi / gsf : null,
    noiMarginPct: noi != null && revenue != null && revenue > 0 ? Math.round((noi / revenue) * 1000) / 10 : null,
    capRatePct,
    askingPrice: ask,
    pricePerUnit: positive(source.signalPricePerUnit) ?? (ask != null && units != null ? ask / units : null),
    pricePsf: positive(source.signalPricePsf) ?? (ask != null && gsf != null ? ask / gsf : null),
    avgMonthlyRentPerUnit: median(allRents),

    rentByUnitType,
    expenseByCategory,
  };
}

export interface MetricStat {
  count: number;
  median: number | null;
  mean: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
  /** subject − comp-set median (same units as the metric). */
  varianceAbs: number | null;
  /** (subject − median) ÷ median × 100. */
  variancePct: number | null;
}

export function aggregateMetric(values: Array<number | null | undefined>, subject: number | null): MetricStat {
  const clean = values
    .filter((value): value is number => value != null && Number.isFinite(value))
    .sort((a, b) => a - b);
  const med = median(clean);
  return {
    count: clean.length,
    median: med,
    mean: clean.length > 0 ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null,
    p25: percentileOf(clean, 0.25),
    p75: percentileOf(clean, 0.75),
    min: clean.length > 0 ? clean[0] : null,
    max: clean.length > 0 ? clean[clean.length - 1] : null,
    varianceAbs: subject != null && med != null ? subject - med : null,
    variancePct: subject != null && med != null && med !== 0 ? ((subject - med) / Math.abs(med)) * 100 : null,
  };
}
