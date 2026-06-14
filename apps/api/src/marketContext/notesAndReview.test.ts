/**
 * Market docs usability push — per-document analyst notes (read → refine
 * chain + deterministic fallback), the comp review gate (pending on insert,
 * merge semantics, rollup exclusion of rejected comps), and the live AI
 * review (validation, deterministic digest bubbling per-doc notes, QoQ
 * pairing, staleness).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { MarketDocument, MarketStat } from "@re-sourcing/contracts";
import type { MarketLlmRunner } from "./llmAdapter.js";
import { ingestMarketDocument } from "./ingestMarketDocument.js";
import { InMemoryMarketContextStore } from "./store.js";
import { FIXTURE_AS_OF, MARKET_DOC_FIXTURES, fixtureLlmRunner } from "./fixtures.js";
import { loadSeedNeighborhoods } from "./seedNeighborhoods.js";
import { generateDocumentNotes, validateNotesOutput } from "./notes.js";
import {
  deterministicQoqComparisons,
  deterministicReview,
  isReviewStale,
  refreshMarketReview,
  validateReviewOutput,
} from "./review.js";

function fixture(id: string) {
  const found = MARKET_DOC_FIXTURES.find((f) => f.id === id);
  if (!found) throw new Error(`missing fixture ${id}`);
  return found;
}

describe("comp review gate in the ingest pipeline", () => {
  let store: InMemoryMarketContextStore;

  beforeAll(async () => {
    store = new InMemoryMarketContextStore(loadSeedNeighborhoods());
    const llm = fixtureLlmRunner();
    for (const doc of MARKET_DOC_FIXTURES) {
      await ingestMarketDocument({
        filename: doc.filename,
        contentType: "text/plain",
        buffer: Buffer.from(doc.text, "utf-8"),
        store,
        llm,
        asOf: FIXTURE_AS_OF,
      });
    }
  });

  it("new extractions land pending (the user review queue)", () => {
    expect(store.comps.length).toBeGreaterThan(0);
    expect(store.comps.every((comp) => comp.reviewStatus === "pending")).toBe(true);
  });

  it("pending comps stay out of rollups until approved; rejected ones stay out", async () => {
    const nolita = store.comps.filter((comp) => comp.neighborhoodId === "nolita");
    expect(nolita.length).toBeGreaterThanOrEqual(3);
    const before = await store.listCompsByNeighborhoods(["nolita"]);
    expect(before.length).toBe(0);

    await store.setCompReviewStatus([nolita[0].id], "approved");
    const approved = await store.listCompsByNeighborhoods(["nolita"]);
    expect(approved.map((comp) => comp.id)).toEqual([nolita[0].id]);

    await store.setCompReviewStatus([nolita[0].id], "rejected");
    const rejected = await store.listCompsByNeighborhoods(["nolita"]);
    expect(rejected.length).toBe(0);
  });

  it("a dedupe merge keeps the existing review decision, except rejected reopens as pending", async () => {
    // 210 Sherman Ave is corroborated by Ariel and Alpha across fixtures.
    const sherman = store.comps.find((comp) => comp.address.includes("210 Sherman"));
    expect(sherman).toBeDefined();
    const comp = sherman!;

    await store.setCompReviewStatus([comp.id], "rejected");
    const ariel = fixture("ariel_mfqir_q1_2026");
    await ingestMarketDocument({
      filename: "ariel-reupload.txt",
      contentType: "text/plain",
      buffer: Buffer.from(ariel.text, "utf-8"),
      store,
      llm: fixtureLlmRunner(),
      asOf: FIXTURE_AS_OF,
    });
    const reloaded = store.comps.find((candidate) => candidate.id === comp.id);
    expect(reloaded?.reviewStatus).toBe("pending");
  });
});

describe("per-document analyst notes", () => {
  it("falls back to deterministic numbers-only notes when no model is configured", async () => {
    const store = new InMemoryMarketContextStore(loadSeedNeighborhoods());
    const doc = fixture("ay_monthly_jan_feb_2026");
    const report = await ingestMarketDocument({
      filename: doc.filename,
      contentType: "text/plain",
      buffer: Buffer.from(doc.text, "utf-8"),
      store,
      llm: fixtureLlmRunner(),
      asOf: FIXTURE_AS_OF,
    });
    expect(report.notesGenerated).toBe(true);
    const stored = store.documents.find((d) => d.id === report.documentId);
    expect(stored?.llmNotes).toBeTruthy();
    const notes = stored!.llmNotes!;
    expect(notes.promptVersion).toBe("deterministic");
    expect(notes.providers).toContain("deterministic");
    expect(notes.overview.length).toBeGreaterThan(0);
    // Every deterministic bullet carries a number (no adjectives without numbers).
    expect(notes.overview.every((line) => /\d/.test(line))).toBe(true);
    expect(notes.neighborhoods.length).toBeGreaterThan(0);
  });

  it("prefers the refine pass over the read pass and records the provider chain", async () => {
    const store = new InMemoryMarketContextStore(loadSeedNeighborhoods());
    const readNotes = {
      title: "Read pass",
      period_covered: "Q1 2026",
      overview: ["Manhattan MF volume $839.7M, -8.1% YoY (PropertyShark Q1 2026)"],
      neighborhoods: [{ name: "Nolita", takeaway: "4 trades at $1,445-$1,562/SF" }],
      asset_types: [],
      buyer_activity: ["Institutional buyers 22% of dollar volume, up from 15% (Q1 2026)"],
      notable_transactions: [],
      cap_rate_psf: [],
      financing: [],
      small_building_focus: [],
      regulatory: [],
      risks_watch_items: [],
      investment_relevance: [],
    };
    const refinedNotes = {
      ...readNotes,
      title: "Refined",
      overview: ["Manhattan MF $/SF $649 median, +12.6% YoY (PropertyShark Q1 2026)"],
    };
    const llm: MarketLlmRunner = async (request) => {
      if (request.stage !== "notes") {
        return { provider: "mock", model: "fixture", rawOutput: null, parsed: null, error: "not handled" };
      }
      const isRefine = request.prompt.includes("DRAFT NOTES");
      const parsed = (isRefine ? refinedNotes : readNotes) as unknown as Record<string, unknown>;
      return {
        provider: isRefine ? "openai" : "gemini",
        model: isRefine ? "gpt-5.5" : "gemini-3-flash-preview",
        rawOutput: JSON.stringify(parsed),
        parsed,
        error: null,
      };
    };

    const notes = await generateDocumentNotes({
      documentId: "doc_test",
      filename: "report.pdf",
      classification: {
        source_type: "market_research",
        publisher: "PropertyShark",
        branded: true,
        document_class: "published_report",
        report_title: "Manhattan Multifamily Market Trends",
        period_covered: "Q1 2026",
        geo_scope: "Manhattan",
        coverage_universe: null,
        subject_property: null,
        classifier_confidence: "high",
        evidence: [],
      },
      pdf: null,
      documentText: "text",
      comps: [],
      stats: [],
      store,
      llm,
      asOf: FIXTURE_AS_OF,
    });

    expect(notes.title).toBe("Refined");
    expect(notes.promptVersion).toBe("notes_refine_v2");
    expect(notes.providers).toEqual(["gemini/gemini-3-flash-preview", "openai/gpt-5.5"]);
    expect(notes.sourceLabel).toContain("PropertyShark");
    // Both raw outputs persisted under the notes stage.
    expect(store.llmOutputs.filter((output) => output.stage === "notes")).toHaveLength(2);
  });

  it("rejects content-free model output", () => {
    expect(validateNotesOutput(null)).toBeNull();
    expect(validateNotesOutput({ title: "Empty", overview: [], neighborhoods: [] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Live AI review.
// ---------------------------------------------------------------------------

function statRow(params: {
  publisher: string;
  metric: string;
  value: number;
  period: string;
  geoName?: string;
  createdAt?: string;
}): MarketStat {
  return {
    id: `stat-${params.publisher}-${params.metric}-${params.period}`,
    documentId: null,
    metric: params.metric,
    metricType: "level",
    value: params.value,
    comparisonPeriod: null,
    geoLevel: "submarket",
    geoName: params.geoName ?? "Manhattan",
    submarketId: "manhattan",
    segment: null,
    period: params.period,
    provenance: {
      source_type: "market_research",
      publisher: params.publisher,
      branded: true,
      document_class: "published_report",
      document_id: "doc",
      report_title: null,
      page: null,
      classifier_confidence: "high",
    },
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

function documentRow(params: {
  id: string;
  publisher: string;
  period: string;
  smallBuildingFocus?: string[];
  buyerActivity?: string[];
}): MarketDocument {
  return {
    id: params.id,
    filename: `${params.id}.pdf`,
    contentType: "application/pdf",
    status: "synthesized",
    source_type: "market_research",
    publisher: params.publisher,
    branded: true,
    document_class: "published_report",
    report_title: `${params.publisher} report`,
    period_covered: params.period,
    geo_scope: "Manhattan",
    coverage_universe: null,
    subject_property: null,
    classifier_confidence: "high",
    evidence: [],
    flagForReview: false,
    error: null,
    ingestReport: null,
    documentBrief: null,
    llmNotes: {
      title: `${params.publisher} report`,
      sourceLabel: `${params.publisher} — ${params.period}`,
      periodCovered: params.period,
      overview: [`${params.publisher} overview with 42 trades`],
      neighborhoods: [],
      assetTypes: [],
      buyerActivity: params.buyerActivity ?? [],
      notableTransactions: [],
      capRatePsf: [],
      financing: [],
      smallBuildingFocus: params.smallBuildingFocus ?? [],
      regulatory: [],
      risksWatchItems: [],
      investmentRelevance: [],
      generatedAt: new Date().toISOString(),
      promptVersion: "notes_refine_v2",
      providers: ["mock"],
    },
    excludedAt: null,
    excludedReason: null,
    createdAt: new Date().toISOString(),
  };
}

describe("live AI review", () => {
  it("pairs same-publisher level stats across periods into QoQ comparisons", () => {
    const stats = [
      statRow({ publisher: "Avison Young", metric: "avg_cap_rate", value: 5.6, period: "Q4 2025", createdAt: "2026-01-01T00:00:00Z" }),
      statRow({ publisher: "Avison Young", metric: "avg_cap_rate", value: 5.9, period: "Q1 2026", createdAt: "2026-04-01T00:00:00Z" }),
      // Different publisher — never blended into the AY series.
      statRow({ publisher: "Alpha Realty", metric: "avg_cap_rate", value: 6.2, period: "Q1 2026" }),
    ];
    const comparisons = deterministicQoqComparisons(stats);
    expect(comparisons).toHaveLength(1);
    expect(comparisons[0].publisher).toBe("Avison Young");
    expect(comparisons[0].fromPeriod).toBe("Q4 2025");
    expect(comparisons[0].toPeriod).toBe("Q1 2026");
    expect(comparisons[0].changes[0]).toContain("+30bps");
  });

  it("deterministic digest bubbles up per-document notes with publisher tags", () => {
    const documents = [
      documentRow({
        id: "doc-a",
        publisher: "Ariel",
        period: "Q1 2026",
        smallBuildingFocus: ["Sub-10-unit FM walk-ups median $720/SF"],
        buyerActivity: ["Private buyers 68% of trades"],
      }),
      documentRow({ id: "doc-b", publisher: "Alpha Realty", period: "Q1 2026" }),
    ];
    const review = deterministicReview({ documents, stats: [], knowledge: null });
    expect(review.headline).toContain("2 reports");
    expect(review.smallMultifamilyFocus[0]).toContain("Sub-10-unit");
    expect(review.smallMultifamilyFocus[0]).toContain("[Ariel]");
    expect(review.buyerSellerActivity[0]).toContain("Private buyers 68%");
    expect(review.sources).toHaveLength(2);
  });

  it("refreshMarketReview validates model output and records the included document set", async () => {
    const documents = [
      documentRow({ id: "doc-a", publisher: "Ariel", period: "Q1 2026" }),
      documentRow({ id: "doc-b", publisher: "Ariel", period: "Q2 2026" }),
    ];
    const modelReview = {
      headline: "Manhattan small MF caps widening into Q2 2026",
      market_pulse: ["Ariel Manhattan MF caps 5.6%→5.9% Q1→Q2 2026 (+30bps)"],
      small_multifamily_focus: ["Sub-10-unit FM pricing -4% QoQ to $698/SF (Ariel Q2 2026)"],
      cap_rate_trends: [],
      buyer_seller_activity: [],
      loan_environment: [],
      opportunities: [],
      qoq_comparisons: [
        { publisher: "Ariel", from_period: "Q1 2026", to_period: "Q2 2026", changes: ["caps 5.6%→5.9% (+30bps)"] },
      ],
      discrepancies: [],
      sources: [],
    } as unknown as Record<string, unknown>;
    const llm: MarketLlmRunner = async (request) => ({
      provider: request.provider ?? "openai",
      model: "gpt-5.5",
      rawOutput: JSON.stringify(modelReview),
      parsed: modelReview,
      error: null,
    });

    const saved: Array<Record<string, unknown>> = [];
    const record = await refreshMarketReview({
      documents,
      stats: [],
      knowledge: null,
      llm,
      saveLlmOutput: async (params) => {
        saved.push(params as unknown as Record<string, unknown>);
      },
      appendReview: async (params) => ({
        id: "rev-1",
        version: 1,
        review: params.review,
        includedDocumentIds: params.includedDocumentIds,
        promptVersion: params.promptVersion,
        provider: params.provider,
        model: params.model,
        createdAt: new Date().toISOString(),
      }),
    });

    expect(record.review.headline).toContain("Q2 2026");
    expect(record.review.qoqComparisons).toHaveLength(1);
    // Sources always come from the corpus, not the model.
    expect(record.review.sources).toHaveLength(2);
    expect(record.includedDocumentIds.sort()).toEqual(["doc-a", "doc-b"]);
    expect(record.promptVersion).toBe("review_v2");
    expect(saved).toHaveLength(1);
  });

  it("flags staleness when the included document set changes (remove or add)", () => {
    const record = {
      id: "rev",
      version: 3,
      review: deterministicReview({ documents: [], stats: [], knowledge: null }),
      includedDocumentIds: ["doc-a", "doc-b"],
      promptVersion: null,
      provider: null,
      model: null,
      createdAt: new Date().toISOString(),
    };
    expect(isReviewStale(record, ["doc-a", "doc-b"])).toBe(false);
    expect(isReviewStale(record, ["doc-a"])).toBe(true);
    expect(isReviewStale(record, ["doc-a", "doc-b", "doc-c"])).toBe(true);
    expect(isReviewStale(null, [])).toBe(false);
    expect(isReviewStale(null, ["doc-a"])).toBe(true);
  });

  it("rejects content-free review output", () => {
    expect(validateReviewOutput(null)).toBeNull();
    expect(validateReviewOutput({ headline: "x", market_pulse: [], small_multifamily_focus: [] })).toBeNull();
  });
});
