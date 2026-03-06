/**
 * Rent roll comparison: only compare OM vs RapidAPI when total_units and total_bedrooms match.
 * Used to gate comparison UI and show "RapidAPI rent roll likely incomplete — comparison disabled" when not comparable.
 */

import type { RentalFinancials, RentalUnitRow, RentalNumberPerUnit } from "@re-sourcing/contracts";

export interface RentRollComparisonResult {
  comparable: boolean;
  totalUnitsRapid: number;
  totalUnitsOm: number;
  totalBedsRapid: number;
  totalBedsOm: number;
}

function sumBeds(units: Array<{ beds?: number | null }>): number {
  return units.reduce((s, u) => s + (u.beds ?? 0), 0);
}

/**
 * Returns whether OM and RapidAPI rent rolls are comparable (same unit count and same total bedrooms).
 * If not comparable, UI should show: "RapidAPI rent roll likely incomplete — comparison disabled."
 */
export function getRentRollComparison(rentalFinancials: RentalFinancials | null | undefined): RentRollComparisonResult | null {
  if (!rentalFinancials) return null;
  const rapid = (rentalFinancials.rentalUnits ?? []) as RentalUnitRow[];
  const om = (rentalFinancials.fromLlm?.rentalNumbersPerUnit ?? []) as RentalNumberPerUnit[];
  const totalUnitsRapid = rapid.length;
  const totalUnitsOm = om.length;
  const totalBedsRapid = sumBeds(rapid);
  const totalBedsOm = sumBeds(om);
  const hasAnyUnits = totalUnitsRapid > 0 || totalUnitsOm > 0;
  const comparable =
    hasAnyUnits && totalUnitsRapid === totalUnitsOm && totalBedsRapid === totalBedsOm;
  return {
    comparable,
    totalUnitsRapid,
    totalUnitsOm,
    totalBedsRapid,
    totalBedsOm,
  };
}
