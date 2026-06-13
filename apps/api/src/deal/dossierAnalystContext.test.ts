import { describe, expect, it } from "vitest";
import type { ListingRow, PropertyDetails } from "@re-sourcing/contracts";
import { buildDossierAnalystContext } from "./dossierAnalystContext.js";
import type { UnderwritingContext } from "./underwritingContext.js";

describe("buildDossierAnalystContext", () => {
  it("extracts listing, internal market, approved comp, and retail-footprint cues without external sources", () => {
    const listing = {
      title: "Mixed-use value-add with ground floor retail",
      description:
        "Delivered vacant value-add opportunity with renovated apartments, roof deck, and ground-floor retail frontage on a strong corridor. Broker notes below-market rent upside but buyer should verify certificate of occupancy.",
      price: 4_000_000,
      sqft: 6_000,
      city: "Brooklyn",
      url: "https://example.com/listing",
      extra: {
        investmentHighlights: ["Retail tenant has lease renewal upside."],
      },
    } as Pick<ListingRow, "title" | "description" | "price" | "sqft" | "city" | "url" | "extra">;
    const details: PropertyDetails = {
      assessedRetailAreaGross: 1_200,
      neighborhood: {
        primary: { name: "Williamsburg", borough: "Brooklyn" },
        metrics: { medianPricePsf: 850, sourceAsOf: "2026-05-01" },
      },
      omData: {
        authoritative: {
          propertyInfo: { unitsCommercial: 1 },
          revenueComposition: { commercialAnnualRent: 96_000, totalAnnualRent: 360_000 },
          rentRoll: [
            {
              unit: "Store",
              unitCategory: "Retail",
              tenantName: "Cafe Tenant",
              annualRent: 96_000,
              leaseEndDate: "2028-12-31",
            },
          ],
          validationFlags: [{ flagType: "missing_om_field", field: "lease_abstract" }],
          investmentTakeaways: ["Broker report frames retail rent as a below-market renewal opportunity."],
        },
      },
      marketComps: {
        summary: "Broker package shows Brooklyn mixed-use comps tightening.",
        items: [
          {
            id: "comp-1",
            packageId: "pkg-1",
            propertyId: "p-1",
            itemType: "sale_comp",
            rawPayload: {},
            normalizedPayload: {
              address: "10 Test Ave",
              salePrice: 3_800_000,
              pricePsf: 900,
              capRate: 0.055,
            },
            pageRefs: [],
            reviewStatus: "accepted",
            selectionDecision: "include",
            includeInDossier: true,
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-01T00:00:00.000Z",
          },
        ],
      },
    };
    const ctx = {
      propertyMix: {
        totalUnits: 5,
        residentialUnits: 4,
        eligibleResidentialUnits: 4,
        commercialUnits: 1,
        rentStabilizedUnits: 0,
        eligibleRevenueSharePct: 0.75,
        eligibleUnitSharePct: 0.8,
      },
      rentBreakdown: {
        current: { freeMarketResidential: 264_000, protectedResidential: null, commercial: 96_000, total: 360_000 },
        stabilizedYearNumber: 2,
        stabilized: { freeMarketResidential: 300_000, protectedResidential: null, commercial: 100_000, total: 400_000 },
        freeMarketResidentialLift: 36_000,
        totalLift: 40_000,
      },
      assumptions: {
        operating: {
          annualCommercialRentGrowthPct: 2,
        },
      },
    } as Pick<UnderwritingContext, "propertyMix" | "rentBreakdown" | "assumptions">;

    const context = buildDossierAnalystContext({
      details,
      listing,
      brokerEmailNotes: "Broker says the cafe lease is under market.",
      brokerNotesSummary: "Cafe lease should be diligence priority.",
      ctx,
    });

    expect(context?.listingSummary).toContain("Mixed-use value-add");
    expect(context?.listingSignals.some((signal) => signal.includes("value-add"))).toBe(true);
    expect(context?.brokerClaims.some((signal) => signal.includes("below-market"))).toBe(true);
    expect(context?.marketNeighborhoodSignals.some((signal) => signal.includes("$850 PSF"))).toBe(true);
    expect(context?.marketNeighborhoodSignals.some((signal) => signal.includes("10 Test Ave"))).toBe(true);
    expect(context?.mixedUseRetailSignals.some((signal) => signal.includes("Commercial rent share"))).toBe(true);
    expect(context?.mixedUseRetailSignals.some((signal) => signal.includes("Cafe Tenant"))).toBe(true);
    expect(context?.diligenceFlags.some((signal) => signal.includes("certificate of occupancy"))).toBe(true);
    expect(context?.sourceNotes.some((signal) => signal.includes("internal"))).toBe(true);
  });
});
