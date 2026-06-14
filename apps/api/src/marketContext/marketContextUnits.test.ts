/**
 * Unit tests for the pure market-context stages: classifier coercion, address
 * normalization + dedupe merge, neighborhood/alias + submarket resolution,
 * extraction guards (provenance injection, cherry-pick enforcement), rollup
 * thresholds, and synthesis validation.
 */
import { describe, expect, it } from "vitest";
import type { MarketComp, MarketDocClassification, MarketProvenance } from "@re-sourcing/contracts";
import { buildClassifierSample, coerceClassification } from "./classify.js";
import { asRate, coerceExtraction } from "./extract.js";
import {
  buildNeighborhoodIndex,
  normalizeNeighborhoodName,
  resolveNeighborhoodId,
  resolveSubmarketId,
} from "./neighborhoodResolve.js";
import { isSameDeal, mergeComps, normalizeCompAddress, type MergedComp } from "./dedupe.js";
import { computeNeighborhoodRollup, effectiveSourceType, median } from "./rollup.js";
import { deterministicBullets, validateSynthesisOutput } from "./synthesize.js";
import { loadSeedNeighborhoods } from "./seedNeighborhoods.js";

const RESEARCH_CLASSIFICATION: MarketDocClassification = {
  source_type: "market_research",
  publisher: "Avison Young",
  branded: true,
  document_class: "published_report",
  report_title: "Monthly",
  period_covered: "Jan–Feb 2026",
  geo_scope: "Manhattan south of 96th St",
  coverage_universe: null,
  subject_property: null,
  classifier_confidence: "high",
  evidence: [],
};

const OM_CLASSIFICATION: MarketDocClassification = {
  ...RESEARCH_CLASSIFICATION,
  source_type: "broker_provided",
  publisher: "Marcus & Millichap",
  document_class: "om",
  report_title: null,
  subject_property: "312 East 9th Street",
};

function provenance(sourceType: MarketProvenance["source_type"], documentId = "doc_a"): MarketProvenance {
  return {
    source_type: sourceType,
    publisher: sourceType === "market_research" ? "Ariel Property Advisors" : null,
    branded: sourceType === "market_research",
    document_class: sourceType === "market_research" ? "published_report" : "comp_list",
    document_id: documentId,
    report_title: null,
    page: 1,
    classifier_confidence: "high",
  };
}

function marketComp(partial: Partial<MarketComp>): MarketComp {
  const base: MarketComp = {
    id: "comp_x",
    documentId: "doc_a",
    address: "100 Main Street",
    neighborhoodRaw: null,
    neighborhoodId: null,
    borough: "Manhattan",
    salePrice: 1_000_000,
    priceType: "closed",
    saleDate: "2026-01-01",
    gsf: null,
    pricePsf: null,
    pricePerUnit: null,
    unitsTotal: null,
    unitsResi: null,
    pctRentStabilized: null,
    noi: null,
    capRate: null,
    grm: null,
    assetType: null,
    buyer: null,
    seller: null,
    saleConditions: [],
    notesShort: null,
    cherryPickRisk: false,
    isSubjectProperty: false,
    confidence: "high",
    rawText: null,
    provenance: provenance("broker_provided"),
    provenanceList: [provenance("broker_provided")],
    lat: null,
    lng: null,
    createdAt: new Date().toISOString(),
  };
  return { ...base, ...partial };
}

describe("classifier coercion", () => {
  it("defaults invalid/missing source_type to broker_provided with low confidence", () => {
    const coerced = coerceClassification({ source_type: "marketing_data", document_class: "om" });
    expect(coerced.source_type).toBe("broker_provided");
    expect(coerced.classifier_confidence).toBe("low");
    expect(coerced.evidence.join(" ")).toContain("defaulted to broker_provided");
  });

  it("defaults a null response to broker_provided / unknown", () => {
    const coerced = coerceClassification(null);
    expect(coerced.source_type).toBe("broker_provided");
    expect(coerced.document_class).toBe("unknown");
  });

  it("samples first three pages plus a middle page", () => {
    const pages = Array.from({ length: 10 }, (_, i) => ({
      pageNumber: i + 1,
      textChars: 10,
      textItems: 1,
      textSample: `page-${i + 1}`,
    }));
    const sample = buildClassifierSample(pages);
    expect(sample).toContain("page-1");
    expect(sample).toContain("page-3");
    expect(sample).toContain("page-6");
    expect(sample).not.toContain("page-9");
  });
});

