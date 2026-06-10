import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectBrokerCompSourceKind,
  extractBrokerCompPackageDraft,
} from "./extractBrokerCompPackage.js";

const MODEL_ENV_KEYS = ["OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"] as const;
const savedEnv: Partial<Record<(typeof MODEL_ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  // Keep these tests hermetic: no model calls even when keys exist in the env.
  for (const key of MODEL_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MODEL_ENV_KEYS) {
    if (savedEnv[key] == null) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("detectBrokerCompSourceKind", () => {
  it("routes by filename extension first", () => {
    expect(detectBrokerCompSourceKind("comps.pdf")).toBe("pdf");
    expect(detectBrokerCompSourceKind("Comps.PDF")).toBe("pdf");
    expect(detectBrokerCompSourceKind("comps.xlsx")).toBe("spreadsheet");
    expect(detectBrokerCompSourceKind("comps.xls")).toBe("spreadsheet");
    expect(detectBrokerCompSourceKind("comps.xlsm")).toBe("spreadsheet");
    expect(detectBrokerCompSourceKind("comps.csv")).toBe("spreadsheet");
    expect(detectBrokerCompSourceKind("comps.txt")).toBe("text");
  });

  it("falls back to the upload content type when the extension is missing", () => {
    expect(detectBrokerCompSourceKind("broker-comp-package", "application/pdf")).toBe("pdf");
    expect(
      detectBrokerCompSourceKind(
        "broker-comp-package",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
    ).toBe("spreadsheet");
    expect(detectBrokerCompSourceKind("broker-comp-package", "application/vnd.ms-excel")).toBe("spreadsheet");
    expect(detectBrokerCompSourceKind("broker-comp-package", "text/csv")).toBe("spreadsheet");
    expect(detectBrokerCompSourceKind("broker-comp-package", "text/plain")).toBe("text");
  });

  it("sniffs magic bytes when extension and content type are unusable", () => {
    expect(detectBrokerCompSourceKind("package", null, Buffer.from("%PDF-1.7\n...", "latin1"))).toBe("pdf");
    expect(detectBrokerCompSourceKind("package", null, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe("spreadsheet");
    expect(detectBrokerCompSourceKind("package", null, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1]))).toBe("spreadsheet");
    expect(detectBrokerCompSourceKind("package", null, Buffer.from("plain text", "utf-8"))).toBe("text");
  });
});

describe("extractBrokerCompPackageDraft routing", () => {
  it("marks spreadsheet packages, parses workbook text, and surfaces a warning when OpenAI is unavailable", async () => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Address", "Sale Price", "Cap Rate", "NOI"],
        ["410 West 24th Street", "$12,500,000", "5.25%", "$656,250"],
      ]),
      "Sale Comps"
    );
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const draft = await extractBrokerCompPackageDraft(buffer, "sale-comps.xlsx");

    expect(draft.packageMeta.sourceKind).toBe("spreadsheet");
    expect(draft.pages[0]?.extractionMethod).toBe("spreadsheet");
    expect(draft.textChars).toBeGreaterThan(0);
    // No OPENAI_API_KEY in tests → heuristics-only fallback with an explicit warning.
    expect(draft.packageMeta.extractionMethod).toBe("text_heuristics");
    const warnings = draft.packageMeta.extractionWarnings as Array<Record<string, unknown>>;
    expect(warnings.some((warning) => warning.code === "openai_extraction_failed")).toBe(true);
    const note = draft.extractedItems.find((item) => item.itemType === "broker_note");
    const noteFlags = (note?.normalizedPayload?.missingDataFlags ?? []) as Array<Record<string, unknown>>;
    expect(noteFlags.some((flag) => flag.code === "openai_extraction_failed")).toBe(true);
  });

  it("surfaces a warning instead of silently skipping Gemini for PDFs", async () => {
    const draft = await extractBrokerCompPackageDraft(Buffer.from("%PDF-1.4 not really a pdf", "latin1"), "comps.pdf");

    expect(draft.packageMeta.sourceKind).toBe("pdf");
    expect(draft.packageMeta.extractionMethod).toBe("text_heuristics");
    const warnings = draft.packageMeta.extractionWarnings as Array<Record<string, unknown>>;
    expect(warnings.some((warning) => warning.code === "gemini_extraction_skipped")).toBe(true);
  });

  it("keeps plain-text packages on heuristics without model warnings", async () => {
    const draft = await extractBrokerCompPackageDraft(Buffer.from("just notes, nothing structured", "utf-8"), "notes.txt");

    expect(draft.packageMeta.sourceKind).toBe("text");
    expect(draft.packageMeta.extractionWarnings).toEqual([]);
  });
});

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
