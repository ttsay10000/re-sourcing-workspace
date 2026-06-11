/**
 * Market context layer: broker/research PDF ingestion → classified documents,
 * extracted comps + market stats with provenance, per-neighborhood rollups.
 *
 * Non-negotiable: every comp and market stat carries a two-value `source_type`
 * provenance tag. `broker_provided` is the default; `market_research` is
 * reserved for published, branded periodical research reports.
 */

export type MarketSourceType = "broker_provided" | "market_research";

export type MarketDocumentClass =
  | "published_report"
  | "om"
  | "bov"
  | "comp_list"
  | "email"
  | "unknown";

export type ClassifierConfidence = "high" | "medium" | "low";

export type MarketPriceType = "closed" | "asking" | "in_contract" | "unknown";

export type MarketAssetType =
  | "multifamily"
  | "mixed-use"
  | "office"
  | "retail"
  | "development"
  | "conversion";

export type MarketGeoLevel = "address" | "neighborhood" | "submarket" | "borough" | "citywide";

export type MarketMetricType = "level" | "pct_change";

/** Provenance object stored on every extracted record. Injected by code, never by the extractor. */
export interface MarketProvenance {
  source_type: MarketSourceType;
  /** null when unbranded/generic. */
  publisher: string | null;
  /** Firm branding present anywhere in the document. Branding alone ≠ research. */
  branded: boolean;
  document_class: MarketDocumentClass;
  document_id: string;
  report_title: string | null;
  page: number | null;
  classifier_confidence: ClassifierConfidence;
}

/** Classifier output persisted on the market_documents row. */
export interface MarketDocClassification {
  source_type: MarketSourceType;
  publisher: string | null;
  branded: boolean;
  document_class: MarketDocumentClass;
  report_title: string | null;
  period_covered: string | null;
  geo_scope: string | null;
  subject_property: string | null;
  classifier_confidence: ClassifierConfidence;
  evidence: string[];
}

export interface MarketDocument extends MarketDocClassification {
  id: string;
  filename: string;
  contentType: string | null;
  status: "uploaded" | "classified" | "extracted" | "synthesized" | "failed";
  flagForReview: boolean;
  error: string | null;
  ingestReport: MarketDocIngestReport | null;
  /** Analyst brief for this upload (knowledge-base step; null before it runs). */
  documentBrief?: MarketDocumentBrief | null;
  createdAt: string;
}

/** Extracted comp row. Mirrors the market_comps table. */
export interface MarketComp {
  id: string;
  documentId: string | null;
  address: string;
  /** Verbatim neighborhood string from the document; never normalized. */
  neighborhoodRaw: string | null;
  /** Resolved against the neighborhoods polygon list; null = review queue. */
  neighborhoodId: string | null;
  borough: string | null;
  salePrice: number | null;
  priceType: MarketPriceType;
  saleDate: string | null;
  gsf: number | null;
  pricePsf: number | null;
  unitsTotal: number | null;
  unitsResi: number | null;
  pctRentStabilized: number | null;
  /** Decimal (0.0582 = 5.82%); null when printed "N/A" — never inferred. */
  capRate: number | null;
  assetType: MarketAssetType | null;
  notesShort: string | null;
  /** true for comp tables inside OMs/BOVs. */
  cherryPickRisk: boolean;
  /** true for the OM's own asset. */
  isSubjectProperty: boolean;
  confidence: ClassifierConfidence;
  /** Populated when confidence = low. */
  rawText: string | null;
  provenance: MarketProvenance;
  /** All sources after cross-document dedupe (corroborated comps carry >1). */
  provenanceList: MarketProvenance[];
  lat: number | null;
  lng: number | null;
  createdAt: string;
}

/** Extracted aggregate market stat. Mirrors the market_stats table. */
export interface MarketStat {
  id: string;
  documentId: string | null;
  metric: string;
  metricType: MarketMetricType;
  value: number;
  /** e.g. "QoQ vs Q4 2025" when metricType = pct_change. */
  comparisonPeriod: string | null;
  geoLevel: MarketGeoLevel;
  /** Verbatim scope, e.g. "Manhattan below 96th St". Publisher universes differ — never average across them. */
  geoName: string;
  /** Resolved scope id for fallback matching (e.g. manhattan_below_96, northern_manhattan, manhattan). */
  submarketId: string | null;
  segment: string | null;
  /** Honors footnotes, e.g. "trailing_6mo". */
  period: string | null;
  provenance: MarketProvenance;
  createdAt: string;
}

export interface NeighborhoodRecord {
  id: string;
  name: string;
  borough: string;
  /** Submarket bucket used for market_stats fallback matching. */
  submarketId: string;
  aliases: string[];
  /** Single GeoJSON-style ring of [lng, lat] pairs (simplified display polygon). */
  polygon: [number, number][];
}

export interface NeighborhoodSummary {
  neighborhoodId: string;
  compCount12mo: number;
  nResearch: number;
  nBroker: number;
  nCherryPickExcluded: number;
  nAskingExcluded: number;
  /** Decimal cap rate; null below min n=3 (popup falls back to submarket stat). */
  medianCapRate: number | null;
  capRateRange: [number, number] | null;
  medianPsf: number | null;
  psfRange: [number, number] | null;
  regulatorySkew: string | null;
  bullets: string[];
  /** e.g. "Submarket: Manhattan <96th FM avg $986/SF (Ariel, trailing 6-mo)". */
  fallbackContext: string | null;
  /** Most recent sale_date among included comps (or stat as-of). */
  dataFreshness: string | null;
  /** Report short names. */
  sources: string[];
  updatedAt: string;
}

