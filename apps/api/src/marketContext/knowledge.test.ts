/**
 * Knowledge-base + document-brief tests: every successful ingest produces a
 * persisted analyst brief, the knowledge base version increments and merges
 * content across documents (deterministic fallback path — the fixture runner
 * returns no knowledge JSON), a valid LLM merge output is honored verbatim,
 * comparison/discrepancy detection fires on conflicting publisher stats, and
 * /api/market-headlines payloads work with and without a knowledge base.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { MarketDocIngestReport } from "@re-sourcing/contracts";
import { ingestMarketDocument } from "./ingestMarketDocument.js";
import { InMemoryMarketContextStore } from "./store.js";
import { FIXTURE_AS_OF, MARKET_DOC_FIXTURES, fixtureLlmRunner, type MarketDocFixture } from "./fixtures.js";
import { loadSeedNeighborhoods } from "./seedNeighborhoods.js";
import type { MarketLlmRunner } from "./llmAdapter.js";
import { MARKET_PROMPT_VERSIONS } from "./prompts.js";
import { computeMarketHeadlines, validateKnowledgeOutput } from "./knowledge.js";

/**
 * Synthetic Q2 follow-up report: same metric/scope/segment as Ariel's $986/SF
 * below-96th stat but from a different publisher at $1,400/SF — exercises the
 * compared-to-prior delta and the cross-publisher discrepancy flag.
 */
const B6_FIXTURE: MarketDocFixture = {
  id: "b6_midyear_q2_2026",
  filename: "b6-midyear-manhattan-q2-2026.txt",
  marker: "Mid-Year Manhattan Multifamily Update | Q2 2026",
  text: `B6 REAL ESTATE ADVISERS
Mid-Year Manhattan Multifamily Update | Q2 2026
Released July 2026 | Investment Research

Methodology: B6 tracks Manhattan multifamily sales below 96th Street.
Free market (incl. 421a) average pricing: $1,400/SF for Q2 2026.
Research & analyst contacts: B6 Investment Research.`,
  classifyResponse: {
    source_type: "market_research",
    publisher: "B6",
    branded: true,
    document_class: "published_report",
    report_title: "Mid-Year Manhattan Multifamily Update Q2 2026",
    period_covered: "Q2 2026",
    geo_scope: "Manhattan below 96th Street",
    subject_property: null,
    classifier_confidence: "high",
    evidence: ["Mid-Year Manhattan Multifamily Update | Q2 2026", "Released July 2026"],
  },
  extractResponse: {
    comps: [],
    market_stats: [
      {
        metric: "avg_price_psf",
        metric_type: "level",
        value: 1400,
        comparison_period: null,
        geo_level: "submarket",
        geo_name: "Manhattan below 96th Street",
        segment: "free_market_incl_421a",
        period: "q2_2026",
        page: 2,
      },
    ],
  },
};

const ALL_FIXTURES = [...MARKET_DOC_FIXTURES, B6_FIXTURE];

let store: InMemoryMarketContextStore;
const reports = new Map<string, MarketDocIngestReport>();

async function ingestAll(target: InMemoryMarketContextStore, llm: MarketLlmRunner, fixtures = ALL_FIXTURES) {
  const out = new Map<string, MarketDocIngestReport>();
  for (const doc of fixtures) {
    out.set(
      doc.id,
      await ingestMarketDocument({
        filename: doc.filename,
        contentType: "text/plain",
        buffer: Buffer.from(doc.text, "utf-8"),
        store: target,
        llm,
        asOf: FIXTURE_AS_OF,
      })
    );
  }
  return out;
}

beforeAll(async () => {
  store = new InMemoryMarketContextStore(loadSeedNeighborhoods());
  // fixtureLlmRunner returns no JSON for the knowledge stage → the pipeline
  // exercises the deterministic (no-model) brief + merge fallback.
  const ingested = await ingestAll(store, fixtureLlmRunner(ALL_FIXTURES));
  for (const [id, report] of ingested) reports.set(id, report);
});

