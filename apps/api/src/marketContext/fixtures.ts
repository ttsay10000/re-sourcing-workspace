/**
 * Five Q1 2026 market-document fixtures mirroring the real upload set:
 *   1. Avison Young Manhattan Monthly (research, 26 comps incl. 4 Nolita)
 *   2. Ariel MFQIR Q1 2026 (research, submarket stats + Northern Manhattan)
 *   3. Unbranded one-page comp table (broker_provided / comp_list)
 *   4. Branded Marcus & Millichap OM (broker_provided / om, subject + cherry-picked comps)
 *   5. Alpha Realty Market Trends Q1 2026 (research, all-Manhattan universe)
 *
 * Each fixture carries the document text (rendered to PDF by
 * scripts/buildMarketDocFixturePdfs.ts for live runs) and the classify/extract
 * JSON a faithful model returns for it; both are derived from the same data
 * arrays so text and expected output cannot drift. fixtureLlmRunner serves
 * these responses through the standard MarketLlmRunner interface.
 */
import type { MarketLlmRunner } from "./llmAdapter.js";

interface FixtureCompRow {
  address: string;
  neighborhood_raw: string | null;
  borough: string | null;
  sale_price: number | null;
  price_type: "closed" | "asking" | "in_contract" | "unknown";
  sale_date: string | null;
  gsf: number | null;
  price_psf: number | null;
  units_total: number | null;
  units_resi: number | null;
  pct_rent_stabilized: number | null;
  cap_rate: number | null;
  asset_type: string | null;
  notes_short: string | null;
  cherry_pick_risk: boolean;
  is_subject_property: boolean;
  confidence: "high" | "medium" | "low";
  raw_text: string | null;
  page: number;
}

interface FixtureStatRow {
  metric: string;
  metric_type: "level" | "pct_change";
  value: number;
  comparison_period: string | null;
  geo_level: "address" | "neighborhood" | "submarket" | "borough" | "citywide";
  geo_name: string;
  segment: string | null;
  period: string | null;
  page: number;
}

export interface MarketDocFixture {
  id: string;
  filename: string;
  /** Unique string present in the document text used by fixtureLlmRunner to match. */
  marker: string;
  text: string;
  classifyResponse: Record<string, unknown>;
  extractResponse: { comps: FixtureCompRow[]; market_stats: FixtureStatRow[] };
}

function comp(partial: Partial<FixtureCompRow> & { address: string; page: number }): FixtureCompRow {
  return {
    neighborhood_raw: null,
    borough: "Manhattan",
    sale_price: null,
    price_type: "closed",
    sale_date: null,
    gsf: null,
    price_psf: null,
    units_total: null,
    units_resi: null,
    pct_rent_stabilized: null,
    cap_rate: null,
    asset_type: "multifamily",
    notes_short: null,
    cherry_pick_risk: false,
    is_subject_property: false,
    confidence: "high",
    raw_text: null,
    ...partial,
  };
}

function tableLine(row: FixtureCompRow): string {
  const money = (v: number | null) => (v == null ? "N/A" : `$${v.toLocaleString("en-US")}`);
  const pct = (v: number | null) => (v == null ? "N/A" : `${(v * 100).toFixed(2)}%`);
  return [
    row.address,
    row.neighborhood_raw ?? "",
    row.sale_date ?? "",
    money(row.sale_price),
    row.gsf == null ? "" : `${row.gsf.toLocaleString("en-US")} SF`,
    row.price_psf == null ? "" : `$${row.price_psf.toLocaleString("en-US")}/SF`,
    row.units_total == null ? "" : `${row.units_total} units`,
    pct(row.cap_rate),
    row.pct_rent_stabilized == null ? "" : `${Math.round(row.pct_rent_stabilized * 100)}% RS`,
    row.notes_short ?? "",
  ].join(" | ");
}

// ---------------------------------------------------------------------------
// Fixture 1: Avison Young Manhattan Monthly Sales Report Jan–Feb 2026
// ---------------------------------------------------------------------------

