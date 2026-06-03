import { describe, expect, it } from "vitest";
import { extractBrokerCompPackageDraft } from "./extractBrokerCompPackage.js";

describe("extractBrokerCompPackageDraft", () => {
  it("extracts project profile fields and bedroom breakdown rows from market-analysis text", async () => {
    const fixture = `181 MACDOUGAL STREET
181 Macdougal Street
Greenwich Village
Straus Group
Morris Adjmi Architects
Morris Adjmi Architects
2025
7
16
September 2024
25%
1,228 SF
$2,996
-
$2.66M - $4.35M
ADDRESS:
NEIGHBORHOOD:
DEVELOPER:
ARCHITECT:
DESIGNER:
YEAR COMPLETED:
# OF FLOORS:
# OF UNITS:
SALES BEGAN:
PERCENT SOLD:
AVG. UNIT SF
ASKING PPSF:
SOLD PPSF:
PRICE RANGE:
UNIT BREAKDOWN
UNIT TYPE
1 BED
2 BED
3 BED
2
13
1
COUNT
1,041 SF
1,243 SF
2,311 SF
AVG. SIZE
$2,825
$2,976
$5,084
AVG. ASKING PPSF
-
-
-
AVG. SOLD PPSF
$ 4 , 3 7 7/ M O
$ 5 , 3 2 7/ M O
$12, 335/MO
AVG. CC
$2.66M-$3.23M
$3.27M-$4.35M
$11.75M-$11.75M
RANGE`;

    const draft = await extractBrokerCompPackageDraft(Buffer.from(fixture, "utf-8"), "market-analysis.txt");
    const profile = draft.extractedItems.find((item) => item.itemType === "pricing_comp");
    const bedroomRows = draft.extractedItems.filter((item) => item.itemType === "unit_breakdown_row");

    expect(profile?.normalizedPayload).toMatchObject({
      address: "181 Macdougal Street",
      neighborhood: "Greenwich Village",
      units: 16,
      percentSoldPct: 25,
      averageUnitSqft: 1228,
      askingPpsf: 2996,
      soldPpsf: null,
      priceRangeLow: 2_660_000,
      priceRangeHigh: 4_350_000,
    });
    expect(bedroomRows).toHaveLength(3);
    expect(bedroomRows[1]?.normalizedPayload).toMatchObject({
      bedroomType: "2 BED",
      count: 13,
      avgSizeSqft: 1243,
      avgAskingPpsf: 2976,
      avgCommonChargesMonthly: 5327,
      priceRangeLow: 3_270_000,
      priceRangeHigh: 4_350_000,
    });
    expect(draft.extractedItems.some((item) => item.itemType === "subject_projected_pricing")).toBe(false);
  });

  it("handles single bedroom/count tokens such as 3 BED13", async () => {
    const fixture = `LOUIE XVII
21 West 17th Street
Flatiron
Vinbaytel Development
Vikatos Architect, Morris Adjmi Architects
Akemas
2025
14
13
October 2024
0%
1,427 SF
$2,424
-
$2.79M - $4.75M
ADDRESS:
NEIGHBORHOOD:
DEVELOPER:
ARCHITECT:
DESIGNER:
YEAR COMPLETED:
# OF FLOORS:
# OF UNITS:
SALES BEGAN:
PERCENT SOLD:
AVG. UNIT SF
ASKING PPSF:
SOLD PPSF:
PRICE RANGE:
UNIT BREAKDOWN
UNIT TYPE
3 BED13
COUNT
1,427 SF
AVG. SIZE
$2,424
AVG. ASKING PPSF
-
AVG. SOLD PPSF
$ 5 81/M O
AVG. CC
$2.79M-$4.75M
RANGE`;

    const draft = await extractBrokerCompPackageDraft(Buffer.from(fixture, "utf-8"), "market-analysis.txt");
    const bedroomRows = draft.extractedItems.filter((item) => item.itemType === "unit_breakdown_row");

    expect(bedroomRows).toHaveLength(1);
    expect(bedroomRows[0]?.normalizedPayload).toMatchObject({
      bedroomType: "3 BED",
      bedrooms: 3,
      count: 13,
      avgSizeSqft: 1427,
      avgAskingPpsf: 2424,
      avgCommonChargesMonthly: 581,
      priceRangeLow: 2_790_000,
      priceRangeHigh: 4_750_000,
    });
  });
});