describe("document brief — produced and persisted on every successful ingest", () => {
  it("attaches a brief to every report and document row", () => {
    for (const fixture of ALL_FIXTURES) {
      const report = reports.get(fixture.id)!;
      expect(report.brief, fixture.id).toBeTruthy();
      const doc = store.documents.find((d) => d.id === report.documentId)!;
      expect(doc.documentBrief).toEqual(report.brief);
      expect(report.brief!.promptVersion).toBe(MARKET_PROMPT_VERSIONS.knowledge);
      expect(report.brief!.incorporatedAt).toBe(FIXTURE_AS_OF.toISOString());
    }
  });

  it("whatItSays carries 3-6 bullets, every bullet numbered", () => {
    for (const fixture of ALL_FIXTURES) {
      const brief = reports.get(fixture.id)!.brief!;
      expect(brief.whatItSays.length).toBeGreaterThanOrEqual(3);
      expect(brief.whatItSays.length).toBeLessThanOrEqual(6);
      for (const bullet of brief.whatItSays) expect(bullet).toMatch(/\d/);
    }
  });

  it("uses the report title when present, else the filename", () => {
    expect(reports.get("ay_monthly_jan_feb_2026")!.brief!.title).toBe("Manhattan Monthly Sales Report Jan–Feb 2026");
    expect(reports.get("unbranded_comp_table")!.brief!.title).toBe("unbranded-comp-table.txt");
  });

  it("compares this doc's comps against the existing neighborhood rollups", () => {
    // MM OM: cherry-picked comp set median cap 4.83% vs the 6.28% East Village rollup.
    const brief = reports.get("mm_om_312_e9")!.brief!;
    const line = brief.comparedToPrior.find((entry) => entry.includes("East Village"));
    expect(line).toBeTruthy();
    expect(line).toContain("4.83%");
    expect(line).toContain("6.28%");
  });

  it("flags a wide cherry-picked gap as a discrepancy on deal documents", () => {
    const brief = reports.get("mm_om_312_e9")!.brief!;
    expect(brief.discrepancies.some((entry) => entry.includes("cherry-pick risk"))).toBe(true);
  });

  it("compares same metric/geo/segment stats across publishers with both numbers cited", () => {
    const brief = reports.get("b6_midyear_q2_2026")!.brief!;
    const line = brief.comparedToPrior.find((entry) => entry.includes("$1,400/SF"));
    expect(line).toBeTruthy();
    expect(line).toContain("$986/SF");
    expect(line).toContain("+42.0%");
    expect(line).toContain("B6");
    expect(line).toContain("Ariel Property Advisors");
  });

  it("flags a cross-publisher conflict (>20% on the same metric/scope/segment)", () => {
    const brief = reports.get("b6_midyear_q2_2026")!.brief!;
    expect(brief.discrepancies.some((entry) => entry.includes("$1,400/SF") && entry.includes("$986/SF"))).toBe(true);
  });

  it("does not compare a first upload against rollups built solely from itself", () => {
    expect(reports.get("ay_monthly_jan_feb_2026")!.brief!.comparedToPrior).toEqual([]);
  });
});