const AY_NOLITA_COMPS: FixtureCompRow[] = [
  comp({
    address: "242 Elizabeth Street",
    neighborhood_raw: "Nolita",
    sale_price: 11_750_000,
    sale_date: "2026-01-26",
    gsf: 7_667,
    price_psf: 1_533,
    units_total: 6,
    units_resi: 5,
    pct_rent_stabilized: 0,
    cap_rate: 0.0582,
    asset_type: "mixed-use",
    notes_short: "5-story elevator bldg, all FM, renovated, ground-fl retail",
    page: 4,
  }),
  comp({
    address: "17 Prince Street",
    neighborhood_raw: "Nolita",
    sale_price: 8_250_000,
    sale_date: "2026-02-20",
    gsf: 5_281,
    price_psf: 1_562,
    units_total: 10,
    units_resi: 9,
    pct_rent_stabilized: 0.4,
    cap_rate: 0.0467,
    asset_type: "mixed-use",
    notes_short: "Corner walk-up, 40% rent-stabilized, prime retail",
    page: 4,
  }),
  comp({
    address: "9 Spring Street",
    neighborhood_raw: "NoLita",
    sale_price: 9_150_000,
    sale_date: "2026-01-15",
    gsf: 6_330,
    price_psf: 1_445,
    units_total: 8,
    units_resi: 8,
    pct_rent_stabilized: 0,
    cap_rate: 0.061,
    notes_short: "Walk-up, free-market, recently re-piped",
    page: 4,
  }),
  comp({
    address: "250 Mott Street",
    neighborhood_raw: "Little Italy",
    sale_price: 13_950_000,
    sale_date: "2026-02-10",
    gsf: 9_006,
    price_psf: 1_549,
    units_total: 12,
    units_resi: 10,
    cap_rate: 0.0615,
    asset_type: "mixed-use",
    notes_short: "Two retail units, ten apartments",
    page: 4,
  }),
];

