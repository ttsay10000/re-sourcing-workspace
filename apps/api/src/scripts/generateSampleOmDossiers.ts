import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { OmAnalysis, PropertyDetails } from "@re-sourcing/contracts";
import { extractTextFromBuffer } from "../upload/extractTextFromUploadedFile.js";
import { extractRentalFinancialsFromText } from "../rental/extractRentalFinancialsFromListing.js";
import {
  computeRecommendedOffer,
  computeUnderwritingProjection,
  resolveDossierAssumptions,
} from "../deal/underwritingModel.js";
import { computeDealScore } from "../deal/dealScoringEngine.js";
import { buildSensitivityAnalyses } from "../deal/sensitivityAnalysis.js";
import { buildDossierStructuredText } from "../deal/dossierGenerator.js";
import { dossierTextToPdf } from "../deal/dossierToPdf.js";
import type { ExpenseRow, GrossRentRow, UnderwritingContext } from "../deal/underwritingContext.js";

interface SampleDefinition {
  slug: string;
  canonicalAddress: string;
  listingCity: string;
  pdfPath: string;
}

const SAMPLES: SampleDefinition[] = [
  {
    slug: "27-west-9th-street",
    canonicalAddress: "27 West 9th Street, Manhattan, NY 10011",
    listingCity: "Manhattan",
    pdfPath: "/Users/tylertsay/Downloads/27 West 9th Street Brochure (2).pdf",
  },
  {
    slug: "18-20-christopher-street",
    canonicalAddress: "18-20 Christopher Street, Manhattan, NY 10014",
    listingCity: "Manhattan",
    pdfPath: "/Users/tylertsay/Downloads/18-20 Christopher Street - Executive Summary (1)-compressed (1).pdf",
  },
];

function noiFromOm(om: OmAnalysis | null): number | null {
  const ui = om?.uiFinancialSummary as Record<string, unknown> | undefined;
  const income = om?.income as Record<string, unknown> | undefined;
  const noi = (ui?.noi as number | undefined) ?? om?.noiReported ?? (income?.NOI as number | undefined);
  return typeof noi === "number" && Number.isFinite(noi) ? noi : null;
}

function grossRentFromOm(om: OmAnalysis | null): number | null {
  const ui = om?.uiFinancialSummary as Record<string, unknown> | undefined;
  const income = om?.income as Record<string, unknown> | undefined;
  const gross =
    (ui?.grossRent as number | undefined) ??
    (income?.grossRentActual as number | undefined) ??
    (income?.grossRentPotential as number | undefined);
  return typeof gross === "number" && Number.isFinite(gross) ? gross : null;
}

function unitCountFromOm(om: OmAnalysis | null): number | null {
  const total = om?.propertyInfo?.totalUnits;
  if (typeof total === "number" && Number.isFinite(total)) return total;
  return Array.isArray(om?.rentRoll) && om?.rentRoll.length > 0 ? om.rentRoll.length : null;
}

function rentRollRowsFromOm(om: OmAnalysis | null): GrossRentRow[] {
  if (!Array.isArray(om?.rentRoll)) return [];
  return om.rentRoll
    .map((row, index) => {
      const annual =
        row.annualTotalRent ??
        row.annualBaseRent ??
        row.annualRent ??
        (row.monthlyTotalRent != null ? row.monthlyTotalRent * 12 : null) ??
        (row.monthlyBaseRent != null ? row.monthlyBaseRent * 12 : null) ??
        (row.monthlyRent != null ? row.monthlyRent * 12 : null);
      const label = [row.building, row.unit, row.unitCategory, row.notes]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" - ");
      return annual != null && Number.isFinite(annual)
        ? {
            label: label || `Unit ${index + 1}`,
            annualRent: annual,
          }
        : null;
    })
    .filter((row): row is GrossRentRow => row != null);
}

