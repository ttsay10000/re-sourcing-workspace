import { describe, expect, it } from "vitest";
import {
  propertyOverviewFromDetails,
  resolveDossierPackageContext,
} from "./dossierPropertyContext.js";
import type { PropertyDetails } from "@re-sourcing/contracts";

describe("dossierPropertyContext", () => {
  it("prefers the OM package address and suppresses single-lot identifiers", () => {
    const details: PropertyDetails = {
      taxCode: "2A",
      bbl: "1005930043",
      enrichment: {
        hpdRegistration: {
          registrationId: "119991",
          lastRegistrationDate: "2025-06-11",
        },
      },
      rentalFinancials: {
        omAnalysis: {
          propertyInfo: {
            address: "18-20 Christopher Street",
            block: 593,
            lotNumbers: [42, 43],
          },
        },
      },
    };

    const packageContext = resolveDossierPackageContext(
      "18 Christopher Street, Manhattan, NY 10014",
      details
    );
    const propertyOverview = propertyOverviewFromDetails(details, packageContext);

    expect(packageContext.dossierAddress).toBe("18-20 Christopher Street, Manhattan, NY 10014");
    expect(packageContext.isPackage).toBe(true);
    expect(packageContext.packageNote).toContain("Block 593, Lots 42 and 43");
    expect(propertyOverview?.taxCode).toBe("2A");
    expect(propertyOverview?.bbl).toBeUndefined();
    expect(propertyOverview?.hpdRegistrationId).toBeUndefined();
    expect(propertyOverview?.packageNote).toContain("canonical listing address");
  });
});
