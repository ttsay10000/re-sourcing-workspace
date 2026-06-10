/**
 * Rate normalization: every observation is reduced to the undiscounted
 * accommodation subtotal per night (taxes, cleaning/service/booking fees,
 * deposits, pet/utility/platform/insurance add-ons always excluded).
 *
 * Discount handling, per spec:
 * - Visible discount line → store effective + undiscounted + amount + label
 *   (normalizationStatus "discount_removed").
 * - No line items but a same-month 30-night ADR exists → estimate the
 *   undiscounted subtotal from it and flag "discount_estimated".
 * - Effective-only pricing (e.g. visible card price) → "effective_rate_only".
 */

import type {
  MonthlyRateObservation,
  QuoteSpec,
  RentalConfidence,
  RentalNormalizationStatus,
} from "@re-sourcing/contracts";
import { dominantMonth } from "./quoteSpecs.js";

export interface RawQuoteLineItems {
  /** Accommodation subtotal as charged (after visible discounts). */
  accommodationSubtotal?: number | null;
  /** Pre-discount accommodation subtotal when the source displays it. */
  accommodationSubtotalBeforeDiscount?: number | null;
  /** Negative or positive; stored as absolute value. */
  discountAmount?: number | null;
  discountLabels?: string[] | null;
  cleaningFee?: number | null;
  serviceFee?: number | null;
  taxes?: number | null;
  otherFees?: number | null;
  /** Displayed nightly rate when only card-level pricing is visible. */
  displayedAdr?: number | null;
  /** Displayed monthly rate when only card-level pricing is visible. */
  displayedMonthlyRate?: number | null;
  available?: boolean | null;
  rawText?: string | null;
}