describe("extraction guards", () => {
  it("injects classifier provenance and ignores any source_type the extractor invents", () => {
    const { comps } = coerceExtraction(
      { comps: [{ address: "1 Test St", source_type: "market_research", page: 3 }], market_stats: [] },
      { ...RESEARCH_CLASSIFICATION, source_type: "broker_provided" },
      "doc_42"
    );
    expect(comps[0].provenance.source_type).toBe("broker_provided");
    expect(comps[0].provenance.document_id).toBe("doc_42");
    expect(comps[0].provenance.page).toBe(3);
  });

  it("enforces cherry_pick_risk on non-subject comps in OM documents and demotes subject closed → asking", () => {
    const { comps, flags } = coerceExtraction(
      {
        comps: [
          { address: "312 East 9th Street", price_type: "closed", is_subject_property: true },
          { address: "326 East 4th Street", price_type: "closed", cherry_pick_risk: false },
        ],
        market_stats: [],
      },
      OM_CLASSIFICATION,
      "doc_om"
    );
    const subject = comps.find((comp) => comp.isSubjectProperty)!;
    expect(subject.priceType).toBe("asking");
    const internal = comps.find((comp) => !comp.isSubjectProperty)!;
    expect(internal.cherryPickRisk).toBe(true);
    expect(flags.join(" ")).toContain("demoted closed → asking");
  });

  it('treats printed "N/A" as null and never infers; percent-style rates become decimals', () => {
    expect(asRate("N/A")).toBeNull();
    expect(asRate("5.82%")).toBeCloseTo(0.0582, 6);
    expect(asRate(5.82)).toBeCloseTo(0.0582, 6);
    expect(asRate(0.0582)).toBeCloseTo(0.0582, 6);
  });
});

describe("neighborhood + submarket resolution", () => {
  const index = buildNeighborhoodIndex(loadSeedNeighborhoods());

  it("resolves alias variants to the polygon id", () => {
    expect(resolveNeighborhoodId("Nolita", index)).toBe("nolita");
    expect(resolveNeighborhoodId("NoLita", index)).toBe("nolita");
    expect(resolveNeighborhoodId("Little Italy", index)).toBe("nolita");
    expect(resolveNeighborhoodId("SoHo", index)).toBe("soho");
    expect(resolveNeighborhoodId("West Chelsea", index)).toBe("chelsea");
    expect(resolveNeighborhoodId("Hell's Kitchen", index)).toBe("hells-kitchen");
    expect(resolveNeighborhoodId("SoHa", index)).toBe("harlem");
    expect(resolveNeighborhoodId("Soho/Nolita", index)).toBe("soho");
  });

  it("sends unknown names to the review queue (null), never guessing", () => {
    expect(resolveNeighborhoodId("Midwood", index)).toBeNull();
    expect(normalizeNeighborhoodName("Hell's Kitchen")).toBe("hellskitchen");
  });

  it("keeps publisher universes distinct when resolving stat scopes", () => {
    expect(resolveSubmarketId("Manhattan below 96th Street", "submarket")).toBe("manhattan_below_96");
    expect(resolveSubmarketId("Manhattan south of 96th St", "submarket")).toBe("manhattan_below_96");
    expect(resolveSubmarketId("Northern Manhattan", "submarket")).toBe("northern_manhattan");
    expect(resolveSubmarketId("Manhattan", "borough")).toBe("manhattan");
    expect(resolveSubmarketId("New York City", "citywide")).toBe("nyc");
  });
});

