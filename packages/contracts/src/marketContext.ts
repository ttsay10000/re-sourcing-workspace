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

/**
 * Printed/footnoted sale conditions on a comp. Non-arm's-length or
 * non-fee-simple prints (portfolio_sale, partial_interest, note_sale,
 * ground_lease) are excluded from neighborhood median math; the rest are real
 * comps whose flags explain the print (estate pricing, vacancy premium).
 */
export type MarketSaleCondition =
  | "portfolio_sale"
  | "partial_interest"
  | "note_sale"
  | "ground_lease"
  | "distressed"
  | "estate_sale"
  | "delivered_vacant"
  | "1031_exchange"
  | "related_party";

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
  /** Publisher's stated methodology/universe ("sales $1M+ in 5+ unit buildings, all Manhattan"); reconciles cross-publisher gaps. */
  coverage_universe: string | null;
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
  /** Robust per-upload analyst notes (Gemini PDF read refined by OpenAI; null before the notes stage runs). */
  llmNotes?: MarketDocumentNotes | null;
  /** Soft removal: excluded documents leave rollups, comp surfaces, and the live AI review. */
  excludedAt?: string | null;
  excludedReason?: "removed" | "duplicate" | null;
  createdAt: string;
}

/** GET /api/market-docs row: document plus computed review-surface context. */
export interface MarketDocumentListItem extends MarketDocument {
  /** Earliest non-excluded document sharing publisher + period + class (possible duplicate). */
  duplicateOfId: string | null;
  /** Extracted comps from this document still awaiting user review. */
  pendingComps: number;
}

/**
 * User review gate for extracted comps. New extractions land "pending" and
 * only "approved" comps reach the Comp Analysis table / Yield Map comp layer;
 * "rejected" comps also leave neighborhood rollups.
 */
export type MarketCompReviewStatus = "pending" | "approved" | "rejected";

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
  /** Gross rent multiplier as printed (how sub-10-unit deals are quoted); never derived. */
  grm: number | null;
  assetType: MarketAssetType | null;
  /** Purchaser / seller exactly as printed; never inferred. */
  buyer: string | null;
  seller: string | null;
  /** Printed sale-condition flags (see MarketSaleCondition). */
  saleConditions: MarketSaleCondition[];
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
  reviewStatus: MarketCompReviewStatus;
  reviewedAt: string | null;
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
  /** Newly inserted comps now waiting in the user review queue. */
  nCompsPendingReview?: number;
  unresolvedNeighborhoods: string[];
  affectedNeighborhoods: string[];
  flags: string[];
  /** True when the per-document analyst notes stage produced stored notes. */
  notesGenerated?: boolean;
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

/** Executive insight: a cross-document, trends-over-time takeaway (prior→current values with periods). */
export interface MarketKnowledgeExecInsight extends MarketKnowledgeClaim {
  direction?: MarketTrendDirection | null;
}

