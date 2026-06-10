/**
 * Shared, details-only resolution of the reconstructed current-NOI basis:
 * actual gross rent + other income (+ conservative projected lease-up) −
 * expenses, with a manually overridden NOI winning. This is the LTR-yield
 * numerator every read surface (pipeline, saved deals, deal progress, comps)
 * must use so yields match the OM workspace; the broker-stated NOI is only a
 * fallback when reconstruction is impossible.
 */

import type { PropertyDetails } from "@re-sourcing/contracts";
import { resolvePreferredOmExpenseTotal } from "../om/authoritativeOm.js";
import { resolveCurrentFinancialsFromDetails } from "../rental/currentFinancials.js";
import { resolveProjectedResidentialLeaseUpRentSummary } from "./propertyAssumptions.js";
import { getPropertyDossierAssumptions } from "./propertyDossierState.js";
import { resolveAssetCapRateNoiBasis } from "./underwritingModel.js";

export function resolveReconstructedNoiBasisFromDetails(
  details: PropertyDetails | null | undefined
): number | null {
  const resolvedDetails = details ?? null;
  const extracted = resolveCurrentFinancialsFromDetails(resolvedDetails);
  const overrideRaw = getPropertyDossierAssumptions(resolvedDetails)?.currentNoi;
  const overrideNoi =
    typeof overrideRaw === "number" && Number.isFinite(overrideRaw) ? overrideRaw : null;
  const leaseUpRent = resolveProjectedResidentialLeaseUpRentSummary(resolvedDetails).totalAnnualRent;
  return resolveAssetCapRateNoiBasis({
    currentNoi: overrideNoi ?? extracted.noi,
    currentGrossRent: extracted.grossRentalIncome,
    currentOtherIncome: extracted.otherIncome,
    currentExpensesTotal: resolvePreferredOmExpenseTotal(resolvedDetails) ?? extracted.operatingExpenses,
    preferProvidedCurrentNoi: overrideNoi != null,
    conservativeProjectedLeaseUpRent: leaseUpRent != null && leaseUpRent > 0 ? leaseUpRent : null,
  });
}
