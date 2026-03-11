/**
 * Orchestrate generate-dossier: load property/list/profile, run underwriting, build Excel + dossier, save to disk and DB.
 */

import type { PropertyDetails, OmAnalysis } from "@re-sourcing/contracts";
import { getPool, PropertyRepo, MatchRepo, ListingRepo, UserProfileRepo, DealSignalsRepo, DocumentRepo } from "@re-sourcing/db";
import { computeDealSignals } from "./computeDealSignals.js";
import { scoreDealWithLlm } from "./dealScoringLlm.js";
import type { GrossRentRow, ExpenseRow, DossierPropertyOverview } from "./underwritingContext.js";
import { buildExcelProForma } from "./excelProForma.js";
import { buildDossierStructuredText } from "./dossierGenerator.js";
import { buildDossierWithLlm } from "./dossierLlmGenerator.js";
import { formatDossierForPresentation } from "./dossierPresentationLlm.js";
import { dossierTextToPdf } from "./dossierToPdf.js";
import type { UnderwritingContext } from "./underwritingContext.js";
import { saveGeneratedDocument } from "./generatedDocStorage.js";
import { randomUUID } from "crypto";
import { sendMessageWithAttachments } from "../inquiry/gmailClient.js";
import {
  computeRecommendedOffer,
  computeUnderwritingProjection,
  resolveDossierAssumptions,
  type DossierAssumptionOverrides,
} from "./underwritingModel.js";
import { buildSensitivityAnalyses } from "./sensitivityAnalysis.js";

export interface GenerateDossierResult {
  dossierDoc: { id: string; fileName: string; storagePath: string };
  excelDoc: { id: string; fileName: string; storagePath: string };
  /** Deal score 0–100 (from LLM or fallback engine); included so UI can confirm it flowed through. */
  dealScore: number | null;
  /** True if email was sent to profile email with attachments. */
  emailSent?: boolean;
}

function noiFromDetails(details: PropertyDetails | null): number | null {
  const om = details?.rentalFinancials?.omAnalysis;
  const ui = om?.uiFinancialSummary as Record<string, unknown> | undefined;
  const income = om?.income as Record<string, unknown> | undefined;
  const noi =
    (ui?.noi as number | undefined) ??
    om?.noiReported ??
    (income?.NOI as number | undefined) ??
    details?.rentalFinancials?.fromLlm?.noi;
  if (noi != null && typeof noi === "number" && !Number.isNaN(noi)) return noi;
  return null;
}

function grossRentFromDetails(details: PropertyDetails | null): number | null {
  const om = details?.rentalFinancials?.omAnalysis;
  const ui = om?.uiFinancialSummary as Record<string, unknown> | undefined;
  const income = om?.income as Record<string, unknown> | undefined;
  const gross =
    (ui?.grossRent as number | undefined) ??
    (income?.grossRentActual as number | undefined) ??
    (income?.grossRentPotential as number | undefined) ??
    details?.rentalFinancials?.fromLlm?.grossRentTotal;
  if (gross != null && typeof gross === "number" && !Number.isNaN(gross) && gross > 0) return gross;
  return null;
}