/** Cumulative structured market narrative; grows with every ingested document. */
export interface MarketKnowledgeNarrative {
  /** Latest period covered, e.g. "Q1 2026". */
  asOf: string | null;
  /** 3-5 highest-level takeaways synthesized ACROSS all folded-in reports, marking trends over time. Optional: entries stored before knowledge_v2 lack it. */
  executiveSummary?: MarketKnowledgeExecInsight[];
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

// ---------------------------------------------------------------------------
// Per-document analyst notes (market_documents.llm_notes): the robust
// "what would an acquisitions analyst pull out of this report" summary.
// Stage 1 (Gemini, native PDF) reads the document; stage 2 (OpenAI) refines.
// ---------------------------------------------------------------------------

export interface MarketNotesNeighborhoodTake {
  /** Verbatim geography from the report. */
  name: string;
  /** ≤200 chars, numbers required ("$954/SF median, +12.6% YoY — PropertyShark Q1'26"). */
  takeaway: string;
}

export interface MarketNotesAssetTypeTake {
  /** e.g. "multifamily 6-9 units", "mixed-use w/ ground retail", "rent-stabilized >50%". */
  segment: string;
  direction: MarketTrendDirection;
  note: string;
}

/** Robust per-upload analyst notes persisted on market_documents.llm_notes. */
export interface MarketDocumentNotes {
  /** Report title, else filename. */
  title: string;
  /** "Publisher — period" attribution line. */
  sourceLabel: string;
  periodCovered: string | null;
  /** The report in numbers: 2-5 highest-level bullets. */
  overview: string[];
  /** Per-neighborhood / submarket observations. */
  neighborhoods: MarketNotesNeighborhoodTake[];
  /** Asset types / segments rising or falling. */
  assetTypes: MarketNotesAssetTypeTake[];
  /** Buying & selling activity: institutional vs private, new entrants, 1031/foreign capital, contract volume. */
  buyerActivity: string[];
  /** Notable individual transactions with price / cap / $PSF / buyer when printed. */
  notableTransactions: string[];
  /** Cap-rate and $/SF observations (levels and printed changes). */
  capRatePsf: string[];
  /** Loan environment: rates, lender appetite, refi pressure, distress. */
  financing: string[];
  /** Small-building specifics: sub-10-unit dynamics, free-market vs stabilized pricing. */
  smallBuildingFocus: string[];
  /** Regulatory / policy notes (RS share effects, 421a/485x, good-cause). */
  regulatory: string[];
  /** Risks and watch items the report calls out. */
  risksWatchItems: string[];
  /** Why this matters for a small-multifamily acquirer hunting deals. */
  investmentRelevance: string[];
  generatedAt: string;
  promptVersion: string;
  /** Provider/model chain, e.g. ["gemini/gemini-3-flash-preview", "openai/gpt-5.5"]. */
  providers: string[];
}

// ---------------------------------------------------------------------------
// Live AI market review (market_reviews): cross-document synthesis focused on
// small-multifamily acquisitions, regenerated from currently included docs.
// ---------------------------------------------------------------------------

export interface MarketReviewQoqComparison {
  /** Same-publisher series only — cross-publisher gaps belong in discrepancies. */
  publisher: string;
  fromPeriod: string;
  toPeriod: string;
  /** What changed, with both values ("Manhattan MF caps 5.6%→5.9%, +30bps"). */
  changes: string[];
}

export interface MarketReviewDiscrepancyPosition {
  source: string;
  period: string | null;
  claim: string;
}

export interface MarketReviewDiscrepancy {
  topic: string;
  /** Each conflicting source's number, cited. */
  positions: MarketReviewDiscrepancyPosition[];
  /** Why they may differ (universe/methodology) or null when unexplained. */
  note: string | null;
}

/** The live cross-document AI review payload (market_reviews.review). */
export interface MarketReview {
  /** One-line read of the market for a small-MF acquirer. */
  headline: string;
  /** Top cross-report takeaways with numbers. */
  marketPulse: string[];
  /** Smaller buildings / smaller unit counts: pricing, demand, FM vs RS. */
  smallMultifamilyFocus: string[];
  /** Compression/expansion trends with bps and periods. */
  capRateTrends: string[];
  /** Institutional buying trends, notable buyers/sellers, activity up or down. */
  buyerSellerActivity: string[];
  /** Loan environment for acquisitions. */
  loanEnvironment: string[];
  /** Where to hunt: low / falling $PSF pockets, motivated-seller signals. */
  opportunities: string[];
  /** Same-brokerage quarter-over-quarter changes. */
  qoqComparisons: MarketReviewQoqComparison[];
  /** Cross-brokerage conflicts about trends/activity, both numbers cited. */
  discrepancies: MarketReviewDiscrepancy[];
  /** "Publisher — period (title)" for every document included. */
  sources: string[];
}

/** Append-only versioned live review row (market_reviews). */
export interface MarketReviewRecord {
  id: string;
  version: number;
  review: MarketReview;
  includedDocumentIds: string[];
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
  createdAt: string;
}

/** GET /api/market-review response. */
export interface MarketReviewResponse {
  review: MarketReviewRecord | null;
  /** True when included docs no longer match the current non-excluded set. */
  stale: boolean;
  /** Documents that would feed a refresh right now. */
  currentDocumentCount: number;
}

// ---------------------------------------------------------------------------
// Unified comp review queue (market-doc extractions + broker package comps).
// ---------------------------------------------------------------------------

export type CompReviewSource = "market_doc" | "broker";

/** One comp awaiting user review, normalized across both extraction pipelines. */
export interface CompReviewQueueItem {
  id: string;
  source: CompReviewSource;
  address: string | null;
  propertyName: string | null;
  neighborhood: string | null;
  borough: string | null;
  units: number | null;
  gsf: number | null;
  salePrice: number | null;
  saleDate: string | null;
  /** Percent points (5.82 = 5.82%). */
  capRatePct: number | null;
  /** Gross rent multiplier as printed. */
  grm: number | null;
  pricePsf: number | null;
  pricePerUnit: number | null;
  noi: number | null;
  assetType: string | null;
  priceType: MarketPriceType | null;
  /** Purchaser as printed (institutional-trend verification). */
  buyer: string | null;
  /** Printed sale-condition flags to verify before approval. */
  saleConditions: string[];
  /** "high" | "medium" | "low" for doc comps; numeric 0-1 rendered as a label for broker items. */
  confidence: string | null;
  cherryPickRisk: boolean;
  notes: string | null;
  /** e.g. "Tri-State Investment Sales · Manhattan property sales report" or "Broker package · Sale comps". */
  sourceLabel: string;
  /** e.g. "Q1 2026" or the subject property address for broker packages. */
  sourceDetail: string | null;
  documentId: string | null;
  packageId: string | null;
  createdAt: string;
}

export interface CompReviewQueueResponse {
  items: CompReviewQueueItem[];
  counts: { marketDoc: number; broker: number };
}

export interface CompReviewDecision {
  id: string;
  source: CompReviewSource;
  action: "approve" | "reject";
}

/** POST /api/comps/review response. */
export interface CompReviewResult {
  updated: number;
  /** Neighborhood rollups recomputed because a market-doc comp changed status. */
  resynthesizedNeighborhoods: string[];
}
