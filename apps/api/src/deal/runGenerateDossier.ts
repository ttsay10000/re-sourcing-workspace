/**
 * Orchestrate generate-dossier: load property/list/profile, run underwriting, build Excel + dossier, save to disk and DB.
 */

import type { PropertyDetails, OmAnalysis } from "@re-sourcing/contracts";
import { getPool, PropertyRepo, MatchRepo, ListingRepo, UserProfileRepo, DealSignalsRepo, DocumentRepo } from "@re-sourcing/db";
import { computeDealSignals } from "./computeDealSignals.js";
import { scoreDealWithLlm } from "./dealScoringLlm.js";
import { computeFurnishedRental } from "./furnishedRentalEstimator.js";
import { computeMortgage, computeAmortizationSchedule } from "./mortgageAmortization.js";
import { computeIrr, saleProceedsFromExitCap } from "./irrCalculation.js";
import type { GrossRentRow, ExpenseRow, DossierPropertyOverview } from "./underwritingContext.js";
import { buildExcelProForma } from "./excelProForma.js";
import { buildDossierStructuredText } from "./dossierGenerator.js";
import { buildDossierWithLlm } from "./dossierLlmGenerator.js";
import { dossierTextToPdf } from "./dossierToPdf.js";
import type { UnderwritingContext } from "./underwritingContext.js";
import { saveGeneratedDocument } from "./generatedDocStorage.js";
import { randomUUID } from "crypto";
import { sendMessageWithAttachments } from "../inquiry/gmailClient.js";
import { HOLD_YEARS } from "./constants.js";

export interface GenerateDossierResult {
  dossierDoc: { id: string; fileName: string; storagePath: string };
  excelDoc: { id: string; fileName: string; storagePath: string };
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
  if (omRoll.length > 0) return omRoll.length;
  if (omTotal != null && typeof omTotal === "number") return omTotal;
  const rapid = rf.rentalUnits ?? [];
  const om = rf.fromLlm?.rentalNumbersPerUnit ?? [];
  const n = rapid.length > 0 ? rapid.length : om.length;
  return n > 0 ? n : null;
}