/** Ingest report returned by POST /api/market-docs. */
export interface MarketDocIngestReport {
  documentId: string;
  sourceType: MarketSourceType;
  documentClass: MarketDocumentClass;
  publisher: string | null;
  classifierConfidence: ClassifierConfidence;
  flagForReview: boolean;
  nComps: number;
  nCompsMerged: number;
  nStats: number;
  unresolvedNeighborhoods: string[];
  affectedNeighborhoods: string[];
  flags: string[];
  /** Analyst brief for this upload (set after the knowledge-base step). */
  brief?: MarketDocumentBrief | null;
  /** Knowledge-base version this document was folded into. */
  knowledgeVersion?: number | null;
  /** "failed" when the pipeline aborted; the document row keeps the error. */
  status?: "succeeded" | "failed";
  /** Stage-tagged failure message when status is "failed". */
  error?: string | null;
}

// ---------------------------------------------------------------------------
// Living market knowledge base (market_knowledge_entries) + per-upload briefs.
// ---------------------------------------------------------------------------

export type MarketTrendDirection = "up" | "down" | "flat" | "mixed";

/** One cited claim: a number plus its publisher + period. Never inferred. */
export interface MarketKnowledgeClaim {
  /** ≤120 chars, always contains the number and the source, e.g. "Avg $986/SF — Manhattan below 96th St FM (Ariel, trailing 6-mo)". */
  text: string;
  /** e.g. "avg_price_psf", "cap_rate", "dollar_volume". */
  metric: string | null;
  value: number | null;
  /** "%", "$/SF", "bps", "trades", … */
  unit: string | null;
  /** Publisher; null when the document is unbranded. */
  source: string | null;
  /** e.g. "Q1 2026", "trailing_6mo". */
  period: string | null;
}

export interface MarketKnowledgeSubmarketTrend {
  /** Verbatim geography ("Manhattan below 96th St", "Northern Manhattan", "UWS"). */
  scope: string;
  direction: MarketTrendDirection;
  claims: MarketKnowledgeClaim[];
}

export interface MarketKnowledgeAttentionNote {
  /** e.g. "free-market sub-9-unit buildings", "rent-stabilized ≥50% share". */
  segment: string;
  attention: "more" | "less" | "steady";
  /** ≤120 chars with number + source. */
  note: string;
}

export interface MarketKnowledgeDiscrepancy {
  topic: string;
  /** Both conflicting numbers cited with publisher + period. */
  detail: string;
  sources: string[];
  status: "open" | "resolved";
}

/** Cumulative structured market narrative; grows with every ingested document. */
export interface MarketKnowledgeNarrative {
  /** Latest period covered, e.g. "Q1 2026". */
  asOf: string | null;
  submarketTrends: MarketKnowledgeSubmarketTrend[];
  assetTypeAttention: MarketKnowledgeAttentionNote[];
  capRatePsfMovements: MarketKnowledgeClaim[];
  discrepancies: MarketKnowledgeDiscrepancy[];
  /** "Publisher — period" for every report folded in. */
  sources: string[];
}

/** Per-upload analyst brief persisted on market_documents.document_brief. */
export interface MarketDocumentBrief {
  /** Report title, else filename. */
  title: string;
  /** 3-6 bullets with numbers. */
  whatItSays: string[];
  /** This doc vs knowledge base / prior stats for the same metric/geo/segment. */
  comparedToPrior: string[];
  /** Explicit conflicts with prior data or within this document. */
  discrepancies: string[];
  incorporatedAt: string;
  promptVersion: string;
}

/** Append-only versioned knowledge-base row (market_knowledge_entries). */
export interface MarketKnowledgeEntry {
  id: string;
  version: number;
  documentId: string | null;
  narrative: MarketKnowledgeNarrative;
  brief: MarketDocumentBrief | null;
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
  createdAt: string;
}

/** GET /api/market-knowledge response. */
export interface MarketKnowledgeState {
  version: number;
  updatedAt: string;
  narrative: MarketKnowledgeNarrative;
  latestBrief: MarketDocumentBrief | null;
  documentId: string | null;
}

export interface MarketKnowledgeResponse {
  knowledge: MarketKnowledgeState | null;
}

// ---------------------------------------------------------------------------
// GET /api/market-headlines (Yield Map ticker).
// ---------------------------------------------------------------------------

export type MarketHeadlineTone = "up" | "down" | "neutral" | "watch";

export interface MarketHeadline {
  id: string;
  /** Short headline with numbers, e.g. "UWS cap rates +20bps QoQ — Avison Young Q1". */
  text: string;
  tone: MarketHeadlineTone;
  scope: string | null;
  source: string | null;
  asOf: string | null;
}

export interface MarketHeadlinesResponse {
  headlines: MarketHeadline[];
  generatedAt: string | null;
  knowledgeVersion: number | null;
}

/** GET /api/neighborhood-summaries response row (summary + polygon + popup payload). */
export interface NeighborhoodSummaryWithGeo extends NeighborhoodSummary {
  name: string;
  borough: string;
  submarketId: string;
  aliases: string[];
  polygon: [number, number][];
  topComps: MarketComp[];
}
