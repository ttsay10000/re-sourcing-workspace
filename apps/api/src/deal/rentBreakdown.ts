import type { UnderwritingContext } from "./underwritingContext.js";

type RentBreakdownValue = NonNullable<UnderwritingContext["rentBreakdown"]>;

interface RentBreakdownInput {
  currentGrossRent: number | null | undefined;
  propertyMix: {
    freeMarketAnnualRent?: number | null;
    rentStabilizedAnnualRent?: number | null;
    commercialAnnualRent?: number | null;
  };
  holdPeriodYears: number;
  leadTimeMonths: number;
  yearly: {
    grossRentalIncome: Array<number | null | undefined>;
    freeMarketResidentialGrossRentalIncome: Array<number | null | undefined>;
    protectedResidentialGrossRentalIncome: Array<number | null | undefined>;
    commercialGrossRentalIncome: Array<number | null | undefined>;
  };
}

function roundedOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function sumFiniteValues(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0);
}

export function buildRentBreakdown(params: RentBreakdownInput): RentBreakdownValue {
  const stabilizedYearNumber =
    params.leadTimeMonths > 0 && params.holdPeriodYears > 1
      ? 2
      : 1;
  const stabilizedIndex = Math.min(params.holdPeriodYears, stabilizedYearNumber);
  const current: RentBreakdownValue["current"] = {
    freeMarketResidential: roundedOrNull(params.propertyMix.freeMarketAnnualRent),
    protectedResidential: roundedOrNull(params.propertyMix.rentStabilizedAnnualRent),
    commercial: roundedOrNull(params.propertyMix.commercialAnnualRent),
    total: roundedOrNull(
      params.currentGrossRent ??
        sumFiniteValues([
          params.propertyMix.freeMarketAnnualRent,
          params.propertyMix.rentStabilizedAnnualRent,
          params.propertyMix.commercialAnnualRent,
        ])
    ),
  };
  const currentKnownTotal =
    (current.freeMarketResidential ?? 0) +
    (current.protectedResidential ?? 0) +
    (current.commercial ?? 0);
  if (current.total != null && currentKnownTotal > 0) {
    const scale = current.total / currentKnownTotal;
    current.freeMarketResidential = roundedOrNull((current.freeMarketResidential ?? 0) * scale);
    current.protectedResidential = roundedOrNull((current.protectedResidential ?? 0) * scale);
    current.commercial = roundedOrNull((current.commercial ?? 0) * scale);
  }
  const stabilized: RentBreakdownValue["stabilized"] = {
    freeMarketResidential: roundedOrNull(
      params.yearly.freeMarketResidentialGrossRentalIncome[stabilizedIndex] ?? null
    ),
    protectedResidential: roundedOrNull(
      params.yearly.protectedResidentialGrossRentalIncome[stabilizedIndex] ?? null
    ),
    commercial: roundedOrNull(
      params.yearly.commercialGrossRentalIncome[stabilizedIndex] ?? null
    ),
    total: roundedOrNull(
      params.yearly.grossRentalIncome[stabilizedIndex] ??
        (params.yearly.freeMarketResidentialGrossRentalIncome[stabilizedIndex] ?? 0) +
          (params.yearly.protectedResidentialGrossRentalIncome[stabilizedIndex] ?? 0) +
          (params.yearly.commercialGrossRentalIncome[stabilizedIndex] ?? 0)
    ),
  };
  return {
    current,
    stabilizedYearNumber,
    stabilized,
    freeMarketResidentialLift:
      current.freeMarketResidential != null && stabilized.freeMarketResidential != null
        ? roundedOrNull(stabilized.freeMarketResidential - current.freeMarketResidential)
        : null,
    totalLift:
      current.total != null && stabilized.total != null
        ? roundedOrNull(stabilized.total - current.total)
        : null,
  };
}