describe("knowledge base — version increments and content merges", () => {
  it("appends one versioned entry per ingested document", () => {
    expect(store.knowledgeEntries.map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const fixture of ALL_FIXTURES) {
      const report = reports.get(fixture.id)!;
      const entry = store.knowledgeEntries.find((candidate) => candidate.documentId === report.documentId)!;
      expect(report.knowledgeVersion).toBe(entry.version);
    }
  });

  it("persists raw knowledge-stage output per document with prompt version knowledge_v1", () => {
    const outputs = store.llmOutputs.filter((output) => output.stage === "knowledge");
    expect(outputs).toHaveLength(ALL_FIXTURES.length);
    for (const output of outputs) {
      expect(output.promptVersion).toBe(MARKET_PROMPT_VERSIONS.knowledge);
      expect(output.documentId).toBeTruthy();
    }
  });

  it("accumulates publisher-scoped trends across documents (never blended)", () => {
    const narrative = store.knowledgeEntries.at(-1)!.narrative;
    const scopes = narrative.submarketTrends.map((trend) => trend.scope);
    expect(scopes).toContain("Manhattan south of 96th Street"); // AY (doc 1) survives later merges
    expect(scopes).toContain("Manhattan below 96th Street"); // Ariel + B6
    expect(scopes).toContain("Northern Manhattan"); // Ariel
    expect(scopes).toContain("Manhattan"); // Alpha
    for (const trend of narrative.submarketTrends) {
      for (const claim of trend.claims) {
        expect(claim.text).toMatch(/\d/);
        expect(claim.text.length).toBeLessThanOrEqual(160);
      }
    }
  });

  it("derives submarket direction from publisher deltas with numbers", () => {
    const narrative = store.knowledgeEntries.at(-1)!.narrative;
    const northern = narrative.submarketTrends.find((trend) => trend.scope === "Northern Manhattan")!;
    expect(northern.direction).toBe("up"); // +22% QoQ (Ariel)
    const below96 = narrative.submarketTrends.find((trend) => trend.scope === "Manhattan below 96th Street")!;
    expect(below96.direction).toBe("down"); // -13% QoQ (Ariel); B6 level stat keeps it
  });

  it("keeps both publishers' figures on the same scope after a conflicting upload", () => {
    const narrative = store.knowledgeEntries.at(-1)!.narrative;
    const below96 = narrative.submarketTrends.find((trend) => trend.scope === "Manhattan below 96th Street")!;
    const sources = below96.claims.map((claim) => claim.source);
    expect(sources).toContain("B6");
    expect(sources).toContain("Ariel Property Advisors");
    expect(narrative.discrepancies.some((item) => item.status === "open" && item.detail.includes("$1,400/SF"))).toBe(true);
  });

  it("tracks analyst attention segments (free-market sub-9-unit, RS share, 96th St split)", () => {
    const narrative = store.knowledgeEntries.at(-1)!.narrative;
    const segments = narrative.assetTypeAttention.map((note) => note.segment);
    expect(segments).toContain("free-market sub-9-unit buildings");
    expect(segments).toContain("rent-stabilized ≥50% share");
    expect(segments).toContain("north vs south of 96th St");
    const fmSub9 = narrative.assetTypeAttention.find((note) => note.segment === "free-market sub-9-unit buildings")!;
    expect(fmSub9.note).toMatch(/3 of 26/); // AY's count, retained through later merges
  });

  it("cites every folded-in report as publisher — period", () => {
    const sources = store.knowledgeEntries.at(-1)!.narrative.sources;
    expect(sources).toContain("Avison Young — Jan–Feb 2026");
    expect(sources).toContain("Ariel Property Advisors — Q1 2026");
    expect(sources).toContain("Alpha Realty — Q1 2026");
    expect(sources).toContain("B6 — Q2 2026");
    expect(sources.length).toBe(ALL_FIXTURES.length);
  });
});