const AY_OTHER_COMPS: FixtureCompRow[] = [
  comp({ address: "504 East 12th Street", neighborhood_raw: "East Village", sale_price: 7_400_000, sale_date: "2026-01-12", gsf: 8_120, price_psf: 911, units_total: 16, pct_rent_stabilized: 0.5, cap_rate: 0.0641, page: 5 }),
  comp({ address: "229 East 5th Street", neighborhood_raw: "East Village", sale_price: 6_100_000, sale_date: "2026-02-03", gsf: 6_400, price_psf: 953, units_total: 10, pct_rent_stabilized: 0.2, cap_rate: 0.059, page: 5 }),
  comp({ address: "640 East 9th Street", neighborhood_raw: "Alphabet City", sale_price: 4_950_000, sale_date: "2026-02-17", gsf: 6_010, price_psf: 824, units_total: 12, pct_rent_stabilized: 0.75, cap_rate: 0.068, page: 5 }),
  comp({ address: "131 Essex Street", neighborhood_raw: "Lower East Side", sale_price: 8_900_000, sale_date: "2026-01-22", gsf: 9_240, price_psf: 963, units_total: 14, pct_rent_stabilized: 0.3, cap_rate: 0.0605, asset_type: "mixed-use", page: 5 }),
  comp({ address: "88 Clinton Street", neighborhood_raw: "LES", sale_price: 5_600_000, sale_date: "2026-02-25", gsf: 6_900, price_psf: 812, units_total: 11, pct_rent_stabilized: 0.6, cap_rate: 0.0655, page: 5 }),
  comp({ address: "74 Charles Street", neighborhood_raw: "West Village", sale_price: 12_300_000, sale_date: "2026-01-30", gsf: 7_050, price_psf: 1_745, units_total: 8, pct_rent_stabilized: 0.1, cap_rate: 0.0445, page: 6 }),
  comp({ address: "303 West 4th Street", neighborhood_raw: "West Village", sale_price: 9_750_000, sale_date: "2026-02-12", gsf: 6_210, price_psf: 1_570, units_total: 9, cap_rate: 0.0488, page: 6 }),
  comp({ address: "120 MacDougal Street", neighborhood_raw: "Greenwich Village", sale_price: 10_500_000, sale_date: "2026-01-08", gsf: 7_480, price_psf: 1_404, units_total: 12, pct_rent_stabilized: 0.25, cap_rate: 0.0512, asset_type: "mixed-use", page: 6 }),
  comp({ address: "354 West 18th Street", neighborhood_raw: "Chelsea", sale_price: 11_900_000, sale_date: "2026-02-06", gsf: 9_850, price_psf: 1_208, units_total: 15, pct_rent_stabilized: 0.33, cap_rate: 0.0535, page: 6 }),
  comp({ address: "445 West 23rd Street", neighborhood_raw: "Chelsea", sale_price: 14_600_000, sale_date: "2026-01-19", gsf: 12_400, price_psf: 1_177, units_total: 20, pct_rent_stabilized: 0.45, cap_rate: 0.0558, page: 6 }),
  comp({ address: "243 East 21st Street", neighborhood_raw: "Gramercy", sale_price: 8_400_000, sale_date: "2026-02-09", gsf: 7_660, price_psf: 1_097, units_total: 12, cap_rate: 0.0526, page: 7 }),
  comp({ address: "330 East 30th Street", neighborhood_raw: "Kips Bay", sale_price: 7_950_000, sale_date: "2026-01-27", gsf: 8_300, price_psf: 958, units_total: 14, pct_rent_stabilized: 0.4, cap_rate: 0.0589, page: 7 }),
  comp({ address: "402 East 78th Street", neighborhood_raw: "Upper East Side", sale_price: 9_800_000, sale_date: "2026-01-14", gsf: 9_120, price_psf: 1_075, units_total: 16, pct_rent_stabilized: 0.35, cap_rate: 0.0571, page: 7 }),
  comp({ address: "166 East 92nd Street", neighborhood_raw: "Yorkville", sale_price: 6_750_000, sale_date: "2026-02-18", gsf: 7_010, price_psf: 963, units_total: 12, pct_rent_stabilized: 0.55, cap_rate: 0.0625, page: 7 }),
  comp({ address: "315 East 65th Street", neighborhood_raw: "Lenox Hill", sale_price: 12_100_000, sale_date: "2026-02-26", gsf: 10_450, price_psf: 1_158, units_total: 18, cap_rate: null, raw_text: "cap rate column prints N/A — buyer plans condo conversion", confidence: "low", page: 7 }),
  comp({ address: "210 West 78th Street", neighborhood_raw: "Upper West Side", sale_price: 13_500_000, sale_date: "2026-01-21", gsf: 11_080, price_psf: 1_218, units_total: 19, pct_rent_stabilized: 0.42, cap_rate: 0.0541, page: 8 }),
  comp({ address: "568 Amsterdam Avenue", neighborhood_raw: "UWS", sale_price: 8_250_000, sale_date: "2026-02-13", gsf: 8_400, price_psf: 982, units_total: 15, pct_rent_stabilized: 0.6, cap_rate: 0.0612, asset_type: "mixed-use", page: 8 }),
  comp({ address: "461 West 49th Street", neighborhood_raw: "Hell's Kitchen", sale_price: 6_900_000, sale_date: "2026-01-29", gsf: 7_550, price_psf: 914, units_total: 13, pct_rent_stabilized: 0.5, cap_rate: 0.0598, page: 8 }),
  comp({ address: "229 East 53rd Street", neighborhood_raw: "Midtown East", sale_price: 10_200_000, sale_date: "2026-02-04", gsf: 9_900, price_psf: 1_030, units_total: 16, cap_rate: 0.0552, page: 8 }),
  comp({ address: "2110 Frederick Douglass Boulevard", neighborhood_raw: "South Harlem", sale_price: 5_900_000, sale_date: "2026-01-16", gsf: 8_120, price_psf: 727, units_total: 14, pct_rent_stabilized: 0.65, cap_rate: 0.0671, asset_type: "mixed-use", page: 9 }),
  comp({ address: "159 West 121st Street", neighborhood_raw: "Harlem", sale_price: 4_300_000, sale_date: "2026-02-11", gsf: 6_240, price_psf: 689, units_total: 10, pct_rent_stabilized: 0.7, cap_rate: 0.0702, page: 9 }),
  comp({ address: "327 East 116th Street", neighborhood_raw: "East Harlem", sale_price: 3_850_000, sale_date: "2026-02-24", gsf: 5_910, price_psf: 651, units_total: 11, pct_rent_stabilized: 0.8, cap_rate: 0.0718, page: 9 }),
];

