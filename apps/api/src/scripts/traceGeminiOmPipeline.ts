import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

import { readFile } from "fs/promises";
import { getPool, MatchRepo, ListingRepo, PropertyRepo, PropertyUploadedDocumentRepo, UserProfileRepo } from "@re-sourcing/db";
import type { PropertyDetails } from "@re-sourcing/contracts";
import { listOmAutomationDocumentsForProperty } from "../om/ingestAuthoritativeOm.js";
import { resolveUploadedDocFilePath } from "../upload/uploadedDocStorage.js";
import { extractOmAnalysisFromGeminiPdfOnly } from "../om/extractOmAnalysisFromGeminiPdfOnly.js";
import type { OmInputDocument } from "../om/omAnalysisShared.js";
import { resolveCurrentFinancialsFromOmAnalysis } from "../rental/currentFinancials.js";
import { sanitizeExpenseTableRows, sanitizeOmRentRollRows } from "../rental/omAnalysisUtils.js";
import { getAuthoritativeOmSnapshot, resolvePreferredOmUnitCount } from "../om/authoritativeOm.js";
import {
  computeRecommendedOffer,
  computeUnderwritingProjection,
  resolveDossierAssumptions,
} from "../deal/underwritingModel.js";
import { buildSensitivityAnalyses } from "../deal/sensitivityAnalysis.js";
import { computeDealSignals } from "../deal/computeDealSignals.js";
import { buildDealScoreSensitivity } from "../deal/dealScoreSensitivity.js";
import { resolveDossierPackageContext, propertyOverviewFromDetails } from "../deal/dossierPropertyContext.js";
import { buildDossierStructuredText } from "../deal/dossierGenerator.js";
import { dossierTextToPdf } from "../deal/dossierToPdf.js";
import { buildExcelProForma } from "../deal/excelProForma.js";
import { analyzePropertyConditionReview } from "../deal/propertyConditionReview.js";
import type { UnderwritingContext } from "../deal/underwritingContext.js";
import {
  getPropertyDossierAssumptions,
  propertyAssumptionsToOverrides,
} from "../deal/propertyDossierState.js";

interface ParsedArgs {
  properties: string[];
}

