/**
 * Acceptance tests (Part 6) — full pipeline over the five Q1 2026 fixture
 * documents through the in-memory store with the fixture LLM runner:
 * classification, provenance, neighborhood resolution, cross-document dedupe,
 * rollup exclusions, publisher-conflict guard, and the popup payload fields.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { MarketComp, MarketDocIngestReport } from "@re-sourcing/contracts";
import { ingestMarketDocument } from "./ingestMarketDocument.js";
import { InMemoryMarketContextStore } from "./store.js";
import { FIXTURE_AS_OF, MARKET_DOC_FIXTURES, fixtureLlmRunner } from "./fixtures.js";
import { loadSeedNeighborhoods } from "./seedNeighborhoods.js";
import { computeNeighborhoodRollup, pickFallbackStat, withReadTimeFallback } from "./rollup.js";
import { normalizeCompAddress } from "./dedupe.js";

let store: InMemoryMarketContextStore;
const reports = new Map<string, MarketDocIngestReport>();

function fixture(id: string) {
  const found = MARKET_DOC_FIXTURES.find((f) => f.id === id);
  if (!found) throw new Error(`missing fixture ${id}`);
  return found;
}

function compsIn(neighborhoodId: string): MarketComp[] {
  return store.comps.filter((comp) => comp.neighborhoodId === neighborhoodId);
}

beforeAll(async () => {
  store = new InMemoryMarketContextStore(loadSeedNeighborhoods());
  const llm = fixtureLlmRunner();
  for (const doc of MARKET_DOC_FIXTURES) {
    const report = await ingestMarketDocument({
      filename: doc.filename,
      contentType: "text/plain",
      buffer: Buffer.from(doc.text, "utf-8"),
      store,
      llm,
      asOf: FIXTURE_AS_OF,
    });
    reports.set(doc.id, report);
  }
});

describe("acceptance 1 — Avison Young Monthly Jan–Feb 2026", () => {
  it("classifies as market_research / published_report by Avison Young", () => {
    const report = reports.get("ay_monthly_jan_feb_2026")!;
    expect(report.sourceType).toBe("market_research");
    expect(report.publisher).toBe("Avison Young");
    expect(report.documentClass).toBe("published_report");
    expect(report.flagForReview).toBe(false);
  });

  it("extracts 25+ comps, all carrying research provenance injected by code", () => {
    const report = reports.get("ay_monthly_jan_feb_2026")!;
    expect(report.nComps).toBeGreaterThanOrEqual(25);
    const ayComps = store.comps.filter((comp) => comp.provenance.report_title?.includes("Manhattan Monthly"));
    expect(ayComps.length).toBeGreaterThanOrEqual(25);
    for (const comp of ayComps) {
      expect(comp.provenance.source_type).toBe("market_research");
      expect(comp.provenance.publisher).toBe("Avison Young");
      expect(comp.provenance.page).not.toBeNull();
    }
  });

  it("resolves 4 Nolita comps incl. 242 Elizabeth St and 17 Prince St", () => {
    const nolita = compsIn("nolita");
    expect(nolita).toHaveLength(4);
    const elizabeth = nolita.find((comp) => comp.address === "242 Elizabeth Street")!;
    expect(elizabeth.pricePsf).toBe(1533);
    expect(elizabeth.capRate).toBeCloseTo(0.0582, 5);
    expect(elizabeth.saleDate).toBe("2026-01-26");
    expect(elizabeth.priceType).toBe("closed");
    const prince = nolita.find((comp) => comp.address === "17 Prince Street")!;
    expect(prince.capRate).toBeCloseTo(0.0467, 5);
    expect(prince.pctRentStabilized).toBeCloseTo(0.4, 5);
  });

  it("computes the Nolita median from ≥3 closed comps with numbers-only bullets", () => {
    const summary = store.summaries.get("nolita")!;
    expect(summary.compCount12mo).toBe(4);
    expect(summary.nResearch).toBe(4);
    expect(summary.nBroker).toBe(0);
    expect(summary.medianCapRate).toBeCloseTo(0.0596, 4);
    expect(summary.capRateRange).toEqual([0.0467, 0.0615]);
    expect(summary.medianPsf).toBe(1541);
    expect(summary.bullets.length).toBeGreaterThan(0);
    for (const bullet of summary.bullets) {
      expect(bullet.length).toBeLessThanOrEqual(120);
      expect(bullet).toMatch(/\d/);
    }
  });

  it("keeps the N/A cap rate null instead of inferring (315 East 65th St)", () => {
    const lenox = store.comps.find((comp) => comp.address === "315 East 65th Street")!;
    expect(lenox.capRate).toBeNull();
    expect(lenox.confidence).toBe("low");
    expect(lenox.rawText).toContain("N/A");
  });
});

describe("acceptance 2 — Ariel MFQIR Q1 2026", () => {
  it("classifies as market_research", () => {
    const report = reports.get("ariel_mfqir_q1_2026")!;
    expect(report.sourceType).toBe("market_research");
    expect(report.publisher).toBe("Ariel Property Advisors");
  });

  it("lands the $986/SF figure as a below-96th submarket level stat honoring the trailing-6mo footnote", () => {
    const stat = store.stats.find((s) => s.value === 986)!;
    expect(stat.metric).toBe("avg_price_psf");
    expect(stat.metricType).toBe("level");
    expect(stat.geoName).toBe("Manhattan below 96th Street");
    expect(stat.submarketId).toBe("manhattan_below_96");
    expect(stat.period).toBe("trailing_6mo");
    expect(stat.segment).toBe("free_market_incl_421a");
  });

  it("stores QoQ figures as pct_change with comparison_period, never as levels", () => {
    const qoq = store.stats.filter((s) => s.metricType === "pct_change");
    expect(qoq.length).toBeGreaterThanOrEqual(2);
    for (const stat of qoq) {
      expect(stat.comparisonPeriod).toMatch(/QoQ/);
    }
    const arielQoq = store.stats.find((s) => s.value === -13)!;
    expect(arielQoq.metricType).toBe("pct_change");
    expect(arielQoq.geoName).toBe("Manhattan below 96th Street");
    // No price level anywhere carries a percent-change magnitude by mistake.
    const levels = store.stats.filter((s) => s.metricType === "level");
    expect(levels.every((s) => s.value !== -13 && s.value !== 93.8)).toBe(true);
  });
});

describe("acceptance 3 — unbranded comp table", () => {
  it("defaults to broker_provided / comp_list with null publisher and branded=false", () => {
    const report = reports.get("unbranded_comp_table")!;
    expect(report.sourceType).toBe("broker_provided");
    expect(report.documentClass).toBe("comp_list");
    expect(report.publisher).toBeNull();
    const doc = store.documents.find((d) => d.id === report.documentId)!;
    expect(doc.branded).toBe(false);
    expect(doc.publisher).toBeNull();
  });
});

describe("acceptance 4 — branded Marcus & Millichap OM", () => {
  it("stays broker_provided despite branding; document_class om; branded true", () => {
    const report = reports.get("mm_om_312_e9")!;
    expect(report.sourceType).toBe("broker_provided");
    expect(report.documentClass).toBe("om");
    expect(report.publisher).toBe("Marcus & Millichap");
    const doc = store.documents.find((d) => d.id === report.documentId)!;
    expect(doc.branded).toBe(true);
  });

  it("flags the subject property and keeps its asking price out of medians", () => {
    const subject = store.comps.find((comp) => comp.address === "312 East 9th Street")!;
    expect(subject.isSubjectProperty).toBe(true);
    expect(subject.priceType).toBe("asking");

    const summary = store.summaries.get("east-village")!;
    expect(summary.nAskingExcluded).toBeGreaterThanOrEqual(1);
    // Medians built only from closed non-cherry-picked comps: 0.0641/0.059/0.068 (AY) + 0.0615 (unbranded).
    expect(summary.compCount12mo).toBe(5);
    expect(summary.medianCapRate).toBeCloseTo(0.0628, 4);
    expect(summary.capRateRange?.[0]).toBeGreaterThanOrEqual(0.059);
  });

  it("marks internal comps cherry_pick_risk and excludes them from medians by default", () => {
    const internal = store.comps.filter(
      (comp) => comp.provenance.document_class === "om" && !comp.isSubjectProperty
    );
    expect(internal).toHaveLength(3);
    for (const comp of internal) {
      expect(comp.cherryPickRisk).toBe(true);
      expect(comp.provenance.source_type).toBe("broker_provided");
    }
    const summary = store.summaries.get("east-village")!;
    expect(summary.nCherryPickExcluded).toBe(3);
  });
});

describe("acceptance 5 — cross-document dedupe (210 Sherman Ave)", () => {
  it("keeps exactly one comp row with merged provenance from Ariel and Alpha", () => {
    const sherman = store.comps.filter(
      (comp) => normalizeCompAddress(comp.address) === "210 sherman avenue"
    );
    expect(sherman).toHaveLength(1);
    const merged = sherman[0];
    const publishers = merged.provenanceList.map((p) => p.publisher).sort();
    expect(publishers).toEqual(["Alpha Realty", "Ariel Property Advisors"]);
    // Ariel's richer record supplies the figures.
    expect(merged.salePrice).toBe(5_800_000);
    expect(merged.capRate).toBeCloseTo(0.071, 5);
    expect(merged.unitsTotal).toBe(48);
    const report = reports.get("alpha_market_trends_q1_2026")!;
    expect(report.nCompsMerged).toBe(1);
  });
});

describe("acceptance 6 — publisher conflict guard", () => {
  it("falls back to a single publisher-labeled stat when a neighborhood is below min n", () => {
    const summary = store.summaries.get("inwood")!;
    expect(summary.compCount12mo).toBe(1);
    expect(summary.medianCapRate).toBeNull();
    expect(summary.fallbackContext).toContain("Northern Manhattan");
    expect(summary.fallbackContext).toContain("Ariel Property Advisors");
    expect(summary.fallbackContext).not.toContain("Alpha");
  });

  it("never blends Ariel and Alpha Manhattan aggregates — fallback returns one verbatim stat row", () => {
    const chinatown = loadSeedNeighborhoods().find((hood) => hood.id === "chinatown")!;
    const stat = pickFallbackStat(chinatown, store.stats);
    expect(stat).not.toBeNull();
    // Most specific scope wins: Ariel's below-96th figure, not Alpha's all-Manhattan one.
    expect(stat!.value).toBe(986);
    expect(stat!.provenance.publisher).toBe("Ariel Property Advisors");
    // The picked stat is one of the stored rows verbatim — no synthetic blended value.
    expect(store.stats.some((candidate) => candidate.id === stat!.id)).toBe(true);
  });

  it("never backs a fallback with volume/transaction stats (only pricing levels qualify)", () => {
    const westVillage = loadSeedNeighborhoods().find((hood) => hood.id === "west-village")!;
    const volumeOnly = store.stats.filter((stat) => /dollar_volume|transaction_count/.test(stat.metric));
    expect(volumeOnly.length).toBeGreaterThan(0);
    expect(pickFallbackStat(westVillage, volumeOnly)).toBeNull();
  });

  it("overlays the freshest single-publisher fallback at read time for thin hoods synthesized earlier", () => {
    // east-harlem was summarized during the AY ingest, before Ariel's Northern
    // Manhattan stat existed; the read path must surface it without re-synthesis.
    const eastHarlem = loadSeedNeighborhoods().find((hood) => hood.id === "east-harlem")!;
    const stored = store.summaries.get("east-harlem")!;
    expect(stored.medianCapRate).toBeNull();
    const overlaid = withReadTimeFallback(stored, eastHarlem, store.stats);
    expect(overlaid.fallbackContext).toContain("Northern Manhattan");
    expect(overlaid.fallbackContext).toContain("$412/SF");
    expect(overlaid.fallbackContext).toContain("Ariel Property Advisors");
  });

  it("renders a fallback-only rollup for a neighborhood with 0 closed comps (hatched fill case)", () => {
    const chinatown = loadSeedNeighborhoods().find((hood) => hood.id === "chinatown")!;
    const draft = computeNeighborhoodRollup({
      neighborhood: chinatown,
      comps: store.comps,
      submarketStats: store.stats,
      asOf: FIXTURE_AS_OF,
    });
    expect(draft.compCount12mo).toBe(0);
    expect(draft.medianCapRate).toBeNull();
    expect(draft.fallbackContext).toContain("(Ariel Property Advisors, trailing 6-mo)");
  });
});

describe("acceptance 7 — popup payload (n split + per-comp source badges)", () => {
  it("nolita popup payload exposes the n split and per-comp provenance for badges", () => {
    const summary = store.summaries.get("nolita")!;
    expect(`n=${summary.compCount12mo} · ${summary.nResearch} research / ${summary.nBroker} broker`).toBe(
      "n=4 · 4 research / 0 broker"
    );
    expect(summary.topComps.length).toBeGreaterThanOrEqual(3);
    for (const comp of summary.topComps) {
      expect(comp.provenanceList.length).toBeGreaterThan(0);
      expect(["market_research", "broker_provided"]).toContain(comp.provenance.source_type);
    }
    expect(summary.sources.join(" ")).toContain("Manhattan Monthly");
  });
});