function rentRollRowsFromOm(om: OmAnalysis | null, _currentGrossRent: number | null): GrossRentRow[] {
  if (!om?.rentRoll || !Array.isArray(om.rentRoll)) return [];
  const rows: GrossRentRow[] = [];
  for (const r of om.rentRoll) {
    const annual = (r as { annualRent?: number; monthlyRent?: number; rent?: number }).annualRent ??
      ((r as { monthlyRent?: number }).monthlyRent != null ? (r as { monthlyRent: number }).monthlyRent * 12 : null) ??
      ((r as { rent?: number }).rent != null ? (r as { rent: number }).rent * 12 : null);
    const label = (r as { unit?: string }).unit ?? `Unit ${rows.length + 1}`;
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

export async function runGenerateDossier(propertyId: string): Promise<GenerateDossierResult> {
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

  const ltvPct = profile.defaultLtv ?? 65;
  const interestRatePct = profile.defaultInterestRate ?? 6.5;
  const amortizationYears = profile.defaultAmortization ?? 30;
  const exitCapPct = profile.defaultExitCap ?? 5;
  const rentUpliftPct = profile.defaultRentUplift ?? 15;
  const expenseIncreasePct = profile.defaultExpenseIncrease ?? 2;
  const managementFeePct = profile.defaultManagementFee ?? 5;

  const rentUplift = 1 + (rentUpliftPct ?? 0) / 100;
  const expenseIncrease = 1 + (expenseIncreasePct ?? 0) / 100;
  const managementFee = (managementFeePct ?? 0) / 100;

  const furnishedRental =
    currentGrossRent != null && currentNoi != null && purchasePrice != null
      ? computeFurnishedRental(
          {
            currentGrossRent,
            currentNoi,
            rentUplift,
            expenseIncrease,
            managementFee,
          },
          purchasePrice
        )
      : null;

  const principal =
    purchasePrice != null && ltvPct != null && ltvPct > 0
      ? (purchasePrice * ltvPct) / 100
      : 0;
  const mortgage =
    principal > 0 && amortizationYears > 0
      ? computeMortgage({
          principal,
          annualRate: (interestRatePct ?? 0) / 100,
          amortizationYears,
        })
      : null;

  const adjustedNoi = furnishedRental?.adjustedNoi ?? currentNoi ?? 0;
  const annualCf = adjustedNoi - (mortgage?.annualDebtService ?? 0);
  const saleProceeds5 = saleProceedsFromExitCap(adjustedNoi, exitCapPct ?? 5);
  const saleProceeds3 = saleProceeds5;
  const equity = purchasePrice != null ? purchasePrice - principal : 0;
  const annualCashFlows5 = Array(HOLD_YEARS).fill(annualCf);
  const annualCashFlows3 = annualCashFlows5.slice(0, 3);
  const irr5 =
    equity > 0
      ? computeIrr({
          initialEquity: equity,
          annualCashFlows: annualCashFlows5,
          saleProceeds: saleProceeds5,
        })
      : null;
  const irr3 =
    equity > 0
      ? computeIrr({
          initialEquity: equity,
          annualCashFlows: annualCashFlows3,
          saleProceeds: saleProceeds3,
        })
      : null;
  const irr = irr5;

  const omAnalysis: OmAnalysis | null = details?.rentalFinancials?.omAnalysis ?? null;
  const rentRollRows = rentRollRowsFromOm(omAnalysis, currentGrossRent);
  const { rows: expenseRows, total: currentExpensesTotal } = expenseRowsFromOm(omAnalysis);
  const propertyOverview = propertyOverviewFromDetails(details);
  const financialFlags: string[] = [];
  if (purchasePrice != null) financialFlags.push(`Listed price: $${purchasePrice.toLocaleString("en-US", { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`);

  const assetCapRateForCtx =
    purchasePrice != null && currentNoi != null && currentNoi >= 0
      ? (currentNoi / purchasePrice) * 100
      : null;
  const adjustedNoiForCtx = furnishedRental?.adjustedNoi ?? currentNoi ?? null;
  const adjustedCapRateForCtx =
    purchasePrice != null && adjustedNoiForCtx != null && adjustedNoiForCtx >= 0
      ? (adjustedNoiForCtx / purchasePrice) * 100
      : null;

  const amortizationSchedule =
    mortgage && principal > 0 && amortizationYears > 0
      ? computeAmortizationSchedule(
          { principal, annualRate: (interestRatePct ?? 0) / 100, amortizationYears },
          HOLD_YEARS
        ).map((row) => ({
          year: row.year,
          principalPayment: row.principalPayment,
          interestPayment: row.interestPayment,
          debtService: row.debtService,
          endingBalance: row.endingBalance,
        }))
      : undefined;

  const expectedSalePriceAtExitCap =
    furnishedRental && (exitCapPct ?? 0) > 0
      ? furnishedRental.adjustedNoi / ((exitCapPct ?? 0) / 100)
      : null;
  const managementFeeAmount = furnishedRental
    ? (furnishedRental.adjustedGrossIncome * (managementFeePct ?? 0)) / 100
    : undefined;

  const ctx: UnderwritingContext = {
    propertyId,
    canonicalAddress: property.canonicalAddress,
    purchasePrice,
    listingCity,
    currentNoi,
    currentGrossRent,
    unitCount,
    dealScore: null,
    assetCapRate: assetCapRateForCtx,
    adjustedCapRate: adjustedCapRateForCtx,
    furnishedRental: furnishedRental
      ? {
          adjustedGrossIncome: furnishedRental.adjustedGrossIncome,
          adjustedExpenses: furnishedRental.adjustedExpenses,
          adjustedNoi: furnishedRental.adjustedNoi,
          adjustedCapRatePct: furnishedRental.adjustedCapRatePct,
          managementFeeAmount,
          expectedSalePriceAtExitCap: expectedSalePriceAtExitCap ?? undefined,
        }
      : null,
    mortgage: mortgage
      ? {
          principal,
          monthlyPayment: mortgage.monthlyPayment,
          annualDebtService: mortgage.annualDebtService,
        }
      : null,
    irr: irr
      ? {
          irrPct: irr.irr,
          equityMultiple: irr.equityMultiple,
          coc: irr.coc,
          irr3yrPct: irr3?.irr ?? undefined,
          irr5yrPct: irr5?.irr ?? undefined,
        }
      : null,
    assumptions: {
      ltvPct: profile.defaultLtv ?? null,
      interestRatePct: profile.defaultInterestRate ?? null,
      amortizationYears: profile.defaultAmortization ?? null,
      exitCapPct: profile.defaultExitCap ?? null,
      rentUpliftPct: profile.defaultRentUplift ?? null,
      expenseIncreasePct: profile.defaultExpenseIncrease ?? null,
      managementFeePct: profile.defaultManagementFee ?? null,
      expectedAppreciationPct: profile.expectedAppreciationPct ?? null,
    },
    projectedValueFromAppreciation:
      purchasePrice != null &&
      profile.expectedAppreciationPct != null &&
      !Number.isNaN(profile.expectedAppreciationPct)
        ? purchasePrice * Math.pow(1 + profile.expectedAppreciationPct / 100, HOLD_YEARS)
        : null,
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
  };

  const dateStr = new Date().toISOString().slice(0, 10);
  const slug = property.canonicalAddress.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40) || propertyId.slice(0, 8);
  const dossierFileName = `Deal-Dossier-${slug}-${dateStr}.pdf`;
  const excelFileName = `Pro-Forma-${slug}-${dateStr}.xlsx`;

  const neighborhoodContext = null;
  const llmDossierText = await buildDossierWithLlm(ctx, neighborhoodContext, omAnalysis);
  let dossierText = llmDossierText && llmDossierText.length > 0 ? llmDossierText : buildDossierStructuredText(ctx);

  const anyRentStab = detectRentStabilization(details, dossierText);
  const rentStabCount = rentStabilizedUnitCount(details, dossierText, anyRentStab);

  const hpd = details?.enrichment?.hpd_violations_summary;
  const dob = details?.enrichment?.dob_complaints_summary;
  const lit = details?.enrichment?.housing_litigations_summary;

  const llmInputs = {
    assetCapRatePct: assetCapRateForCtx,
    irr5yrPct: irr?.irr ?? null,
    cocPct: irr?.coc ?? null,
    rentStabilizedUnitCount: rentStabCount,
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
    primaryListing: { price: purchasePrice, city: listingCity },
    irr5yrPct: irr?.irr ?? null,
    rentStabilizedUnitCount: rentStabCount,
  });

  const finalScore = llmScore != null ? llmScore.dealScore : scoringResult.dealScore;
  ctx.dealScore = finalScore;
  insertParams.dealScore = finalScore;

  if (llmScore?.rationale?.trim()) financialFlags.push(llmScore.rationale);
  else if (scoringResult.negativeSignals.length > 0) financialFlags.push(scoringResult.negativeSignals[0]);
  else if (scoringResult.positiveSignals.length > 0) financialFlags.push(scoringResult.positiveSignals[0]);

  dossierText = llmDossierText && llmDossierText.length > 0
    ? dossierText.replace(/Deal score: —/i, `Deal score: ${ctx.dealScore}/100`)
    : buildDossierStructuredText(ctx);
  const dossierBuffer = await dossierTextToPdf(dossierText);
  const excelBuffer = buildExcelProForma(ctx);

  await signalsRepo.insert({
    ...insertParams,
    irrPct: irr?.irr ?? null,
    equityMultiple: irr?.equityMultiple ?? null,
    cocPct: irr?.coc ?? null,
    holdYears: HOLD_YEARS,
    currentNoi: currentNoi ?? null,
    adjustedNoi: furnishedRental?.adjustedNoi ?? currentNoi ?? null,
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
  });

  const excelDoc = await documentRepo.insert({
    propertyId,
    fileName: excelFileName,
    fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    source: "generated_excel",
    storagePath: excelStoragePath,
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
    emailSent,
  };
}