interface TraceResult {
  propertyAddress: string;
  propertyId: string;
  documents: Array<{
    id: string;
    filename: string;
    category: string | null;
    source: string | null;
    bytes: number;
  }>;
  existingAuthoritativeSnapshot: {
    hasSnapshot: boolean;
    currentFinancials: Record<string, unknown> | null;
    validationFlagsCount: number;
  };
  geminiExtraction: {
    model: string;
    finishReason: string | null;
    hasOmAnalysis: boolean;
    propertyInfo: Record<string, unknown> | null;
    rentRollCount: number;
    expenseLineCount: number;
    currentFinancials: Record<string, unknown>;
    topLevelKeys: string[];
    nestedInSourceCoverage: string[];
  };
  simulatedAuthoritativeSnapshot: {
    propertyInfo: Record<string, unknown> | null;
    rentRollCount: number;
    expenseLineCount: number;
    currentFinancials: Record<string, unknown>;
  };
  underwriting: {
    assumptionsPurchasePrice: number | null;
    unitCount: number | null;
    currentGrossRent: number | null;
    currentNoi: number | null;
    currentExpensesTotal: number | null;
    stabilizedNoi: number | null;
    irrPct: number | null;
    cocPct: number | null;
    equityMultiple: number | null;
    recommendedOfferHigh: number | null;
  };
  scoring: {
    isScoreable: boolean;
    dealScore: number | null;
    assetCapRate: number | null;
    adjustedCapRate: number | null;
    confidenceScore: number | null;
    riskFlags: string[];
    capReasons: string[];
  };
  dossierRender: {
    textLength: number;
    pdfBytes: number;
    excelBytes: number;
  };
  issues: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { properties: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--property") {
      const value = argv[index + 1];
      if (!value) throw new Error("--property requires a canonical address");
      parsed.properties.push(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (parsed.properties.length === 0) {
    throw new Error("Provide at least one --property target.");
  }
  return parsed;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resolveCurrentExpensesTotal(details: PropertyDetails | null): number | null {
  const authoritative = getAuthoritativeOmSnapshot(details);
  const total = toFiniteNumber(authoritative?.expenses?.totalExpenses);
  if (total != null) return total;
  const rows = sanitizeExpenseTableRows(authoritative?.expenses?.expensesTable ?? []);
  return rows.length > 0 ? rows.reduce((sum, row) => sum + row.amount, 0) : null;
}

function resolveUnitCountFromSnapshot(details: PropertyDetails | null): number | null {
  return resolvePreferredOmUnitCount(details);
}

function rentRollRowsFromDetails(details: PropertyDetails | null) {
  const authoritative = getAuthoritativeOmSnapshot(details);
  const cleanRows = sanitizeOmRentRollRows(authoritative?.rentRoll ?? []);
  return cleanRows.flatMap((row, index) => {
    const annual =
      toFiniteNumber((row as { annualTotalRent?: unknown }).annualTotalRent) ??
      toFiniteNumber((row as { annualBaseRent?: unknown }).annualBaseRent) ??
      toFiniteNumber((row as { annualRent?: unknown }).annualRent) ??
      (() => {
        const monthly =
          toFiniteNumber((row as { monthlyTotalRent?: unknown }).monthlyTotalRent) ??
          toFiniteNumber((row as { monthlyBaseRent?: unknown }).monthlyBaseRent) ??
          toFiniteNumber((row as { monthlyRent?: unknown }).monthlyRent);
        return monthly != null ? monthly * 12 : null;
      })();
    if (annual == null) return [];
    const label =
      [
        (row as { building?: string }).building,
        (row as { unit?: string }).unit,
        (row as { tenantName?: string }).tenantName ?? `Unit ${index + 1}`,
      ]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" - ") || `Unit ${index + 1}`;
    return [{ label, annualRent: annual }];
  });
}

async function loadUploadedDocumentBuffer(propertyId: string, docId: string, filePath?: string | null) {
  const pool = getPool();
  const uploadedRepo = new PropertyUploadedDocumentRepo({ pool });
  const fromDb = await uploadedRepo.getFileContent(docId);
  if (fromDb && fromDb.length > 0) return fromDb;
  if (filePath) return readFile(resolveUploadedDocFilePath(filePath));
  throw new Error(`Unable to load uploaded document ${docId} for property ${propertyId}`);
}

function summarizeNestedGeminiFields(omAnalysis: Record<string, unknown> | null): string[] {
  const coverage = asRecord(omAnalysis?.sourceCoverage);
  if (!coverage) return [];
  const candidates = [
    "uiFinancialSummary",
    "investmentTakeaways",
    "recommendedOfferAnalysis",
    "dossierMemo",
  ];
  return candidates.filter((key) => coverage[key] != null);
}

async function traceProperty(canonicalAddress: string): Promise<TraceResult> {
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const matchRepo = new MatchRepo({ pool });
  const listingRepo = new ListingRepo({ pool });
  const profileRepo = new UserProfileRepo({ pool });

  const property = await propertyRepo.byCanonicalAddress(canonicalAddress);
  if (!property) throw new Error(`Property not found: ${canonicalAddress}`);

  const documents = await listOmAutomationDocumentsForProperty(property.id, pool);
  const inputDocs: OmInputDocument[] = [];
  const docSummaries: TraceResult["documents"] = [];
  for (const doc of documents) {
    const buffer =
      doc.origin === "uploaded_document"
        ? await loadUploadedDocumentBuffer(property.id, doc.id, doc.filePath)
        : null;
    if (!buffer) continue;
    inputDocs.push({
      filename: doc.filename,
      mimeType: doc.mimeType ?? "application/pdf",
      buffer,
    });
    docSummaries.push({
      id: doc.id,
      filename: doc.filename,
      category: doc.category ?? null,
      source: doc.source ?? null,
      bytes: buffer.length,
    });
  }

  const existingDetails = (property.details ?? null) as PropertyDetails | null;
  const existingSnapshot = getAuthoritativeOmSnapshot(existingDetails);
  const gemini = await extractOmAnalysisFromGeminiPdfOnly({
    documents: inputDocs,
    propertyContext: canonicalAddress,
  });
  if (!gemini.omAnalysis) {
    throw new Error(`Gemini returned no OM analysis for ${canonicalAddress}`);
  }

  const geminiOm = gemini.omAnalysis;
  const geminiCurrentFinancials = resolveCurrentFinancialsFromOmAnalysis(geminiOm, gemini.fromLlm ?? null);
  const simulatedDetails: PropertyDetails = {
    ...(existingDetails ?? {}),
    omData: {
      ...(existingDetails?.omData ?? {}),
      authoritative: {
        id: "simulated",
        runId: "simulated",
        sourceDocumentId: docSummaries[0]?.id ?? null,
        extractionMethod: "hybrid",
        propertyInfo: geminiOm.propertyInfo ?? null,
        rentRoll: geminiOm.rentRoll ?? null,
        incomeStatement: geminiOm.income ?? null,
        expenses: geminiOm.expenses ?? null,
        revenueComposition: geminiOm.revenueComposition ?? null,
        currentFinancials: {
          noi: geminiCurrentFinancials.noi,
          grossRentalIncome: geminiCurrentFinancials.grossRentalIncome,
          otherIncome: geminiCurrentFinancials.otherIncome,
          vacancyLoss: geminiCurrentFinancials.vacancyLoss,
          effectiveGrossIncome: geminiCurrentFinancials.effectiveGrossIncome,
          operatingExpenses: geminiCurrentFinancials.operatingExpenses,
        },
        coverage: (geminiOm.sourceCoverage as Record<string, unknown> | null | undefined) ?? null,
        validationFlags: [],
        investmentTakeaways: geminiOm.investmentTakeaways ?? null,
        reportedDiscrepancies: geminiOm.reportedDiscrepancies ?? null,
        sourceMeta: { provider: "gemini" },
        promotedAt: new Date().toISOString(),
      },
    },
    rentalFinancials: {
      ...(existingDetails?.rentalFinancials ?? {}),
      fromLlm: gemini.fromLlm ?? undefined,
      omAnalysis: geminiOm,
      lastUpdatedAt: new Date().toISOString(),
    },
  };

  await profileRepo.ensureDefault();
  const profile = await profileRepo.getDefault();
  if (!profile) throw new Error("Default profile not available");

  const { matches } = await matchRepo.list({ propertyId: property.id, limit: 1 });
  const listing = matches[0] ? await listingRepo.byId(matches[0].listingId) : null;
  const propertyAssumptionOverrides = propertyAssumptionsToOverrides(
    getPropertyDossierAssumptions(simulatedDetails)
  );
  const assumptions = resolveDossierAssumptions(profile, listing?.price ?? null, propertyAssumptionOverrides, {
    details: simulatedDetails,
  });

  const currentFinancials = geminiCurrentFinancials;
  const currentExpensesTotal = resolveCurrentExpensesTotal(simulatedDetails);
  const expenseRows = sanitizeExpenseTableRows(getAuthoritativeOmSnapshot(simulatedDetails)?.expenses?.expensesTable ?? [])
    .map((row) => ({ lineItem: row.lineItem, amount: row.amount }));
  const projection = computeUnderwritingProjection({
    assumptions,
    currentGrossRent: currentFinancials.grossRentalIncome,
    currentNoi: currentFinancials.noi,
    currentOtherIncome: currentFinancials.otherIncome,
    currentExpensesTotal,
    expenseRows,
  });
  const recommendedOffer = computeRecommendedOffer({
    assumptions,
    currentGrossRent: currentFinancials.grossRentalIncome,
    currentNoi: currentFinancials.noi,
    currentOtherIncome: currentFinancials.otherIncome,
    currentExpensesTotal,
    expenseRows,
  });
  const sensitivities = buildSensitivityAnalyses({
    assumptions,
    currentGrossRent: currentFinancials.grossRentalIncome,
    currentNoi: currentFinancials.noi,
    currentOtherIncome: currentFinancials.otherIncome,
    currentExpensesTotal,
    expenseRows,
    baseProjection: projection,
  });
  const adjustedCapRatePct =
    assumptions.acquisition.purchasePrice != null &&
    projection.operating.stabilizedNoi != null &&
    assumptions.acquisition.purchasePrice > 0
      ? (projection.operating.stabilizedNoi / assumptions.acquisition.purchasePrice) * 100
      : null;

  const scoringSensitivity = buildDealScoreSensitivity({
    propertyId: property.id,
    canonicalAddress: property.canonicalAddress,
    details: simulatedDetails,
    primaryListing: {
      price: assumptions.acquisition.purchasePrice,
      city: listing?.city ?? null,
      listedAt: listing?.listedAt ?? null,
      priceHistory: listing?.priceHistory ?? null,
    },
    assumptions,
    currentGrossRent: currentFinancials.grossRentalIncome,
    currentNoi: currentFinancials.noi,
    currentOtherIncome: currentFinancials.otherIncome,
    currentExpensesTotal: currentExpensesTotal ?? undefined,
    expenseRows,
    baseCalculatedScore: null,
  });
  const { scoringResult } = computeDealSignals({
    propertyId: property.id,
    canonicalAddress: property.canonicalAddress,
    details: simulatedDetails,
    primaryListing: {
      price: assumptions.acquisition.purchasePrice,
      city: listing?.city ?? null,
      listedAt: listing?.listedAt ?? null,
      priceHistory: listing?.priceHistory ?? null,
    },
    irrPct: projection.returns.irr ?? null,
    cocPct: projection.returns.averageCashOnCashReturn ?? null,
    equityMultiple: projection.returns.equityMultiple ?? null,
    adjustedCapRatePct,
    adjustedNoi: projection.operating.stabilizedNoi ?? null,
    recommendedOfferHigh: recommendedOffer.recommendedOfferHigh,
    blendedRentUpliftPct: assumptions.operating.blendedRentUpliftPct,
    annualExpenseGrowthPct: assumptions.operating.annualExpenseGrowthPct,
    vacancyPct: assumptions.operating.vacancyPct,
    exitCapRatePct: assumptions.exit.exitCapPct,
    rentStabilizedUnitCount: assumptions.propertyMix.rentStabilizedUnits,
    commercialUnitCount: assumptions.propertyMix.commercialUnits,
    scoreSensitivity: scoringSensitivity,
  });

  const packageContext = resolveDossierPackageContext(property.canonicalAddress, simulatedDetails);
  const conditionReview = await analyzePropertyConditionReview({
    canonicalAddress: property.canonicalAddress,
    listing,
    details: simulatedDetails,
    omAnalysis: null,
  });
  const assetCapRate =
    assumptions.acquisition.purchasePrice != null &&
    currentFinancials.noi != null &&
    assumptions.acquisition.purchasePrice > 0
      ? (currentFinancials.noi / assumptions.acquisition.purchasePrice) * 100
      : null;

  const ctx: UnderwritingContext = {
    propertyId: property.id,
    canonicalAddress: packageContext.dossierAddress,
    purchasePrice: assumptions.acquisition.purchasePrice,
    listingCity: listing?.city ?? null,
    currentNoi: currentFinancials.noi,
    currentGrossRent: currentFinancials.grossRentalIncome,
    currentOtherIncome: currentFinancials.otherIncome,
    unitCount: resolveUnitCountFromSnapshot(simulatedDetails),
    dealScore: scoringResult.isScoreable ? scoringResult.dealScore : null,
    assetCapRate,
    adjustedCapRate: adjustedCapRatePct,
    assumptions: {
      acquisition: assumptions.acquisition,
      financing: assumptions.financing,
      operating: assumptions.operating,
      holdPeriodYears: assumptions.holdPeriodYears,
      targetIrrPct: assumptions.targetIrrPct,
      exit: assumptions.exit,
    },
    acquisition: projection.acquisition,
    financing: {
      loanAmount: projection.financing.loanAmount,
      financingFees: projection.financing.financingFees,
      monthlyPayment: projection.financing.monthlyPayment,
      annualDebtService: projection.financing.annualDebtService,
      remainingLoanBalanceAtExit: projection.financing.remainingLoanBalanceAtExit,
      principalPaydownAtExit: projection.financing.principalPaydownAtExit,
    },
    operating: {
      ...projection.operating,
      currentOtherIncome: projection.operating.currentOtherIncome,
    },
    exit: {
      ...projection.exit,
      principalPaydownToDate: projection.exit.principalPaydownToDate,
    },
    cashFlows: {
      ...projection.cashFlows,
      annualPrincipalPaydown: projection.cashFlows.annualPrincipalPaydown,
      annualPrincipalPaydowns: projection.cashFlows.annualPrincipalPaydowns,
      annualEquityGain: projection.cashFlows.annualEquityGain,
      annualEquityGains: projection.cashFlows.annualEquityGains,
      annualUnleveredCashFlows: projection.cashFlows.annualUnleveredCashFlows,
      unleveredCashFlowSeries: projection.cashFlows.unleveredCashFlowSeries,
    },
    returns: {
      irrPct: projection.returns.irr,
      equityMultiple: projection.returns.equityMultiple,
      year1CashOnCashReturn: projection.returns.year1CashOnCashReturn,
      averageCashOnCashReturn: projection.returns.averageCashOnCashReturn,
      year1EquityYield: projection.returns.year1EquityYield,
      averageEquityYield: projection.returns.averageEquityYield,
    },
    propertyOverview: propertyOverviewFromDetails(simulatedDetails, packageContext) ?? undefined,
    rentRollRows: rentRollRowsFromDetails(simulatedDetails),
    expenseRows,
    currentExpensesTotal: currentExpensesTotal ?? undefined,
    financialFlags: [],
    amortizationSchedule: projection.financing.amortizationSchedule.map((row) => ({
      year: row.year,
      principalPayment: row.principalPayment,
      interestPayment: row.interestPayment,
      debtService: row.debtService,
      endingBalance: row.endingBalance,
    })),
    sensitivities,
    yearlyCashFlow: projection.yearly,
    propertyMix: assumptions.propertyMix,
    recommendedOffer,
    conditionReview,
  };
  const dossierText = buildDossierStructuredText(ctx);
  const dossierPdf = await dossierTextToPdf(dossierText);
  const excel = buildExcelProForma(ctx);

  const issues: string[] = [];
  const nestedKeys = summarizeNestedGeminiFields(geminiOm as Record<string, unknown>);
  if (nestedKeys.length > 0) {
    issues.push(`Gemini returned misplaced fields nested under sourceCoverage: ${nestedKeys.join(", ")}`);
  }
  if (currentFinancials.noi == null) {
    issues.push("Resolved current NOI is null after OM normalization.");
  }
  if (!scoringResult.isScoreable) {
    issues.push(`Deal score is not scoreable. Cap reasons: ${scoringResult.capReasons.join("; ") || "none"}`);
  }
  if (assumptions.propertyMix.totalUnits != null && ctx.rentRollRows && ctx.rentRollRows.length < assumptions.propertyMix.totalUnits) {
    issues.push(
      `Rent roll rows (${ctx.rentRollRows.length}) are fewer than expected total units (${assumptions.propertyMix.totalUnits}).`
    );
  }
  if (docSummaries.length === 0) {
    issues.push("No OM documents were loaded for Gemini parsing.");
  }

  return {
    propertyAddress: canonicalAddress,
    propertyId: property.id,
    documents: docSummaries,
    existingAuthoritativeSnapshot: {
      hasSnapshot: existingSnapshot != null,
      currentFinancials: existingSnapshot?.currentFinancials ? { ...existingSnapshot.currentFinancials } : null,
      validationFlagsCount: Array.isArray(existingSnapshot?.validationFlags) ? existingSnapshot.validationFlags.length : 0,
    },
    geminiExtraction: {
      model: gemini.model,
      finishReason: gemini.finishReason,
      hasOmAnalysis: gemini.omAnalysis != null,
      propertyInfo: geminiOm.propertyInfo ? { ...geminiOm.propertyInfo } as Record<string, unknown> : null,
      rentRollCount: Array.isArray(geminiOm.rentRoll) ? geminiOm.rentRoll.length : 0,
      expenseLineCount: Array.isArray(geminiOm.expenses?.expensesTable) ? geminiOm.expenses.expensesTable.length : 0,
      currentFinancials: { ...geminiCurrentFinancials },
      topLevelKeys: Object.keys(geminiOm),
      nestedInSourceCoverage: nestedKeys,
    },
    simulatedAuthoritativeSnapshot: {
      propertyInfo: asRecord(getAuthoritativeOmSnapshot(simulatedDetails)?.propertyInfo),
      rentRollCount: sanitizeOmRentRollRows(getAuthoritativeOmSnapshot(simulatedDetails)?.rentRoll ?? []).length,
      expenseLineCount: sanitizeExpenseTableRows(getAuthoritativeOmSnapshot(simulatedDetails)?.expenses?.expensesTable ?? []).length,
      currentFinancials: { ...geminiCurrentFinancials },
    },
    underwriting: {
      assumptionsPurchasePrice: assumptions.acquisition.purchasePrice,
      unitCount: ctx.unitCount,
      currentGrossRent: currentFinancials.grossRentalIncome,
      currentNoi: currentFinancials.noi,
      currentExpensesTotal,
      stabilizedNoi: projection.operating.stabilizedNoi ?? null,
      irrPct: projection.returns.irr ?? null,
      cocPct: projection.returns.averageCashOnCashReturn ?? null,
      equityMultiple: projection.returns.equityMultiple ?? null,
      recommendedOfferHigh: recommendedOffer.recommendedOfferHigh ?? null,
    },
    scoring: {
      isScoreable: scoringResult.isScoreable,
      dealScore: scoringResult.isScoreable ? scoringResult.dealScore : null,
      assetCapRate: scoringResult.assetCapRate ?? null,
      adjustedCapRate: scoringResult.adjustedCapRate ?? null,
      confidenceScore: scoringResult.confidenceScore ?? null,
      riskFlags: scoringResult.riskFlags,
      capReasons: scoringResult.capReasons,
    },
    dossierRender: {
      textLength: dossierText.length,
      pdfBytes: dossierPdf.length,
      excelBytes: excel.length,
    },
    issues,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const results: TraceResult[] = [];
  for (const property of args.properties) {
    console.log(`[traceGeminiOmPipeline] tracing ${property}`);
    results.push(await traceProperty(property));
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error("[traceGeminiOmPipeline]", err);
  process.exit(1);
});