describe("dedupe", () => {
  it("normalizes address variants to one key", () => {
    expect(normalizeCompAddress("242 Elizabeth St.")).toBe("242 elizabeth street");
    expect(normalizeCompAddress("242 Elizabeth Street, New York, NY")).toBe("242 elizabeth street");
    expect(normalizeCompAddress("210 Sherman Ave")).toBe("210 sherman avenue");
    expect(normalizeCompAddress("159 W 121st St")).toBe("159 west 121 street");
    expect(normalizeCompAddress("159 West 121st Street")).toBe("159 west 121 street");
  });

  it("matches within ±2% price and ±30 days, rejects outside", () => {
    const existing = marketComp({ address: "210 Sherman Avenue", salePrice: 5_800_000, saleDate: "2026-02-25" });
    const incoming = (price: number, date: string): MergedComp => ({
      ...existing,
      addressNormalized: "210 sherman avenue",
      salePrice: price,
      saleDate: date,
      neighborhoodId: null,
      provenanceList: [existing.provenance],
      lat: null,
      lng: null,
    });
    expect(isSameDeal(existing, incoming(5_750_000, "2026-02-21"))).toBe(true);
    expect(isSameDeal(existing, incoming(5_000_000, "2026-02-21"))).toBe(false);
    expect(isSameDeal(existing, incoming(5_750_000, "2026-06-01"))).toBe(false);
  });

  it("prefers research-sourced closed figures and keeps both tags (corroborated)", () => {
    const broker = marketComp({
      id: "comp_b",
      address: "242 Elizabeth Street",
      salePrice: 11_700_000,
      capRate: 0.055,
      priceType: "closed",
      cherryPickRisk: true,
      provenance: provenance("broker_provided", "doc_om"),
      provenanceList: [provenance("broker_provided", "doc_om")],
    });
    const research: MergedComp = {
      address: "242 Elizabeth Street",
      addressNormalized: "242 elizabeth street",
      neighborhoodRaw: "Nolita",
      neighborhoodId: "nolita",
      borough: "Manhattan",
      salePrice: 11_750_000,
      priceType: "closed",
      saleDate: "2026-01-26",
      gsf: 7_667,
      pricePsf: 1_533,
      unitsTotal: 6,
      unitsResi: 5,
      pctRentStabilized: 0,
      capRate: 0.0582,
      assetType: "mixed-use",
      notesShort: null,
      cherryPickRisk: false,
      isSubjectProperty: false,
      confidence: "high",
      rawText: null,
      provenance: provenance("market_research", "doc_ay"),
      provenanceList: [provenance("market_research", "doc_ay")],
      lat: null,
      lng: null,
    };
    const merged = mergeComps(broker, research);
    expect(merged.salePrice).toBe(11_750_000);
    expect(merged.capRate).toBeCloseTo(0.0582, 5);
    expect(merged.priceType).toBe("closed");
    expect(merged.cherryPickRisk).toBe(false);
    expect(merged.provenance.source_type).toBe("market_research");
    expect(merged.provenanceList).toHaveLength(2);
  });
});