const AY_COMPS = [...AY_NOLITA_COMPS, ...AY_OTHER_COMPS];

const AY_STATS: FixtureStatRow[] = [
  { metric: "dollar_volume", metric_type: "level", value: 487_000_000, comparison_period: null, geo_level: "submarket", geo_name: "Manhattan south of 96th Street", segment: null, period: "jan_feb_2026", page: 2 },
  { metric: "transaction_count", metric_type: "level", value: 38, comparison_period: null, geo_level: "submarket", geo_name: "Manhattan south of 96th Street", segment: null, period: "jan_feb_2026", page: 2 },
];

const AY_TEXT = `AVISON YOUNG
Manhattan Monthly Sales Report Jan–Feb 2026
Tri-State Investment Sales | Released March 2026

Methodology: Avison Young tracks closed investment sales of $5 million and
above in Manhattan south of 96th Street. Data sourced from ACRIS, public
records and Avison Young research. Copyright 2026 Avison Young. This report is
for information purposes only; market data disclaimer applies.

Research contacts: research.tristate@avisonyoung.com
Avison Young | Avison Young | Avison Young (running footer on every page)

MARKET SNAPSHOT (Manhattan south of 96th Street, Jan–Feb 2026)
Dollar volume: $487,000,000 across 38 transactions.

CLOSED MULTIFAMILY & MIXED-USE SALES (page 4-9)
Address | Neighborhood | Closed | Price | GSF | $/SF | Units | Cap | RS | Notes
${AY_COMPS.map(tableLine).join("\n")}

Note: 315 East 65th Street cap rate prints N/A — buyer plans condo conversion.`;

// ---------------------------------------------------------------------------
// Fixture 2: Ariel Property Advisors — Multifamily Quarter In Review Q1 2026
// ---------------------------------------------------------------------------

const ARIEL_COMPS: FixtureCompRow[] = [
  comp({
    address: "210 Sherman Avenue",
    neighborhood_raw: "Inwood",
    sale_price: 5_800_000,
    sale_date: "2026-02-25",
    gsf: 41_000,
    price_psf: 141,
    units_total: 48,
    units_resi: 48,
    pct_rent_stabilized: 0.95,
    cap_rate: 0.071,
    notes_short: "48-unit elevator building, predominantly rent-stabilized",
    page: 9,
  }),
  comp({ address: "560 West 144th Street", neighborhood_raw: "Hamilton Heights", sale_price: 6_950_000, sale_date: "2026-01-23", gsf: 28_400, price_psf: 245, units_total: 32, pct_rent_stabilized: 0.85, cap_rate: 0.0695, page: 9 }),
  comp({ address: "240 Wadsworth Avenue", neighborhood_raw: "Washington Heights", sale_price: 8_100_000, sale_date: "2026-03-02", gsf: 36_200, price_psf: 224, units_total: 40, pct_rent_stabilized: 0.9, cap_rate: 0.0688, page: 9 }),
];

const ARIEL_STATS: FixtureStatRow[] = [
  { metric: "avg_price_psf", metric_type: "level", value: 986, comparison_period: null, geo_level: "submarket", geo_name: "Manhattan below 96th Street", segment: "free_market_incl_421a", period: "trailing_6mo", page: 4 },
  { metric: "dollar_volume", metric_type: "pct_change", value: -13, comparison_period: "QoQ vs Q4 2025", geo_level: "submarket", geo_name: "Manhattan below 96th Street", segment: null, period: "q1_2026", page: 3 },
  { metric: "avg_price_psf", metric_type: "level", value: 412, comparison_period: null, geo_level: "submarket", geo_name: "Northern Manhattan", segment: "free_market_incl_421a", period: "trailing_6mo", page: 8 },
  { metric: "dollar_volume", metric_type: "pct_change", value: 22, comparison_period: "QoQ vs Q4 2025", geo_level: "submarket", geo_name: "Northern Manhattan", segment: null, period: "q1_2026", page: 8 },
];

