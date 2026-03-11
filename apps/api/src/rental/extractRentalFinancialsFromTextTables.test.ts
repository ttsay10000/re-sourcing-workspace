import { describe, expect, it } from "vitest";
import { extractRentalFinancialsFromTextTables } from "./extractRentalFinancialsFromTextTables.js";

const WEST_9TH_TEXT = `
27 WEST 9TH STREET
AVAILABLE FOR SALE
$6,395,000
PRICE NEIGHBORHOOD
Greenwich Village

RENT ROLL & EXPENSES
Income
UnitMonthly RentAnnual Rent
#Duplex$12,875$154,500
#2$8,050$96,600
#3$7,200$86,400
#4 (Rent Stabilized)$1,225$14,700
Total Income$29,350$352,200
Estimated Expenses
Estimated cost
Real Estate Taxes$101,244
Insurance$7,000
Visiting Super$4,000
Electric & Gas$5,500
Water & Sewer$2,600
Maintenance$4,000
Total Expenses$124,344
NOI
Net Operating Income $227,856
`;

const CHRISTOPHER_TEXT = `
THE OFFERING
18-20 Christopher Street has 8 Total Residential units and 3 Commercial Units. Spanning approximately a gross square footage of 4,016 square feet, these properties are zoned R6 and Tax Class 2A Protected (Block 593, Lots 42 and 43).
104,016
TOTAL UNITS
TOTAL SQUARE FEET
$813,500$103,270
PRICE / UNITPROPERTY TAXES
is being offered at
$8,135,000
75%
FREE MARKET
2A
TAX CLASS
Annual Tax Bill$51,123$52,143
`;

describe("extractRentalFinancialsFromTextTables", () => {
  it("extracts a rent roll, expenses, and NOI from plain-text residential OMs", () => {
    const result = extractRentalFinancialsFromTextTables(WEST_9TH_TEXT);

    expect(result.omAnalysis?.propertyInfo?.price).toBe(6_395_000);
    expect(result.omAnalysis?.propertyInfo?.neighborhood).toBe("Greenwich Village");
    expect(result.omAnalysis?.rentRoll).toHaveLength(4);
    expect(result.omAnalysis?.expenses?.expensesTable).toHaveLength(6);
    expect(result.omAnalysis?.expenses?.totalExpenses).toBe(124_344);
    expect(result.omAnalysis?.noiReported).toBe(227_856);
    expect(result.omAnalysis?.uiFinancialSummary?.capRate).toBeCloseTo(3.5630, 3);
    expect(result.omAnalysis?.revenueComposition?.rentStabilizedUnits).toBe(1);
    expect(result.fromLlm?.grossRentTotal).toBe(352_200);
  });

  it("extracts mixed-use property facts even when the PDF text misses the financial tables", () => {
    const result = extractRentalFinancialsFromTextTables(CHRISTOPHER_TEXT);

    expect(result.omAnalysis?.propertyInfo?.price).toBe(8_135_000);
    expect(result.omAnalysis?.propertyInfo?.unitsResidential).toBe(8);
    expect(result.omAnalysis?.propertyInfo?.unitsCommercial).toBe(3);
    expect(result.omAnalysis?.propertyInfo?.totalUnits).toBe(11);
    expect(result.omAnalysis?.propertyInfo?.buildingSqft).toBe(4_016);
    expect(result.omAnalysis?.propertyInfo?.annualTaxes).toBe(103_270);
    expect(result.omAnalysis?.propertyInfo?.taxClass).toBe("2A");
    expect(result.omAnalysis?.propertyInfo?.address).toBe("18-20 Christopher Street");
    expect(result.omAnalysis?.propertyInfo?.block).toBe(593);
    expect(result.omAnalysis?.propertyInfo?.lotNumbers).toEqual([42, 43]);
    expect(result.omAnalysis?.revenueComposition?.freeMarketUnits).toBe(6);
    expect(result.omAnalysis?.investmentTakeaways?.some((line) => line.includes("commercial"))).toBe(true);
    expect(result.omAnalysis?.investmentTakeaways?.some((line) => line.includes("NOI"))).toBe(true);
  });
});