describe("knowledge base — LLM merge path", () => {
  const CANNED_KNOWLEDGE: Array<Record<string, unknown>> = [
    {
      document_brief: {
        title: "Manhattan Monthly Sales Report Jan–Feb 2026",
        what_it_says: [
          "$487M across 38 trades south of 96th St (Avison Young, Jan–Feb 2026)",
          "Nolita median cap 5.96% across 4 trades (Avison Young, Jan–Feb 2026)",
          "FM sub-9-unit: 3 of 26 closed comps (Avison Young, Jan–Feb 2026)",
        ],
        compared_to_prior: [],
        discrepancies: [],
      },
      knowledge: {
        as_of: "Jan–Feb 2026",
        submarket_trends: [
          {
            scope: "Manhattan south of 96th St",
            direction: "flat",
            claims: [
              {
                text: "$487M volume across 38 trades (Avison Young, Jan–Feb 2026)",
                metric: "dollar_volume",
                value: 487000000,
                unit: "$",
                source: "Avison Young",
                period: "Jan–Feb 2026",
              },
            ],
          },
        ],
        asset_type_attention: [
          {
            segment: "free-market sub-9-unit buildings",
            attention: "more",
            note: "3 of 26 closed comps FM sub-9-unit (Avison Young, Jan–Feb 2026)",
          },
        ],
        cap_rate_psf_movements: [],
        discrepancies: [],
        sources: ["Avison Young — Jan–Feb 2026"],
      },
    },
    {
      document_brief: {
        title: "Multifamily Quarter In Review Q1 2026",
        what_it_says: [
          "Below-96th FM pricing $986/SF trailing 6-mo (Ariel Property Advisors, Q1 2026)",
          "Below-96th dollar volume -13% QoQ vs Q4 2025 (Ariel Property Advisors)",
          "Northern Manhattan volume +22% QoQ; FM avg $412/SF (Ariel Property Advisors, Q1 2026)",
        ],
        compared_to_prior: ["Ariel Q1 below-96th FM $986/SF vs $1,012/SF prior read — -2.6%"],
        discrepancies: [],
      },
      knowledge: {
        as_of: "Q1 2026",
        submarket_trends: [
          {
            scope: "Manhattan south of 96th St",
            direction: "flat",
            claims: [
              {
                text: "$487M volume across 38 trades (Avison Young, Jan–Feb 2026)",
                metric: "dollar_volume",
                value: 487000000,
                unit: "$",
                source: "Avison Young",
                period: "Jan–Feb 2026",
              },
            ],
          },
          {
            scope: "Northern Manhattan",
            direction: "up",
            claims: [
              {
                text: "Dollar volume +22% QoQ vs Q4 2025 (Ariel Property Advisors)",
                metric: "dollar_volume",
                value: 22,
                unit: "%",
                source: "Ariel Property Advisors",
                period: "QoQ vs Q4 2025",
              },
            ],
          },
        ],
        asset_type_attention: [],
        cap_rate_psf_movements: [
          {
            text: "Below-96th FM avg $986/SF trailing 6-mo (Ariel Property Advisors, Q1 2026)",
            metric: "avg_price_psf",
            value: 986,
            unit: "$/SF",
            source: "Ariel Property Advisors",
            period: "trailing_6mo",
          },
        ],
        discrepancies: [],
        sources: ["Avison Young — Jan–Feb 2026", "Ariel Property Advisors — Q1 2026"],
      },
    },
  ];

  function knowledgeRunner(): MarketLlmRunner {
    const base = fixtureLlmRunner(ALL_FIXTURES);
    let calls = 0;
    return async (request) => {
      if (request.stage !== "knowledge") return base(request);
      const parsed = CANNED_KNOWLEDGE[Math.min(calls, CANNED_KNOWLEDGE.length - 1)];
      calls += 1;
      return {
        provider: "mock",
        model: "fixture-knowledge",
        rawOutput: JSON.stringify(parsed),
        parsed: JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>,
        error: null,
      };
    };
  }

  it("uses the model's brief + merged narrative verbatim and still increments versions", async () => {
    const llmStore = new InMemoryMarketContextStore(loadSeedNeighborhoods());
    const ingested = await ingestAll(llmStore, knowledgeRunner(), MARKET_DOC_FIXTURES.slice(0, 2));

    expect(llmStore.knowledgeEntries.map((entry) => entry.version)).toEqual([1, 2]);
    expect(llmStore.knowledgeEntries.every((entry) => entry.provider === "mock")).toBe(true);

    const ayBrief = ingested.get("ay_monthly_jan_feb_2026")!.brief!;
    expect(ayBrief.whatItSays).toEqual(
      (CANNED_KNOWLEDGE[0].document_brief as { what_it_says: string[] }).what_it_says
    );

    const arielBrief = ingested.get("ariel_mfqir_q1_2026")!.brief!;
    expect(arielBrief.comparedToPrior).toEqual(["Ariel Q1 below-96th FM $986/SF vs $1,012/SF prior read — -2.6%"]);

    // The version-2 narrative retains the AY claim and adds the Ariel ones.
    const final = llmStore.knowledgeEntries.at(-1)!.narrative;
    const scopes = final.submarketTrends.map((trend) => trend.scope);
    expect(scopes).toEqual(["Manhattan south of 96th St", "Northern Manhattan"]);
    expect(final.capRatePsfMovements[0]?.text).toContain("$986/SF");
    expect(final.sources).toHaveLength(2);
  });
});