describe("rollup", () => {
  const nolita = loadSeedNeighborhoods().find((hood) => hood.id === "nolita")!;
  const asOf = new Date("2026-03-15T12:00:00Z");

  it("returns null medians below min n=3 and excludes asking/cherry-picked records", () => {
    const comps = [
      marketComp({ id: "1", neighborhoodId: "nolita", capRate: 0.05, pricePsf: 1500, saleDate: "2026-01-10" }),
      marketComp({ id: "2", neighborhoodId: "nolita", capRate: 0.06, pricePsf: 1400, saleDate: "2026-02-10" }),
      marketComp({ id: "3", neighborhoodId: "nolita", capRate: 0.045, pricePsf: 1600, saleDate: "2026-02-12", priceType: "asking" }),
      marketComp({ id: "4", neighborhoodId: "nolita", capRate: 0.04, pricePsf: 1700, saleDate: "2026-02-13", cherryPickRisk: true }),
    ];
    const draft = computeNeighborhoodRollup({ neighborhood: nolita, comps, submarketStats: [], asOf });
    expect(draft.compCount12mo).toBe(2);
    expect(draft.medianCapRate).toBeNull();
    expect(draft.nAskingExcluded).toBe(1);
    expect(draft.nCherryPickExcluded).toBe(1);
  });

  it("drops comps older than the trailing 12 months from medians", () => {
    const comps = [
      marketComp({ id: "1", neighborhoodId: "nolita", capRate: 0.05, saleDate: "2026-01-10" }),
      marketComp({ id: "2", neighborhoodId: "nolita", capRate: 0.06, saleDate: "2026-02-10" }),
      marketComp({ id: "3", neighborhoodId: "nolita", capRate: 0.055, saleDate: "2024-12-01" }),
    ];
    const draft = computeNeighborhoodRollup({ neighborhood: nolita, comps, submarketStats: [], asOf });
    expect(draft.compCount12mo).toBe(2);
  });

  it("counts corroborated comps as research in the n split", () => {
    const corroborated = marketComp({
      provenance: provenance("broker_provided"),
      provenanceList: [provenance("broker_provided"), provenance("market_research", "doc_r")],
    });
    expect(effectiveSourceType(corroborated)).toBe("market_research");
  });

  it("median helper handles even counts", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("synthesis validation", () => {
  it("caps bullets at 3 and 120 chars, rejecting outputs with none valid", () => {
    const tooLong = "x".repeat(140);
    expect(validateSynthesisOutput({ bullets: [tooLong] })).toBeNull();
    const valid = validateSynthesisOutput({
      bullets: ["a", "b", "c", "d"],
      regulatory_skew: "mostly free-market",
    })!;
    expect(valid.bullets).toHaveLength(3);
    expect(valid.regulatorySkew).toBe("mostly free-market");
  });

  it("deterministic fallback bullets always carry numbers", () => {
    const nolita = loadSeedNeighborhoods().find((hood) => hood.id === "nolita")!;
    const comps = [
      marketComp({ id: "1", neighborhoodId: "nolita", capRate: 0.05, pricePsf: 1500, saleDate: "2026-01-10" }),
      marketComp({ id: "2", neighborhoodId: "nolita", capRate: 0.06, pricePsf: 1450, saleDate: "2026-02-10" }),
      marketComp({ id: "3", neighborhoodId: "nolita", capRate: 0.055, pricePsf: 1520, saleDate: "2026-02-20" }),
    ];
    const draft = computeNeighborhoodRollup({
      neighborhood: nolita,
      comps,
      submarketStats: [],
      asOf: new Date("2026-03-15T12:00:00Z"),
    });
    const bullets = deterministicBullets(draft);
    expect(bullets.length).toBeGreaterThan(0);
    for (const bullet of bullets) {
      expect(bullet).toMatch(/\d/);
      expect(bullet.length).toBeLessThanOrEqual(120);
    }
  });
});

describe("deal-intel extraction (extract_v2)", () => {
  it("coerces buyer/seller/GRM and whitelists sale_conditions", () => {
    const result = coerceExtraction(
      {
        comps: [
          {
            address: "100 Main Street",
            sale_price: 4_000_000,
            price_type: "closed",
            grm: "14.2",
            buyer: "Acme Property Group LLC",
            seller: "Estate of J. Smith",
            sale_conditions: ["estate_sale", "PORTFOLIO_SALE", "made_up_flag", "estate_sale"],
            page: 3,
          },
        ],
        market_stats: [],
      },
      RESEARCH_CLASSIFICATION,
      "doc_a"
    );
    expect(result.comps).toHaveLength(1);
    const comp = result.comps[0];
    expect(comp.grm).toBe(14.2);
    expect(comp.buyer).toBe("Acme Property Group LLC");
    expect(comp.seller).toBe("Estate of J. Smith");
    // Whitelisted, case-normalized, deduped; invented flags dropped.
    expect(comp.saleConditions).toEqual(["estate_sale", "portfolio_sale"]);
  });

  it("rejects GRM outside the sanity window instead of storing a misread cell", () => {
    const result = coerceExtraction(
      {
        comps: [
          { address: "1 Low St", sale_price: 1, grm: 0.4 },
          { address: "2 High St", sale_price: 1, grm: 950 },
        ],
        market_stats: [],
      },
      RESEARCH_CLASSIFICATION,
      "doc_a"
    );
    expect(result.comps.map((comp) => comp.grm)).toEqual([null, null]);
  });

  it("captures the publisher coverage universe in classification", () => {
    const classification = coerceClassification({
      source_type: "market_research",
      publisher: "Ariel Property Advisors",
      branded: true,
      document_class: "published_report",
      classifier_confidence: "high",
      coverage_universe: "Sales $1M+ in 10+ unit buildings, all Manhattan",
      evidence: [],
    });
    expect(classification.coverage_universe).toBe("Sales $1M+ in 10+ unit buildings, all Manhattan");
  });

  it("keeps portfolio/partial-interest/note/ground-lease prints out of rollup medians", () => {
    const nolita = loadSeedNeighborhoods().find((hood) => hood.id === "nolita")!;
    const asOf = new Date("2026-03-15T12:00:00Z");
    const comps = [
      marketComp({ id: "1", neighborhoodId: "nolita", capRate: 0.05, pricePsf: 1500, saleDate: "2026-01-10" }),
      marketComp({ id: "2", neighborhoodId: "nolita", capRate: 0.06, pricePsf: 1400, saleDate: "2026-02-10" }),
      marketComp({ id: "3", neighborhoodId: "nolita", capRate: 0.055, pricePsf: 1450, saleDate: "2026-02-12" }),
      // A partial-interest print at a distorted $/SF must not move the median…
      marketComp({
        id: "4",
        neighborhoodId: "nolita",
        capRate: 0.09,
        pricePsf: 700,
        saleDate: "2026-02-13",
        saleConditions: ["partial_interest"],
      }),
      // …while an estate sale is a real clearing price and stays in.
      marketComp({
        id: "5",
        neighborhoodId: "nolita",
        capRate: 0.07,
        pricePsf: 1300,
        saleDate: "2026-02-14",
        saleConditions: ["estate_sale"],
      }),
    ];
    const draft = computeNeighborhoodRollup({ neighborhood: nolita, comps, submarketStats: [], asOf });
    expect(draft.compCount12mo).toBe(4);
    expect(draft.medianCapRate).toBe(median([0.05, 0.06, 0.055, 0.07]));
    expect(draft.excludedComps.some((comp) => comp.id === "4")).toBe(true);
  });

  it("merges deal-intel fields across documents (union of condition flags, gap-fill buyer/GRM)", () => {
    const existing = marketComp({
      salePrice: 4_000_000,
      saleDate: "2026-02-01",
      buyer: null,
      grm: null,
      saleConditions: ["estate_sale"],
    });
    const incoming: MergedComp = {
      address: existing.address,
      addressNormalized: normalizeCompAddress(existing.address),
      neighborhoodRaw: null,
      neighborhoodId: null,
      borough: "Manhattan",
      salePrice: 4_000_000,
      priceType: "closed",
      saleDate: "2026-02-01",
      gsf: null,
      pricePsf: null,
      unitsTotal: null,
      unitsResi: null,
      pctRentStabilized: null,
      capRate: null,
      grm: 13.5,
      assetType: null,
      buyer: "Acme Property Group LLC",
      seller: null,
      saleConditions: ["delivered_vacant"],
      notesShort: null,
      cherryPickRisk: false,
      isSubjectProperty: false,
      confidence: "high",
      rawText: null,
      provenance: provenance("market_research", "doc_b"),
      provenanceList: [provenance("market_research", "doc_b")],
      lat: null,
      lng: null,
    };
    const merged = mergeComps(existing, incoming);
    expect(merged.buyer).toBe("Acme Property Group LLC");
    expect(merged.grm).toBe(13.5);
    expect([...merged.saleConditions].sort()).toEqual(["delivered_vacant", "estate_sale"]);
  });
});