export interface NormalizeQuoteInput {
  listingId: string;
  listingUrl: string;
  source: MonthlyRateObservation["source"];
  quoteSpec: QuoteSpec;
  line: RawQuoteLineItems;
  /** Same-month 30-night ADR for cautious discount estimation (Blueground). */
  thirtyNightAdrSameMonth?: number | null;
  scrapedAt?: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function positiveOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Normalize one quote into a MonthlyRateObservation (id left for storage).
 * Never throws: pricing that cannot be normalized comes back as a
 * pricing_unavailable observation so diagnostics keep the trail.
 */
export function normalizeQuote(input: NormalizeQuoteInput): Omit<MonthlyRateObservation, "id"> {
  const { quoteSpec, line } = input;
  const nights = quoteSpec.nights;
  const scrapedAt = input.scrapedAt ?? new Date().toISOString();

  const effectiveSubtotal =
    positiveOrNull(line.accommodationSubtotal) ??
    (positiveOrNull(line.displayedAdr) != null ? round2((line.displayedAdr as number) * nights) : null) ??
    (positiveOrNull(line.displayedMonthlyRate) != null && quoteSpec.quoteType === "calendar_month"
      ? positiveOrNull(line.displayedMonthlyRate)
      : positiveOrNull(line.displayedMonthlyRate) != null
        ? round2(((line.displayedMonthlyRate as number) / 30) * nights)
        : null);

  const base: Omit<MonthlyRateObservation, "id"> = {
    listingId: input.listingId,
    source: input.source,
    listingUrl: input.listingUrl,
    checkIn: quoteSpec.checkIn,
    checkOut: quoteSpec.checkOut,
    nights,
    calendarMonth: dominantMonth(quoteSpec.checkIn, quoteSpec.checkOut),
    quoteType: quoteSpec.quoteType,
    availabilityStatus: line.available === false ? "unavailable" : line.available === true ? "available" : "unknown",
    displayedAdr: positiveOrNull(line.displayedAdr),
    displayedMonthlyRate: positiveOrNull(line.displayedMonthlyRate),
    accommodationSubtotalEffective: null,
    accommodationSubtotalUndiscounted: null,
    effectiveAdr: null,
    undiscountedAdr: null,
    effectiveMonthlyEquivalent: null,
    undiscountedMonthlyEquivalent: null,
    discountAmount: null,
    discountLabels: line.discountLabels?.length ? line.discountLabels : null,
    feesExcluded: true,
    taxesExcluded: true,
    cleaningFee: positiveOrNull(line.cleaningFee),
    serviceFee: positiveOrNull(line.serviceFee),
    taxes: positiveOrNull(line.taxes),
    otherFees: positiveOrNull(line.otherFees),
    normalizationStatus: "pricing_unavailable",
    confidence: "low",
    rawText: line.rawText ?? null,
    scrapedAt,
  };

  if (effectiveSubtotal == null || nights <= 0) {
    return base;
  }

  const visibleDiscount = positiveOrNull(
    line.discountAmount != null ? Math.abs(line.discountAmount) : null
  );
  const statedUndiscounted = positiveOrNull(line.accommodationSubtotalBeforeDiscount);

  let undiscountedSubtotal: number | null = null;
  let discountAmount: number | null = null;
  let normalizationStatus: RentalNormalizationStatus;
  let confidence: RentalConfidence;

  const cameFromLineItems = positiveOrNull(line.accommodationSubtotal) != null;

  if (statedUndiscounted != null && statedUndiscounted > effectiveSubtotal) {
    undiscountedSubtotal = statedUndiscounted;
    discountAmount = round2(statedUndiscounted - effectiveSubtotal);
    normalizationStatus = "discount_removed";
    confidence = "high";
  } else if (visibleDiscount != null) {
    undiscountedSubtotal = round2(effectiveSubtotal + visibleDiscount);
    discountAmount = visibleDiscount;
    normalizationStatus = "discount_removed";
    confidence = cameFromLineItems ? "high" : "medium";
  } else if (
    input.thirtyNightAdrSameMonth != null &&
    Number.isFinite(input.thirtyNightAdrSameMonth) &&
    input.thirtyNightAdrSameMonth > 0 &&
    nights > 30
  ) {
    // Cautious estimate: assume the same-month 30-night ADR is the
    // undiscounted nightly price for the longer stay.
    const estimated = round2(input.thirtyNightAdrSameMonth * nights);
    if (estimated > effectiveSubtotal) {
      undiscountedSubtotal = estimated;
      discountAmount = round2(estimated - effectiveSubtotal);
      normalizationStatus = "discount_estimated";
      confidence = "medium";
    } else {
      undiscountedSubtotal = effectiveSubtotal;
      normalizationStatus = cameFromLineItems ? "subtotal_clean_no_fees_taxes" : "effective_rate_only";
      confidence = cameFromLineItems ? "high" : "medium";
    }
  } else if (cameFromLineItems) {
    undiscountedSubtotal = effectiveSubtotal;
    normalizationStatus = "subtotal_clean_no_fees_taxes";
    confidence = "high";
  } else {
    // Visible/card pricing only — usable, clearly labeled, never comp-clean.
    undiscountedSubtotal = effectiveSubtotal;
    normalizationStatus = "effective_rate_only";
    confidence = positiveOrNull(line.displayedMonthlyRate) != null ? "medium" : "low";
  }

  const effectiveAdr = round2(effectiveSubtotal / nights);
  const undiscountedAdr = round2(undiscountedSubtotal / nights);

  return {
    ...base,
    availabilityStatus: line.available === false ? "unavailable" : "available",
    accommodationSubtotalEffective: round2(effectiveSubtotal),
    accommodationSubtotalUndiscounted: round2(undiscountedSubtotal),
    effectiveAdr,
    undiscountedAdr,
    effectiveMonthlyEquivalent: round2(effectiveAdr * 30),
    undiscountedMonthlyEquivalent: round2(undiscountedAdr * 30),
    discountAmount,
    normalizationStatus,
    confidence,
  };
}