const ARIEL_TEXT = `ARIEL PROPERTY ADVISORS
Multifamily Quarter In Review — New York City | Q1 2026
Released April 2026 | Investment Research

Methodology: Ariel Property Advisors tracks multifamily transactions of 10+
residential units. Manhattan refers to below 96th Street; Northern Manhattan
(above East 96th / West 110th) is reported separately. Copyright 2026 Ariel
Property Advisors. Market data disclaimer applies.

MANHATTAN (below 96th Street)
Dollar volume fell 13% quarter-over-quarter vs Q4 2025.
Free market (incl. 421a) average pricing: $986/SF*
*trailing 6-month data due to low sales activity.

NORTHERN MANHATTAN
Dollar volume rose 22% quarter-over-quarter vs Q4 2025.
Free market (incl. 421a) average pricing: $412/SF* (*trailing 6-month data)

SELECT NORTHERN MANHATTAN TRANSACTIONS (page 9)
Address | Neighborhood | Closed | Price | GSF | $/SF | Units | Cap | RS | Notes
${ARIEL_COMPS.map(tableLine).join("\n")}

Research & analyst contacts: Ariel Property Advisors Investment Research.`;

// ---------------------------------------------------------------------------
// Fixture 3: Unbranded one-page comp table (synthetic)
// ---------------------------------------------------------------------------

const UNBRANDED_COMPS: FixtureCompRow[] = [
  comp({ address: "338 East 6th Street", neighborhood_raw: "East Village", sale_price: 5_250_000, sale_date: "2026-01-09", gsf: 5_880, price_psf: 893, units_total: 10, cap_rate: 0.0615, page: 1 }),
  comp({ address: "97 Ludlow Street", neighborhood_raw: "Lower East Side", sale_price: 6_400_000, sale_date: "2025-12-18", gsf: 7_300, price_psf: 877, units_total: 12, cap_rate: 0.0598, page: 1 }),
  comp({ address: "525 East 11th Street", neighborhood_raw: "East Village", sale_price: 4_750_000, sale_date: "2026-02-14", gsf: 5_410, price_psf: 878, units_total: 9, cap_rate: null, raw_text: "cap N/A", confidence: "low", page: 1 }),
];

const UNBRANDED_TEXT = `Recent sales — walk-ups (no letterhead)
Address | Neighborhood | Closed | Price | GSF | $/SF | Units | Cap | RS | Notes
${UNBRANDED_COMPS.map(tableLine).join("\n")}`;

// ---------------------------------------------------------------------------
// Fixture 4: Branded Marcus & Millichap OM (synthetic)
// ---------------------------------------------------------------------------

const MM_SUBJECT: FixtureCompRow = comp({
  address: "312 East 9th Street",
  neighborhood_raw: "East Village",
  sale_price: 7_500_000,
  price_type: "asking",
  sale_date: null,
  gsf: 6_850,
  price_psf: 1_095,
  units_total: 12,
  units_resi: 11,
  pct_rent_stabilized: 0.25,
  cap_rate: 0.052,
  asset_type: "mixed-use",
  notes_short: "Subject property — offering memorandum asking price",
  is_subject_property: true,
  page: 2,
});

const MM_INTERNAL_COMPS: FixtureCompRow[] = [
  comp({ address: "326 East 4th Street", neighborhood_raw: "East Village", sale_price: 6_800_000, sale_date: "2025-11-20", gsf: 6_240, price_psf: 1_090, units_total: 10, cap_rate: 0.049, cherry_pick_risk: true, page: 14 }),
  comp({ address: "218 East 7th Street", neighborhood_raw: "East Village", sale_price: 7_950_000, sale_date: "2025-10-12", gsf: 7_010, price_psf: 1_134, units_total: 12, cap_rate: 0.0475, cherry_pick_risk: true, page: 14 }),
  comp({ address: "95 Avenue A", neighborhood_raw: "East Village", sale_price: 8_400_000, sale_date: "2026-01-05", gsf: 7_550, price_psf: 1_113, units_total: 13, cap_rate: null, raw_text: "comp table cap cell blank", confidence: "low", cherry_pick_risk: true, page: 14 }),
];