describe("validateKnowledgeOutput — defensive parsing", () => {
  it("returns nulls for missing/garbage payloads", () => {
    expect(validateKnowledgeOutput(null)).toEqual({ brief: null, narrative: null });
    expect(validateKnowledgeOutput({ nope: 1 })).toEqual({ brief: null, narrative: null });
  });

  it("drops unnumbered claims/bullets and coerces enums to safe values", () => {
    const result = validateKnowledgeOutput({
      document_brief: {
        title: "T",
        what_it_says: ["no numbers here", "Volume $487M across 38 trades (AY)"],
        compared_to_prior: [],
        discrepancies: [],
      },
      knowledge: {
        as_of: "Q1 2026",
        submarket_trends: [
          {
            scope: "UWS",
            direction: "sideways",
            claims: [
              { text: "tightening" },
              { text: "Caps +20bps QoQ (Avison Young, Q1 2026)", metric: "cap_rate", value: 20, unit: "bps", source: "Avison Young", period: "Q1 2026" },
            ],
          },
        ],
        asset_type_attention: [{ segment: "sub-9 FM", attention: "way more", note: "3 of 26 comps (AY)" }],
        cap_rate_psf_movements: [],
        discrepancies: [{ topic: "caps", detail: "5.9% vs 5.6% — +30bps", sources: ["AY"], status: "???" }],
        sources: ["Avison Young — Q1 2026"],
      },
    });
    expect(result.brief!.whatItSays).toEqual(["Volume $487M across 38 trades (AY)"]);
    const trend = result.narrative!.submarketTrends[0];
    expect(trend.direction).toBe("mixed");
    expect(trend.claims).toHaveLength(1);
    expect(trend.claims[0].text).toContain("+20bps");
    expect(result.narrative!.assetTypeAttention[0].attention).toBe("steady");
    expect(result.narrative!.discrepancies[0].status).toBe("open");
  });

  it("rejects a brief whose bullets all fail validation", () => {
    const result = validateKnowledgeOutput({
      document_brief: { title: "T", what_it_says: ["nothing quantified"], compared_to_prior: [], discrepancies: [] },
    });
    expect(result.brief).toBeNull();
  });
});

describe("market headlines — knowledge base first, rule-based fallback, never throws", () => {
  it("serves 3-6 numbered headlines from the knowledge base with its version", () => {
    const payload = computeMarketHeadlines({
      knowledge: store.knowledgeEntries.at(-1)!,
      summaries: [...store.summaries.values()],
      stats: store.stats,
      neighborhoods: loadSeedNeighborhoods(),
    });
    expect(payload.knowledgeVersion).toBe(6);
    expect(payload.generatedAt).toBe(store.knowledgeEntries.at(-1)!.createdAt);
    expect(payload.headlines.length).toBeGreaterThanOrEqual(3);
    expect(payload.headlines.length).toBeLessThanOrEqual(6);
    for (const headline of payload.headlines) {
      expect(headline.id).toBeTruthy();
      expect(headline.text).toMatch(/\d/);
      expect(["up", "down", "neutral", "watch"]).toContain(headline.tone);
    }
  });

  it("falls back to rule-based headlines from summaries + stat deltas when the knowledge base is empty", () => {
    const payload = computeMarketHeadlines({
      knowledge: null,
      summaries: [...store.summaries.values()],
      stats: store.stats,
      neighborhoods: loadSeedNeighborhoods(),
    });
    expect(payload.knowledgeVersion).toBeNull();
    expect(payload.headlines.length).toBeGreaterThan(0);
    expect(payload.headlines.length).toBeLessThanOrEqual(6);
    // Publisher-scoped QoQ deltas surface with directional tones.
    const down = payload.headlines.find((headline) => headline.text.includes("-13"));
    expect(down?.tone).toBe("down");
    expect(down?.source).toBe("Ariel Property Advisors");
    const up = payload.headlines.find((headline) => headline.text.includes("93.8") || headline.text.includes("+22"));
    expect(up?.tone).toBe("up");
    for (const headline of payload.headlines) expect(headline.text).toMatch(/\d/);
  });

  it("returns the empty contract shape when there is no data at all", () => {
    const payload = computeMarketHeadlines({ knowledge: null, summaries: [], stats: [], neighborhoods: [] });
    expect(payload).toEqual({ headlines: [], generatedAt: null, knowledgeVersion: null });
  });
});