function expenseRowsFromOm(om: OmAnalysis | null): { rows: ExpenseRow[]; total: number | null } {
  const expenseBlock = om?.expenses;
  const rows = Array.isArray(expenseBlock?.expensesTable)
    ? expenseBlock.expensesTable
        .map((row) =>
          typeof row?.lineItem === "string" && typeof row?.amount === "number"
            ? { lineItem: row.lineItem, amount: row.amount }
            : null
        )
        .filter((row): row is ExpenseRow => row != null)
    : [];
  const total =
    typeof expenseBlock?.totalExpenses === "number" && Number.isFinite(expenseBlock.totalExpenses)
      ? expenseBlock.totalExpenses
      : rows.length > 0
        ? rows.reduce((sum, row) => sum + row.amount, 0)
        : null;
  return { rows, total };
}

function buildFinancialFlags(ctx: {
  purchasePrice: number | null;
  currentGrossRent: number | null;
  currentNoi: number | null;
  blendedRentUpliftPct: number;
  commercialUnits: number;
  rentStabilizedUnits: number;
  recommendedOfferHigh: number | null;
  discountToAskingPct: number | null;
  targetIrrPct: number;
}): string[] {
  const flags: string[] = [];
  if (ctx.purchasePrice != null) {
    flags.push(`Purchase price: $${ctx.purchasePrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
  }
  if (ctx.currentGrossRent == null || ctx.currentNoi == null) {
    flags.push(
      "Current rent and/or NOI could not be extracted from the PDF text alone; underwriting below is incomplete until richer OM parsing is available."
    );
  }
  if (ctx.commercialUnits > 0 || ctx.rentStabilizedUnits > 0) {
    const protectedParts: string[] = [];
    if (ctx.commercialUnits > 0) protectedParts.push(`${ctx.commercialUnits} commercial`);
    if (ctx.rentStabilizedUnits > 0) protectedParts.push(`${ctx.rentStabilizedUnits} rent-stabilized`);
    flags.push(
      `${protectedParts.join(" + ")} unit(s) excluded from residential uplift; blended uplift underwritten at ${ctx.blendedRentUpliftPct.toFixed(2)}%`
    );
  }
  if (ctx.recommendedOfferHigh != null) {
    flags.push(
      ctx.discountToAskingPct != null && ctx.discountToAskingPct > 0
        ? `Max recommended offer to hit ${ctx.targetIrrPct.toFixed(0)}% target IRR: $${ctx.recommendedOfferHigh.toLocaleString("en-US", { maximumFractionDigits: 0 })} (${ctx.discountToAskingPct.toFixed(1)}% below ask)`
        : `Asking price already clears the ${ctx.targetIrrPct.toFixed(0)}% target IRR`
    );
  }
  return flags;
}

async function generateSample(sample: SampleDefinition, outputDir: string) {
  const buffer = await readFile(sample.pdfPath);
  const extractedText = await extractTextFromBuffer(buffer, path.basename(sample.pdfPath));
  const extracted = await extractRentalFinancialsFromText(extractedText, {
    forceOmStyle: true,
    documentFiles: [
      {
        filename: path.basename(sample.pdfPath),
        mimeType: "application/pdf",
        buffer,
      },
    ],
  });

  const omAnalysis = extracted.omAnalysis ?? null;
  const details: PropertyDetails = {
    taxCode:
      typeof omAnalysis?.propertyInfo?.taxClass === "string" ? omAnalysis.propertyInfo.taxClass : undefined,
    rentalFinancials: {
      fromLlm: extracted.fromLlm ?? undefined,
      omAnalysis: omAnalysis ?? undefined,
      source: "llm",
      lastUpdatedAt: new Date().toISOString(),
    },
  };

  const purchasePrice =
    typeof omAnalysis?.propertyInfo?.price === "number" ? omAnalysis.propertyInfo.price : null;
  const currentNoi = noiFromOm(omAnalysis);
  const currentGrossRent = grossRentFromOm(omAnalysis);
  const unitCount = unitCountFromOm(omAnalysis);
  const assumptions = resolveDossierAssumptions(null, purchasePrice, null, { details });
  const projection = computeUnderwritingProjection({
    assumptions,
    currentGrossRent,
    currentNoi,
  });
  const hasCurrentFinancials = currentGrossRent != null && currentNoi != null;
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

  const assetCapRate =
    purchasePrice != null && currentNoi != null && purchasePrice > 0 ? (currentNoi / purchasePrice) * 100 : null;
  const adjustedCapRate =
    purchasePrice != null && purchasePrice > 0 && hasCurrentFinancials
      ? (projection.operating.stabilizedNoi / purchasePrice) * 100
      : null;
  const score = computeDealScore({
    purchasePrice,
    noi: currentNoi,
    irrPct: projection.returns.irr ?? null,
    cocPct: projection.returns.year1CashOnCashReturn ?? null,
    adjustedCapRatePct: adjustedCapRate,
    recommendedOfferHigh: recommendedOffer.recommendedOfferHigh,
    blendedRentUpliftPct: assumptions.operating.blendedRentUpliftPct,
    rentStabilizedUnitCount: assumptions.propertyMix.rentStabilizedUnits,
    commercialUnitCount: assumptions.propertyMix.commercialUnits,
  });

  const { rows: expenseRows, total: currentExpensesTotal } = expenseRowsFromOm(omAnalysis);
  const rentRollRows = rentRollRowsFromOm(omAnalysis);
  const financialFlags = buildFinancialFlags({
    purchasePrice,
    currentGrossRent,
    currentNoi,
    blendedRentUpliftPct: assumptions.operating.blendedRentUpliftPct,
    commercialUnits: assumptions.propertyMix.commercialUnits,
    rentStabilizedUnits: assumptions.propertyMix.rentStabilizedUnits,
    recommendedOfferHigh: recommendedOffer.recommendedOfferHigh,
    discountToAskingPct: recommendedOffer.discountToAskingPct,
    targetIrrPct: assumptions.targetIrrPct,
  });

  if (Array.isArray(omAnalysis?.investmentTakeaways)) {
    omAnalysis.investmentTakeaways.slice(0, 2).forEach((line) => financialFlags.push(line));
  }

  const ctx: UnderwritingContext = {
    propertyId: sample.slug,
    canonicalAddress: sample.canonicalAddress,
    purchasePrice,
    listingCity: sample.listingCity,
    currentNoi,
    currentGrossRent,
    unitCount,
    dealScore: score.isScoreable ? score.dealScore : null,
    assetCapRate,
    adjustedCapRate: score.isScoreable ? adjustedCapRate : null,
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
    rentRollRows: rentRollRows.length > 0 ? rentRollRows : undefined,
    expenseRows: expenseRows.length > 0 ? expenseRows : undefined,
    currentExpensesTotal: currentExpensesTotal ?? undefined,
    financialFlags,
    amortizationSchedule: projection.financing.amortizationSchedule,
    sensitivities,
    propertyMix: assumptions.propertyMix,
    recommendedOffer,
  };

  const dossierText = buildDossierStructuredText(ctx);
  const pdfBuffer = await dossierTextToPdf(dossierText);

  const jsonPath = path.join(outputDir, `${sample.slug}.json`);
  const txtPath = path.join(outputDir, `${sample.slug}.txt`);
  const pdfPath = path.join(outputDir, `${sample.slug}.pdf`);

  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        sample,
        extractedTextLength: extractedText.length,
        omAnalysis,
        assumptions,
        projection,
        recommendedOffer,
        dealScore: score,
      },
      null,
      2
    ),
    "utf-8"
  );
  await writeFile(txtPath, dossierText, "utf-8");
  await writeFile(pdfPath, pdfBuffer);

  return {
    slug: sample.slug,
    jsonPath,
    txtPath,
    pdfPath,
    extractedTextLength: extractedText.length,
    scoreable: score.isScoreable,
    dealScore: score.isScoreable ? score.dealScore : null,
    assetCapRate,
    adjustedCapRate,
    currentGrossRent,
    currentNoi,
    blendedRentUpliftPct: assumptions.operating.blendedRentUpliftPct,
    recommendedOfferHigh: recommendedOffer.recommendedOfferHigh,
    discountToAskingPct: recommendedOffer.discountToAskingPct,
  };
}

async function main() {
  const outputDir = process.argv[2] ?? `/tmp/re-sourcing-dossier-samples-${new Date().toISOString().slice(0, 10)}`;
  await mkdir(outputDir, { recursive: true });

  const summaries = [];
  for (const sample of SAMPLES) {
    summaries.push(await generateSample(sample, outputDir));
  }
  console.log(JSON.stringify({ outputDir, summaries }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