const MM_TEXT = `MARCUS & MILLICHAP
OFFERING MEMORANDUM — CONFIDENTIAL
312 East 9th Street, New York, NY 10003
Asking Price: $7,500,000 | 12 Units | 6,850 GSF | $1,095/SF | 5.20% Cap (current)

Rent Roll (page 6): 11 residential units (3 rent-stabilized), 1 retail unit.
Pro-forma NOI and upside analysis on page 8.

COMPARABLE SALES (page 14)
Address | Neighborhood | Closed | Price | GSF | $/SF | Units | Cap | RS | Notes
${MM_INTERNAL_COMPS.map(tableLine).join("\n")}

Exclusively listed by Marcus & Millichap. Confidential — do not distribute.`;

// ---------------------------------------------------------------------------
// Fixture 5: Alpha Realty — Market Trends Q1 2026
// ---------------------------------------------------------------------------

const ALPHA_COMPS: FixtureCompRow[] = [
  comp({
    address: "210 Sherman Ave",
    neighborhood_raw: "Inwood",
    sale_price: 5_750_000,
    sale_date: "2026-02-21",
    units_total: 48,
    notes_short: "Elevator building",
    page: 6,
  }),
  comp({ address: "2287 Adam Clayton Powell Jr Boulevard", neighborhood_raw: "Harlem", sale_price: 4_100_000, sale_date: "2026-01-28", gsf: 7_900, price_psf: 519, units_total: 12, cap_rate: 0.069, page: 6 }),
];

const ALPHA_STATS: FixtureStatRow[] = [
  { metric: "dollar_volume", metric_type: "pct_change", value: 93.8, comparison_period: "QoQ vs Q4 2025", geo_level: "borough", geo_name: "Manhattan", segment: null, period: "q1_2026", page: 3 },
  { metric: "transaction_count", metric_type: "level", value: 41, comparison_period: null, geo_level: "borough", geo_name: "Manhattan", segment: null, period: "q1_2026", page: 3 },
  { metric: "avg_price_psf", metric_type: "level", value: 698, comparison_period: null, geo_level: "borough", geo_name: "Manhattan", segment: null, period: "q1_2026", page: 4 },
];

const ALPHA_TEXT = `ALPHA REALTY
Market Trends — New York City Multifamily | Q1 2026
Released April 2026

Methodology: Alpha Realty tracks multifamily sales of 5+ units trading at $1M
and above across all of Manhattan (river to river). Copyright 2026 Alpha
Realty. Market data disclaimer applies.

MANHATTAN (all)
Dollar volume up 93.8% quarter-over-quarter vs Q4 2025 across 41 transactions.
Average pricing: $698/SF for Q1 2026.

SELECT TRANSACTIONS (page 6)
Address | Neighborhood | Closed | Price | GSF | $/SF | Units | Cap | RS | Notes
${ALPHA_COMPS.map(tableLine).join("\n")}

Research contacts: Alpha Realty Research.`;

// ---------------------------------------------------------------------------