describe("executive summary — knowledge_v2 cross-report trends", () => {
  it("parses executive_summary insights (numbered, direction-coerced) from model output", () => {
    const result = validateKnowledgeOutput({
      knowledge: {
        as_of: "Q1 2026",
        executive_summary: [
          { text: "no numbers so dropped" },
          {
            text: "Manhattan MF caps 5.6%→5.9%, Q4'25→Q1'26 (Avison Young)",
            metric: "cap_rate",
            value: 0.059,
            unit: "%",
            source: "Avison Young",
            period: "Q1 2026",
            direction: "up",
          },
          {
            text: "Below-96th $/SF $986 trailing 6-mo (Ariel)",
            direction: "sideways",
          },
        ],
        submarket_trends: [],
        asset_type_attention: [],
        cap_rate_psf_movements: [],
        discrepancies: [],
        sources: ["Avison Young — Q1 2026"],
      },
    });
    const exec = result.narrative!.executiveSummary ?? [];
    expect(exec).toHaveLength(2);
    expect(exec[0].direction).toBe("up");
    expect(exec[0].source).toBe("Avison Young");
    expect(exec[1].direction).toBeNull();
  });

  it("deterministic merge derives a non-empty executive summary from cross-period stat deltas", () => {
    const latest = store.knowledgeEntries.at(-1)!;
    const exec = latest.narrative.executiveSummary ?? [];
    expect(exec.length).toBeGreaterThan(0);
    for (const insight of exec) expect(insight.text).toMatch(/\d/);
  });

  it("headlines lead with executive-summary insights and dedupe case/whitespace variants", () => {
    const latest = store.knowledgeEntries.at(-1)!;
    const withExec = {
      ...latest,
      narrative: {
        ...latest.narrative,
        executiveSummary: [
          {
            text: "Manhattan MF caps 5.6%→5.9%, Q4'25→Q1'26 (AY)",
            metric: null,
            value: null,
            unit: null,
            source: "Avison Young",
            period: "Q1 2026",
            direction: "up" as const,
          },
        ],
        submarketTrends: [
          {
            scope: "Manhattan",
            direction: "up" as const,
            claims: [
              {
                text: "MANHATTAN MF CAPS  5.6%→5.9%, Q4'25→Q1'26 (AY)",
                metric: null,
                value: null,
                unit: null,
                source: "Avison Young",
                period: "Q1 2026",
              },
            ],
          },
        ],
      },
    };
    const payload = computeMarketHeadlines({
      knowledge: withExec,
      summaries: [],
      stats: [],
      neighborhoods: [],
    });
    expect(payload.headlines[0].text).toBe("Manhattan MF caps 5.6%→5.9%, Q4'25→Q1'26 (AY)");
    expect(payload.headlines[0].tone).toBe("up");
    // The near-duplicate trend claim (case/whitespace variant) must not repeat.
    const texts = payload.headlines.map((headline) => headline.text.toLowerCase().replace(/\s+/g, " "));
    expect(new Set(texts).size).toBe(texts.length);
  });
});
