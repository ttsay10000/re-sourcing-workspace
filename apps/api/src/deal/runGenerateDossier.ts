/**
 * Orchestrate generate-dossier: load property/list/profile, run underwriting, build Excel + dossier, save to disk and DB.
 */

import type { PropertyDetails } from "@re-sourcing/contracts";
import { getPool, PropertyRepo, MatchRepo, ListingRepo, UserProfileRepo, DealSignalsRepo, DocumentRepo } from "@re-sourcing/db";
import { computeDealSignals } from "./computeDealSignals.js";
import { computeFurnishedRental } from "./furnishedRentalEstimator.js";
import { computeMortgage } from "./mortgageAmortization.js";
import { computeIrr, saleProceedsFromExitCap } from "./irrCalculation.js";
import { buildExcelProForma } from "./excelProForma.js";
import { buildDossierBuffer } from "./dossierGenerator.js";
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
  const noi = details?.rentalFinancials?.fromLlm?.noi;
  if (noi != null && typeof noi === "number" && !Number.isNaN(noi)) return noi;
  return null;
}

function grossRentFromDetails(details: PropertyDetails | null): number | null {
  const gross = details?.rentalFinancials?.fromLlm?.grossRentTotal;
  if (gross != null && typeof gross === "number" && !Number.isNaN(gross) && gross > 0) return gross;
  return null;
}

function unitCountFromDetails(details: PropertyDetails | null): number | null {
  if (!details?.rentalFinancials) return null;
  const rf = details.rentalFinancials;
  const rapid = rf.rentalUnits ?? [];
  const om = rf.fromLlm?.rentalNumbersPerUnit ?? [];
  const n = rapid.length > 0 ? rapid.length : om.length;
  return n > 0 ? n : null;
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
  const saleProceeds = saleProceedsFromExitCap(adjustedNoi, exitCapPct ?? 5);
  const equity = purchasePrice != null ? purchasePrice - principal : 0;
  const annualCashFlows = Array(HOLD_YEARS).fill(annualCf);
  const irr =
    equity > 0
      ? computeIrr({
          initialEquity: equity,
          annualCashFlows,
          saleProceeds,
        })
      : null;

  const { insertParams, scoringResult } = computeDealSignals({
    propertyId,
    canonicalAddress: property.canonicalAddress,
    details,
    primaryListing: { price: purchasePrice, city: listingCity },
    adjustedNoi: furnishedRental?.adjustedNoi ?? null,
    rentUpsidePct: rentUplift > 1 ? (rentUplift - 1) : null,
  });
  await signalsRepo.insert({
    ...insertParams,
    irrPct: irr?.irr ?? null,
    equityMultiple: irr?.equityMultiple ?? null,
    cocPct: irr?.coc ?? null,
    holdYears: HOLD_YEARS,
    currentNoi: currentNoi ?? null,
    adjustedNoi: furnishedRental?.adjustedNoi ?? currentNoi ?? null,
  });

  const ctx: UnderwritingContext = {
    propertyId,
    canonicalAddress: property.canonicalAddress,
    purchasePrice,
    listingCity,
    currentNoi,
    currentGrossRent,
    unitCount,
    dealScore: scoringResult.dealScore,
    assetCapRate: scoringResult.assetCapRate,
    adjustedCapRate: scoringResult.adjustedCapRate,
    furnishedRental: furnishedRental
      ? {
          adjustedGrossIncome: furnishedRental.adjustedGrossIncome,
          adjustedExpenses: furnishedRental.adjustedExpenses,
          adjustedNoi: furnishedRental.adjustedNoi,
          adjustedCapRatePct: furnishedRental.adjustedCapRatePct,
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
  };

  const dateStr = new Date().toISOString().slice(0, 10);
  const slug = property.canonicalAddress.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40) || propertyId.slice(0, 8);
  const dossierFileName = `Deal-Dossier-${slug}-${dateStr}.txt`;
  const excelFileName = `Pro-Forma-${slug}-${dateStr}.xlsx`;

  const dossierBuffer = buildDossierBuffer(ctx);
  const excelBuffer = buildExcelProForma(ctx);

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
    fileType: "text/plain",
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
          { filename: dossierFileName, buffer: dossierBuffer, mimeType: "text/plain" },
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