function unitCountFromDetails(details: PropertyDetails | null): number | null {
  if (!details?.rentalFinancials) return null;
  const rf = details.rentalFinancials as { rentalUnits?: unknown[]; fromLlm?: { rentalNumbersPerUnit?: unknown[] }; omAnalysis?: { rentRoll?: unknown[]; propertyInfo?: Record<string, unknown> } };
  const omRoll = rf.omAnalysis?.rentRoll ?? [];
  const omTotal = rf.omAnalysis?.propertyInfo?.totalUnits as number | undefined;
  const rapid = rf.rentalUnits ?? [];
  const om = rf.fromLlm?.rentalNumbersPerUnit ?? [];
  const candidates = [
    omRoll.length > 0 ? omRoll.length : null,
    omTotal != null && Number.isFinite(omTotal) ? omTotal : null,
    rapid.length > 0 ? rapid.length : null,
    om.length > 0 ? om.length : null,
  ].filter((value): value is number => value != null && value > 0);
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function rentRollRowsFromOm(om: OmAnalysis | null, _currentGrossRent: number | null): GrossRentRow[] {
  if (!om?.rentRoll || !Array.isArray(om.rentRoll)) return [];
  const rows: GrossRentRow[] = [];
  for (const r of om.rentRoll) {
    const annual =
      (r as { annualTotalRent?: number; annualBaseRent?: number; annualRent?: number; monthlyTotalRent?: number; monthlyBaseRent?: number; monthlyRent?: number; rent?: number }).annualTotalRent ??
      (r as { annualBaseRent?: number }).annualBaseRent ??
      (r as { annualRent?: number }).annualRent ??
      ((r as { monthlyTotalRent?: number }).monthlyTotalRent != null
        ? (r as { monthlyTotalRent: number }).monthlyTotalRent * 12
        : null) ??
      ((r as { monthlyBaseRent?: number }).monthlyBaseRent != null
        ? (r as { monthlyBaseRent: number }).monthlyBaseRent * 12
        : null) ??
      ((r as { monthlyRent?: number }).monthlyRent != null ? (r as { monthlyRent: number }).monthlyRent * 12 : null) ??
      ((r as { rent?: number }).rent != null ? (r as { rent: number }).rent * 12 : null);
    const parts: string[] = [];
    const building = (r as { building?: string }).building;
    if (building) parts.push(building);
    const unit = (r as { unit?: string }).unit;
    const tenantName = (r as { tenantName?: string }).tenantName;
    parts.push(unit ?? tenantName ?? `Unit ${rows.length + 1}`);
    const qualifiers = [
      (r as { unitCategory?: string }).unitCategory,
      (r as { leaseType?: string }).leaseType,
      (r as { leaseEndDate?: string }).leaseEndDate ? `Lease ends ${(r as { leaseEndDate: string }).leaseEndDate}` : null,
      (r as { notes?: string }).notes,
    ].filter((value): value is string => typeof value === "string" && value.trim() !== "");
    const label = qualifiers.length > 0 ? `${parts.join(" - ")} (${qualifiers.join("; ")})` : parts.join(" - ");
    if (annual != null && !Number.isNaN(annual)) rows.push({ label, annualRent: annual });
  }
  return rows;
}

function expenseRowsFromOm(om: OmAnalysis | null): { rows: ExpenseRow[]; total: number } {
  const exp = om?.expenses as { expensesTable?: Array<{ lineItem: string; amount: number }>; totalExpenses?: number } | undefined;
  const table = exp?.expensesTable;
  if (!table || !Array.isArray(table)) return { rows: [], total: exp?.totalExpenses ?? 0 };
  const rows: ExpenseRow[] = table.map((e) => ({ lineItem: e.lineItem ?? "—", amount: typeof e.amount === "number" ? e.amount : 0 }));
  const total = exp?.totalExpenses ?? rows.reduce((s, e) => s + e.amount, 0);
  return { rows, total };
}

function propertyOverviewFromDetails(details: PropertyDetails | null): DossierPropertyOverview | null {
  if (!details) return null;
  const taxCode = details.taxCode != null && String(details.taxCode).trim() !== "" ? String(details.taxCode).trim() : null;
  const bblRaw = details.bbl ?? details.buildingLotBlock ?? null;
  const bbl = bblRaw != null && typeof bblRaw === "string" ? bblRaw : undefined;
  const hpd = details.enrichment?.hpdRegistration as { registrationId?: string; lastRegistrationDate?: string; registration_id?: string; last_registration_date?: string } | undefined;
  const hpdRegistrationId = hpd?.registrationId ?? hpd?.registration_id ?? null;
  const hpdRegistrationDate = hpd?.lastRegistrationDate ?? hpd?.last_registration_date ?? null;
  if (!taxCode && !hpdRegistrationId && !hpdRegistrationDate && !bbl) return null;
  return { taxCode: taxCode ?? undefined, hpdRegistrationId: hpdRegistrationId ?? undefined, hpdRegistrationDate: hpdRegistrationDate ?? undefined, bbl };
}

function omRevenueMixFlag(om: OmAnalysis | null): string | null {
  const propertyInfo = om?.propertyInfo as Record<string, unknown> | undefined;
  const revenue = om?.revenueComposition as Record<string, unknown> | undefined;
  const unitsResidential = typeof propertyInfo?.unitsResidential === "number" ? propertyInfo.unitsResidential : null;
  const unitsCommercial = typeof propertyInfo?.unitsCommercial === "number" ? propertyInfo.unitsCommercial : null;
  const commercialMonthly = typeof revenue?.commercialMonthlyRent === "number" ? revenue.commercialMonthlyRent : null;
  const totalMonthly =
    typeof revenue?.residentialMonthlyRent === "number" || commercialMonthly != null
      ? ((revenue?.residentialMonthlyRent as number | undefined) ?? 0) + (commercialMonthly ?? 0)
      : null;
  const commercialShare =
    typeof revenue?.commercialRevenueShare === "number"
      ? revenue.commercialRevenueShare
      : totalMonthly && commercialMonthly != null && totalMonthly > 0
        ? commercialMonthly / totalMonthly
        : null;
  const parts: string[] = [];
  if (unitsResidential != null || unitsCommercial != null) {
    parts.push(
      `Mixed-use: ${unitsResidential ?? "—"} residential / ${unitsCommercial ?? "—"} commercial`
    );
  }
  if (commercialMonthly != null) {
    const shareLabel =
      commercialShare != null
        ? ` (${(commercialShare > 1 ? commercialShare : commercialShare * 100).toFixed(1)}% of monthly rent)`
        : "";
    parts.push(`Commercial rent: $${commercialMonthly.toLocaleString("en-US", { maximumFractionDigits: 0 })}/mo${shareLabel}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

function omDiscrepancyFlag(om: OmAnalysis | null): string | null {
  const discrepancies = om?.reportedDiscrepancies;
  if (!Array.isArray(discrepancies) || discrepancies.length === 0) return null;
  const first = discrepancies[0] as { field?: unknown; reportedValues?: unknown; selectedValue?: unknown };
  const field = typeof first.field === "string" ? first.field : "OM data";
  const values = Array.isArray(first.reportedValues)
    ? first.reportedValues.filter((v): v is string => typeof v === "string" && v.trim() !== "").slice(0, 2)
    : [];
  const selected = typeof first.selectedValue === "string" ? first.selectedValue : null;
  const reported = values.length > 0 ? values.join(" vs ") : "conflicting values";
  return `Verify ${field}: ${reported}${selected ? `; underwriting uses ${selected}` : ""}`;
}

const RENT_STAB_PATTERN = /rent\s+stabiliz/i;

/** Detect rent stabilization from OM (investment takeaways, dossier memo) or dossier text. */
function detectRentStabilization(
  details: PropertyDetails | null,
  dossierText?: string | null
): boolean {
  const om = details?.rentalFinancials?.omAnalysis;
  if (om) {
    const takeaways = om.investmentTakeaways ?? [];
    for (const t of takeaways) {
      if (typeof t === "string" && RENT_STAB_PATTERN.test(t)) return true;
    }
    const memo = om.dossierMemo;
    if (memo && typeof memo === "object") {
      for (const v of Object.values(memo)) {
        if (typeof v === "string" && RENT_STAB_PATTERN.test(v)) return true;
      }
    }
  }
  if (dossierText && RENT_STAB_PATTERN.test(dossierText)) return true;
  return false;
}

/** Count rent-stabilized units from OM rent roll (notes) or return 1 if any rent stab detected, else 0. */
function rentStabilizedUnitCount(
  details: PropertyDetails | null,
  _dossierText: string | null,
  anyRentStab: boolean
): number {
  const om = details?.rentalFinancials?.omAnalysis;
  const roll = om?.rentRoll;
  if (Array.isArray(roll)) {
    let n = 0;
    for (const r of roll) {
      const notes = (r as { notes?: string }).notes;
      if (typeof notes === "string" && RENT_STAB_PATTERN.test(notes)) n++;
    }
    if (n > 0) return n;
  }
  return anyRentStab ? 1 : 0;
}

export async function runGenerateDossier(
  propertyId: string,
  assumptionOverrides?: DossierAssumptionOverrides | null
): Promise<GenerateDossierResult> {
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const matchRepo = new MatchRepo({ pool });
  const listingRepo = new ListingRepo({ pool });
  const profileRepo = new UserProfileRepo({ pool });
  const signalsRepo = new DealSignalsRepo({ pool });
  const documentRepo = new DocumentRepo({ pool });

  const property = await propertyRepo.byId(propertyId);
  if (!property) throw new Error("Property not found");

  const { matches } = await matchRepo.list({ propertyId, limit: 1 });
  const listing = matches[0] ? await listingRepo.byId(matches[0].listingId) : null;
  const purchasePrice = listing?.price ?? null;
  const listingCity = listing?.city ?? null;

  await profileRepo.ensureDefault();
  const profile = await profileRepo.getDefault();
  if (!profile) throw new Error("Profile not available");

  const details = property.details as PropertyDetails | null;
  const currentNoi = noiFromDetails(details);
  const currentGrossRent = grossRentFromDetails(details) ?? (currentNoi != null ? currentNoi * 1.5 : null);
  const unitCount = unitCountFromDetails(details);
  const assumptions = resolveDossierAssumptions(profile, purchasePrice, assumptionOverrides, {
    details,
  });
  const projection = computeUnderwritingProjection({
    assumptions,
    currentGrossRent,
    currentNoi,
  });
  const recommendedOffer = computeRecommendedOffer({
    assumptions,
    currentGrossRent,
    currentNoi,
  });
  const sensitivities = buildSensitivityAnalyses({
    assumptions,
    currentGrossRent,
    currentNoi,
    baseProjection: projection,
  });

  const omAnalysis: OmAnalysis | null = details?.rentalFinancials?.omAnalysis ?? null;
  const rentRollRows = rentRollRowsFromOm(omAnalysis, currentGrossRent);
  const { rows: expenseRows, total: currentExpensesTotal } = expenseRowsFromOm(omAnalysis);
  const propertyOverview = propertyOverviewFromDetails(details);
  const financialFlags: string[] = [];
  const hasCurrentFinancials = currentGrossRent != null && currentNoi != null;
  if (assumptions.acquisition.purchasePrice != null) {
    financialFlags.push(
      `Purchase price: $${assumptions.acquisition.purchasePrice.toLocaleString("en-US", {
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
      })}`
    );
  }
  if (!hasCurrentFinancials) {
    financialFlags.push(
      "Current rent and/or NOI could not be extracted from the OM text alone; pricing and underwriting are incomplete until a fuller rent roll or operating statement is parsed."
    );
  }
  if (
    assumptions.propertyMix.commercialUnits > 0 ||
    assumptions.propertyMix.rentStabilizedUnits > 0
  ) {
    const protectedParts: string[] = [];
    if (assumptions.propertyMix.commercialUnits > 0) {
      protectedParts.push(`${assumptions.propertyMix.commercialUnits} commercial`);
    }
    if (assumptions.propertyMix.rentStabilizedUnits > 0) {
      protectedParts.push(`${assumptions.propertyMix.rentStabilizedUnits} rent-stabilized`);
    }
    financialFlags.push(
      `${protectedParts.join(" + ")} unit(s) excluded from residential uplift; blended rent uplift underwritten at ${assumptions.operating.blendedRentUpliftPct.toFixed(2)}%`
    );
  }
  if (recommendedOffer.recommendedOfferHigh != null) {
    financialFlags.push(
      recommendedOffer.discountToAskingPct != null && recommendedOffer.discountToAskingPct > 0
        ? `Max recommended offer to hit ${recommendedOffer.targetIrrPct.toFixed(0)}% target IRR: $${recommendedOffer.recommendedOfferHigh.toLocaleString("en-US", { maximumFractionDigits: 0 })} (${recommendedOffer.discountToAskingPct.toFixed(1)}% below ask)`
        : `Asking price already clears the ${recommendedOffer.targetIrrPct.toFixed(0)}% target IRR`
    );
  }
  const revenueMixFlag = omRevenueMixFlag(omAnalysis);
  if (revenueMixFlag) financialFlags.push(revenueMixFlag);
  const discrepancyFlag = omDiscrepancyFlag(omAnalysis);
  if (discrepancyFlag) financialFlags.push(discrepancyFlag);

  const assetCapRateForCtx =
    assumptions.acquisition.purchasePrice != null && currentNoi != null && currentNoi >= 0
      ? (currentNoi / assumptions.acquisition.purchasePrice) * 100
      : null;
  const adjustedNoiForCtx = projection.operating.stabilizedNoi;
  const adjustedCapRateForCtx =
    assumptions.acquisition.purchasePrice != null && hasCurrentFinancials && adjustedNoiForCtx >= 0
      ? (adjustedNoiForCtx / assumptions.acquisition.purchasePrice) * 100
      : null;

  const amortizationSchedule =
    projection.financing.amortizationSchedule.length > 0
      ? projection.financing.amortizationSchedule.map((row) => ({
          year: row.year,
          principalPayment: row.principalPayment,
          interestPayment: row.interestPayment,
          debtService: row.debtService,
          endingBalance: row.endingBalance,
        }))
      : undefined;

  const ctx: UnderwritingContext = {
    propertyId,
    canonicalAddress: property.canonicalAddress,
    purchasePrice: assumptions.acquisition.purchasePrice,
    listingCity,
    currentNoi,
    currentGrossRent,
    unitCount,
    dealScore: null,
    assetCapRate: assetCapRateForCtx,
    adjustedCapRate: adjustedCapRateForCtx,
    assumptions: {
      acquisition: {
        purchasePrice: assumptions.acquisition.purchasePrice,
        purchaseClosingCostPct: assumptions.acquisition.purchaseClosingCostPct,
        renovationCosts: assumptions.acquisition.renovationCosts,
        furnishingSetupCosts: assumptions.acquisition.furnishingSetupCosts,
      },
      financing: {
        ltvPct: assumptions.financing.ltvPct,
        interestRatePct: assumptions.financing.interestRatePct,
        amortizationYears: assumptions.financing.amortizationYears,
      },
      operating: {
        rentUpliftPct: assumptions.operating.rentUpliftPct,
        blendedRentUpliftPct: assumptions.operating.blendedRentUpliftPct,
        expenseIncreasePct: assumptions.operating.expenseIncreasePct,
        managementFeePct: assumptions.operating.managementFeePct,
      },
      holdPeriodYears: assumptions.holdPeriodYears,
      targetIrrPct: assumptions.targetIrrPct,
      exit: {
        exitCapPct: assumptions.exit.exitCapPct,
        exitClosingCostPct: assumptions.exit.exitClosingCostPct,
      },
    },
    acquisition: projection.acquisition,
    financing: {
      loanAmount: projection.financing.loanAmount,
      monthlyPayment: projection.financing.monthlyPayment,
      annualDebtService: projection.financing.annualDebtService,
      remainingLoanBalanceAtExit: projection.financing.remainingLoanBalanceAtExit,
    },
    operating: projection.operating,
    exit: projection.exit,
    cashFlows: projection.cashFlows,
    returns: {
      irrPct: projection.returns.irr,
      equityMultiple: projection.returns.equityMultiple,
      year1CashOnCashReturn: projection.returns.year1CashOnCashReturn,
      averageCashOnCashReturn: projection.returns.averageCashOnCashReturn,
    },
    propertyOverview: propertyOverview ?? undefined,
    rentRollRows: rentRollRows.length > 0 ? rentRollRows : undefined,
    expenseRows: expenseRows.length > 0 ? expenseRows : undefined,
    currentExpensesTotal:
      currentExpensesTotal > 0
        ? currentExpensesTotal
        : currentGrossRent != null && currentNoi != null
          ? currentGrossRent - currentNoi
          : undefined,
    financialFlags: financialFlags.length > 0 ? financialFlags : undefined,
    amortizationSchedule,
    sensitivities,
    propertyMix: assumptions.propertyMix,
    recommendedOffer,
  };

  const dateStr = new Date().toISOString().slice(0, 10);
  const slug = property.canonicalAddress.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40) || propertyId.slice(0, 8);
  const dossierFileName = `Deal-Dossier-${slug}-${dateStr}.pdf`;
  const excelFileName = `Pro-Forma-${slug}-${dateStr}.xlsx`;

  const neighborhoodContext = null;
  // Content: dossier LLM is the single source; all calculations are in the prompt and must appear in output. Fallback to template only when LLM returns empty.
  const llmDossierText = await buildDossierWithLlm(ctx, neighborhoodContext, omAnalysis);
  let dossierText = llmDossierText && llmDossierText.length > 0 ? llmDossierText : buildDossierStructuredText(ctx);

  const anyRentStab = detectRentStabilization(details, dossierText);
  const rentStabCount = Math.max(
    assumptions.propertyMix.rentStabilizedUnits,
    rentStabilizedUnitCount(details, dossierText, anyRentStab)
  );

  const hpd = details?.enrichment?.hpd_violations_summary;
  const dob = details?.enrichment?.dob_complaints_summary;
  const lit = details?.enrichment?.housing_litigations_summary;

  const llmInputs = {
    assetCapRatePct: assetCapRateForCtx,
    adjustedCapRatePct: adjustedCapRateForCtx,
    irrPct: projection.returns.irr ?? null,
    cocPct: projection.returns.year1CashOnCashReturn ?? null,
    holdPeriodYears: assumptions.holdPeriodYears,
    targetIrrPct: assumptions.targetIrrPct,
    recommendedOfferLow: recommendedOffer.recommendedOfferLow,
    recommendedOfferHigh: recommendedOffer.recommendedOfferHigh,
    requiredDiscountPct: recommendedOffer.discountToAskingPct,
    rentStabilizedUnitCount: rentStabCount,
    commercialUnitCount: assumptions.propertyMix.commercialUnits,
    blendedRentUpliftPct: assumptions.operating.blendedRentUpliftPct,
    hpdTotal: hpd?.total,
    hpdOpenCount: hpd?.openCount,
    hpdRentImpairingOpen: hpd?.rentImpairingOpen,
    dobOpenCount: dob?.openCount,
    dobCount30: dob?.count30,
    dobCount365: dob?.count365,
    dobTopCategories: dob?.topCategories,
    litigationTotal: lit?.total,
    litigationOpenCount: lit?.openCount,
    litigationTotalPenalty: lit?.totalPenalty,
    address: property.canonicalAddress,
    riskBullets: [
      ...(omAnalysis?.investmentTakeaways ?? []).slice(0, 5).filter((t): t is string => typeof t === "string"),
      ...financialFlags,
    ],
  };

  const llmScore = await scoreDealWithLlm(llmInputs);
  const { insertParams, scoringResult } = computeDealSignals({
    propertyId,
    canonicalAddress: property.canonicalAddress,
    details,
    primaryListing: { price: assumptions.acquisition.purchasePrice, city: listingCity },
    irrPct: projection.returns.irr ?? null,
    cocPct: projection.returns.year1CashOnCashReturn ?? null,
    adjustedCapRatePct: adjustedCapRateForCtx,
    recommendedOfferHigh: recommendedOffer.recommendedOfferHigh,
    blendedRentUpliftPct: assumptions.operating.blendedRentUpliftPct,
    rentStabilizedUnitCount: rentStabCount,
    commercialUnitCount: assumptions.propertyMix.commercialUnits,
  });

  // Canonical deal score: from LLM (when available) or fallback engine. Persisted to deal_signals and shown on dossier, property cards, and property data.
  const finalScore = llmScore != null ? llmScore.dealScore : (scoringResult.isScoreable ? scoringResult.dealScore : null);
  ctx.dealScore = finalScore;
  insertParams.dealScore = finalScore;

  if (llmScore?.rationale?.trim()) financialFlags.push(llmScore.rationale);
  else if (scoringResult.negativeSignals.length > 0) financialFlags.push(scoringResult.negativeSignals[0]);
  else if (scoringResult.positiveSignals.length > 0) financialFlags.push(scoringResult.positiveSignals[0]);

  if (!llmDossierText || llmDossierText.length === 0) dossierText = buildDossierStructuredText(ctx);
  dossierText = dossierText.replace(
    /^Deal score: .*$/im,
    ctx.dealScore != null ? `Deal score: ${ctx.dealScore}/100` : "Deal score: —"
  );
  // Presentation LLM: ensure tables, bullets, and spacing are correct for strong PDF UI
  const formattedForPdf = await formatDossierForPresentation(dossierText);
  const dossierBuffer = await dossierTextToPdf(formattedForPdf);
  const excelBuffer = buildExcelProForma(ctx);

  await signalsRepo.insert({
    ...insertParams,
    irrPct: projection.returns.irr ?? null,
    equityMultiple: projection.returns.equityMultiple ?? null,
    cocPct: projection.returns.year1CashOnCashReturn ?? null,
    holdYears: assumptions.holdPeriodYears,
    currentNoi: currentNoi ?? null,
    adjustedNoi: projection.operating.stabilizedNoi ?? currentNoi ?? null,
  });

  const dossierDocId = randomUUID();
  const excelDocId = randomUUID();

  const dossierStoragePath = await saveGeneratedDocument(
    propertyId,
    dossierDocId,
    dossierFileName,
    dossierBuffer
  );
  const excelStoragePath = await saveGeneratedDocument(
    propertyId,
    excelDocId,
    excelFileName,
    excelBuffer
  );

  const dossierDoc = await documentRepo.insert({
    propertyId,
    fileName: dossierFileName,
    fileType: "application/pdf",
    source: "generated_dossier",
    storagePath: dossierStoragePath,
    fileContent: dossierBuffer,
  });

  const excelDoc = await documentRepo.insert({
    propertyId,
    fileName: excelFileName,
    fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    source: "generated_excel",
    storagePath: excelStoragePath,
    fileContent: excelBuffer,
  });

  let emailSent = false;
  const toEmail = profile.email?.trim();
  if (toEmail && dossierBuffer.length > 0 && excelBuffer.length > 0) {
    try {
      await sendMessageWithAttachments(
        toEmail,
        `Deal dossier: ${property.canonicalAddress}`,
        `Your deal dossier and Excel pro forma for ${property.canonicalAddress} are attached.`,
        [
          { filename: dossierFileName, buffer: dossierBuffer, mimeType: "application/pdf" },
          { filename: excelFileName, buffer: excelBuffer, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        ]
      );
      emailSent = true;
    } catch (err) {
      console.error("[runGenerateDossier] Failed to send email:", err);
    }
  }

  return {
    dossierDoc: {
      id: dossierDoc.id,
      fileName: dossierDoc.fileName,
      storagePath: dossierDoc.storagePath,
    },
    excelDoc: {
      id: excelDoc.id,
      fileName: excelDoc.fileName,
      storagePath: excelDoc.storagePath,
    },
    dealScore: finalScore,
    emailSent,
  };
}
