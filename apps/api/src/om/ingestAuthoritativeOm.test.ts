import { describe, expect, it } from "vitest";
import type { OmAnalysis, OmAuthoritativeSnapshot, PropertyDetails } from "@re-sourcing/contracts";
import {
  mergePropertyOmDetails,
  mergePropertyOmReviewDetails,
} from "./ingestAuthoritativeOm.js";

describe("OM authoritative review state", () => {
  it("marks a new extraction as pending review without replacing the active authoritative snapshot", () => {
    const existingAuthoritative: OmAuthoritativeSnapshot = {
      id: "active-snapshot-1",
      runId: "run-active",
      propertyInfo: { address: "123 Main Street" },
      promotedAt: "2026-05-01T00:00:00.000Z",
    };
    const details: PropertyDetails = {
      omData: {
        activeRunId: "run-active",
        activeSnapshotId: "active-snapshot-1",
        latestRunId: "run-active",
        status: "promoted",
        authoritative: existingAuthoritative,
      },
    };

    const merged = mergePropertyOmReviewDetails(details, {
      runId: "run-pending",
      extractedSnapshotId: "extracted-1",
      completedAt: "2026-05-27T12:00:00.000Z",
    });

    expect(merged.omData.status).toBe("needs_review");
    expect(merged.omData.latestRunId).toBe("run-pending");
    expect(merged.omData.pendingRunId).toBe("run-pending");
    expect(merged.omData.pendingSnapshotId).toBe("extracted-1");
    expect(merged.omData.activeRunId).toBe("run-active");
    expect(merged.omData.activeSnapshotId).toBe("active-snapshot-1");
    expect(merged.omData.authoritative).toBe(existingAuthoritative);
  });

  it("promotes a reviewed snapshot and persists the OM analysis payload for reload", () => {
    const snapshot: OmAuthoritativeSnapshot = {
      runId: "run-pending",
      propertyInfo: { address: "123 Main Street", totalUnits: 2 },
      rentRoll: [
        { unit: "1", monthlyRent: 2500, annualRent: 30000 },
        { unit: "2", monthlyRent: 3000, annualRent: 36000 },
      ],
      expenses: {
        expensesTable: [{ lineItem: "Taxes", amount: 12000 }],
        totalExpenses: 12000,
      },
      currentFinancials: {
        grossRentalIncome: 66000,
        operatingExpenses: 12000,
        noi: 54000,
      },
    };
    const omAnalysis: OmAnalysis = {
      propertyInfo: { address: "123 Main Street", totalUnits: 2 },
      rentRoll: snapshot.rentRoll,
      expenses: snapshot.expenses,
      investmentTakeaways: ["Reviewed upload"],
    };

    const merged = mergePropertyOmDetails(
      {
        omData: {
          status: "needs_review",
          pendingRunId: "run-pending",
          pendingSnapshotId: "extracted-1",
        },
      } as PropertyDetails,
      snapshot,
      omAnalysis,
      { noi: 54000, grossRentTotal: 66000, totalExpenses: 12000 },
      "authoritative-1",
      "run-pending",
      "2026-05-27T12:05:00.000Z"
    );

    expect(merged.omData.status).toBe("promoted");
    expect(merged.omData.activeRunId).toBe("run-pending");
    expect(merged.omData.activeSnapshotId).toBe("authoritative-1");
    expect(merged.omData.pendingRunId).toBeNull();
    expect(merged.omData.authoritative?.id).toBe("authoritative-1");
    expect(merged.omData.authoritative?.promotedAt).toBe("2026-05-27T12:05:00.000Z");
    expect(merged.rentalFinancials.omAnalysis).toEqual(omAnalysis);
    expect(merged.rentalFinancials.fromLlm?.noi).toBe(54000);
  });

  it("records preserved manual underwriting overrides for review on promotion", () => {
    const snapshot: OmAuthoritativeSnapshot = {
      runId: "run-pending",
      propertyInfo: { address: "123 Main Street", askingPrice: 1_100_000 },
      rentRoll: [{ unit: "1", monthlyRent: 2500, annualRent: 30000 }],
      expenses: {
        expensesTable: [{ lineItem: "Taxes", amount: 12000 }],
        totalExpenses: 12000,
      },
      currentFinancials: {
        grossRentalIncome: 66000,
        operatingExpenses: 12000,
        noi: 54000,
      },
    };
    const merged = mergePropertyOmDetails(
      {
        dealDossier: {
          assumptions: {
            purchasePrice: 1_000_000,
            currentNoi: 50_000,
            unitModelRows: [
              {
                rowId: "manual-unit",
                unitLabel: "Manual unit",
                underwrittenAnnualRent: 42_000,
              },
            ],
          },
        },
      } as PropertyDetails,
      snapshot,
      { propertyInfo: snapshot.propertyInfo, rentRoll: snapshot.rentRoll },
      null,
      "authoritative-1",
      "run-pending",
      "2026-05-27T12:05:00.000Z"
    );

    expect(merged.omData.manualOverrideReview).toMatchObject({
      status: "needs_review",
      runId: "run-pending",
      conflictCount: 3,
      preservedManualOverrideFields: ["purchasePrice", "currentNoi", "unitModelRows"],
    });
  });
});