export const MARKET_DOC_FIXTURES: MarketDocFixture[] = [
  {
    id: "ay_monthly_jan_feb_2026",
    filename: "avison-young-manhattan-monthly-jan-feb-2026.txt",
    marker: "Manhattan Monthly Sales Report Jan–Feb 2026",
    text: AY_TEXT,
    classifyResponse: {
      source_type: "market_research",
      publisher: "Avison Young",
      branded: true,
      document_class: "published_report",
      report_title: "Manhattan Monthly Sales Report Jan–Feb 2026",
      period_covered: "Jan–Feb 2026",
      geo_scope: "Manhattan south of 96th St",
      subject_property: null,
      classifier_confidence: "high",
      evidence: [
        "Manhattan Monthly Sales Report Jan–Feb 2026",
        "Released March 2026",
        "Methodology: Avison Young tracks closed investment sales of $5 million and above",
        "running footer on every page",
        "38 transactions across many owners and neighborhoods, no subject property",
      ],
    },
    extractResponse: { comps: AY_COMPS, market_stats: AY_STATS },
  },
  {
    id: "ariel_mfqir_q1_2026",
    filename: "ariel-mfqir-q1-2026.txt",
    marker: "Multifamily Quarter In Review — New York City | Q1 2026",
    text: ARIEL_TEXT,
    classifyResponse: {
      source_type: "market_research",
      publisher: "Ariel Property Advisors",
      branded: true,
      document_class: "published_report",
      report_title: "Multifamily Quarter In Review Q1 2026",
      period_covered: "Q1 2026",
      geo_scope: "NYC (Manhattan below 96th St and Northern Manhattan split)",
      subject_property: null,
      classifier_confidence: "high",
      evidence: [
        "Multifamily Quarter In Review — New York City | Q1 2026",
        "Released April 2026",
        "Methodology: Ariel Property Advisors tracks multifamily transactions of 10+",
        "Research & analyst contacts",
      ],
    },
    extractResponse: { comps: ARIEL_COMPS, market_stats: ARIEL_STATS },
  },
  {
    id: "unbranded_comp_table",
    filename: "unbranded-comp-table.txt",
    marker: "Recent sales — walk-ups (no letterhead)",
    text: UNBRANDED_TEXT,
    classifyResponse: {
      source_type: "broker_provided",
      publisher: null,
      branded: false,
      document_class: "comp_list",
      report_title: null,
      period_covered: null,
      geo_scope: "East Village / Lower East Side",
      subject_property: null,
      classifier_confidence: "high",
      evidence: ["bare table of sales", "no letterhead, no publication framing"],
    },
    extractResponse: { comps: UNBRANDED_COMPS, market_stats: [] },
  },
  {
    id: "mm_om_312_e9",
    filename: "marcus-millichap-om-312-east-9th.txt",
    marker: "OFFERING MEMORANDUM — CONFIDENTIAL",
    text: MM_TEXT,
    classifyResponse: {
      source_type: "broker_provided",
      publisher: "Marcus & Millichap",
      branded: true,
      document_class: "om",
      report_title: null,
      period_covered: null,
      geo_scope: "East Village",
      subject_property: "312 East 9th Street",
      classifier_confidence: "high",
      evidence: [
        "OFFERING MEMORANDUM — CONFIDENTIAL",
        "Asking Price: $7,500,000",
        "Rent Roll (page 6)",
        "centers on one subject property despite Marcus & Millichap branding",
      ],
    },
    extractResponse: { comps: [MM_SUBJECT, ...MM_INTERNAL_COMPS], market_stats: [] },
  },
  {
    id: "alpha_market_trends_q1_2026",
    filename: "alpha-realty-market-trends-q1-2026.txt",
    marker: "Market Trends — New York City Multifamily | Q1 2026",
    text: ALPHA_TEXT,
    classifyResponse: {
      source_type: "market_research",
      publisher: "Alpha Realty",
      branded: true,
      document_class: "published_report",
      report_title: "Market Trends Q1 2026",
      period_covered: "Q1 2026",
      geo_scope: "Manhattan (all)",
      subject_property: null,
      classifier_confidence: "high",
      evidence: [
        "Market Trends — New York City Multifamily | Q1 2026",
        "Released April 2026",
        "Methodology: Alpha Realty tracks multifamily sales of 5+ units",
      ],
    },
    extractResponse: { comps: ALPHA_COMPS, market_stats: ALPHA_STATS },
  },
];

/** Reference date used by fixture-driven tests so trailing-12-month windows are stable. */
export const FIXTURE_AS_OF = new Date("2026-03-15T12:00:00Z");

/**
 * MarketLlmRunner serving fixture responses: matches the document by marker
 * string in the supplied text/PDF bytes. Synthesize requests return no JSON so
 * the pipeline exercises the deterministic numbers-only bullet fallback.
 */
export function fixtureLlmRunner(fixtures: MarketDocFixture[] = MARKET_DOC_FIXTURES): MarketLlmRunner {
  return async (request) => {
    if (request.stage === "synthesize") {
      return { provider: "mock", model: "fixture", rawOutput: null, parsed: null, error: "fixture runner: deterministic bullets" };
    }
    const haystack = request.documentText ?? request.pdf?.buffer.toString("utf-8") ?? "";
    const fixture = fixtures.find((candidate) => haystack.includes(candidate.marker));
    if (!fixture) {
      return { provider: "mock", model: "fixture", rawOutput: null, parsed: null, error: "no fixture matched" };
    }
    const parsed = request.stage === "classify" ? fixture.classifyResponse : (fixture.extractResponse as unknown as Record<string, unknown>);
    return {
      provider: "mock",
      model: "fixture",
      rawOutput: JSON.stringify(parsed),
      parsed: JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>,
      error: null,
    };
  };
}
