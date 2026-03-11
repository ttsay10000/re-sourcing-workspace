/**
 * Rent roll comparison: only compare OM vs RapidAPI when total_units and total_bedrooms match.
 * Used to gate comparison UI and show "RapidAPI rent roll likely incomplete — comparison disabled" when not comparable.
 */

import type { PropertyDetails, RentalFinancials, RentalUnitRow } from "@re-sourcing/contracts";
import { getAuthoritativeOmSnapshot } from "../om/authoritativeOm.js";
import { sanitizeOmRentRollRows } from "./omAnalysisUtils.js";

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
export function getRentRollComparison(details: PropertyDetails | null | undefined): RentRollComparisonResult | null {
  const rentalFinancials = (details?.rentalFinancials ?? null) as RentalFinancials | null;
  if (!rentalFinancials) return null;
  const rapid = (rentalFinancials.rentalUnits ?? []) as RentalUnitRow[];
  const authoritative = getAuthoritativeOmSnapshot(details);
  if (!authoritative) return null;
  const om = sanitizeOmRentRollRows(authoritative.rentRoll ?? []) as Array<{ beds?: number | null }>;
  if (om.length === 0) return null;
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
