/**
 * Storage boundary for the ingest pipeline. PgMarketContextStore wraps the
 * @re-sourcing/db repos; InMemoryMarketContextStore backs the acceptance tests
 * so the full classify → extract → dedupe → rollup → synthesize path runs
 * without Postgres.
 */
import type { Pool } from "pg";
import {
  MarketCompRepo,
  MarketDocumentRepo,
  MarketKnowledgeRepo,
  MarketLlmOutputRepo,
  MarketStatRepo,
  NeighborhoodRepo,
  NeighborhoodSummaryRepo,
  type AppendMarketKnowledgeEntryParams,
  type InsertMarketLlmOutputParams,
  type InsertMarketStatParams,
  type UpsertMarketCompParams,
  type UpsertNeighborhoodSummaryParams,
} from "@re-sourcing/db";
import type {
  MarketComp,
  MarketDocClassification,
  MarketDocIngestReport,
  MarketDocument,
  MarketDocumentBrief,
  MarketKnowledgeEntry,
  MarketStat,
  NeighborhoodRecord,
  NeighborhoodSummary,
} from "@re-sourcing/contracts";

export interface MarketContextStore {
  listNeighborhoods(): Promise<NeighborhoodRecord[]>;
  insertDocument(params: { filename: string; contentType: string | null; fileContent: Buffer | null }): Promise<MarketDocument>;
  saveClassification(id: string, classification: MarketDocClassification, flagForReview: boolean): Promise<void>;
  setDocumentStatus(id: string, status: MarketDocument["status"], error?: string | null): Promise<void>;
  saveIngestReport(id: string, report: MarketDocIngestReport): Promise<void>;
  saveLlmOutput(params: InsertMarketLlmOutputParams): Promise<void>;
  findCompsByNormalizedAddresses(addresses: string[]): Promise<MarketComp[]>;
  insertComp(params: UpsertMarketCompParams): Promise<MarketComp>;
  replaceComp(id: string, params: UpsertMarketCompParams): Promise<MarketComp>;
  listCompsByNeighborhoods(neighborhoodIds: string[]): Promise<MarketComp[]>;
  insertStat(params: InsertMarketStatParams): Promise<MarketStat>;
  listStatsBySubmarkets(submarketIds: string[]): Promise<MarketStat[]>;
  /** Retry path: clear rows a failed ingest wrote before re-running it. */
  deleteCompsByDocument(documentId: string): Promise<void>;
  deleteStatsByDocument(documentId: string): Promise<void>;
  /** All stored stats (knowledge step compares this doc against prior periods/publishers). */
  listAllStats(): Promise<MarketStat[]>;
  upsertSummary(params: UpsertNeighborhoodSummaryParams): Promise<void>;
  /** Stored rollups for brief comparisons + headline fallbacks. */
  listAllSummaries(): Promise<Array<Omit<NeighborhoodSummary, "updatedAt">>>;
  /** Per-upload analyst brief persisted on the document row. */
  saveDocumentBrief(id: string, brief: MarketDocumentBrief): Promise<void>;
  /** Current knowledge-base state (highest version), or null when empty. */
  getLatestKnowledgeEntry(): Promise<MarketKnowledgeEntry | null>;
  /** Append the next knowledge-base version (append-only audit trail). */
  appendKnowledgeEntry(params: AppendMarketKnowledgeEntryParams): Promise<MarketKnowledgeEntry>;
  /** Coordinates for market comps resolved by matching existing pipeline properties (no external geocoder). */
  matchPropertyCoordinates(addressesNormalized: string[]): Promise<Map<string, { lat: number; lng: number }>>;
}

export class PgMarketContextStore implements MarketContextStore {
  private readonly neighborhoods: NeighborhoodRepo;
  private readonly documents: MarketDocumentRepo;
  private readonly comps: MarketCompRepo;
  private readonly stats: MarketStatRepo;
  private readonly summaries: NeighborhoodSummaryRepo;
  private readonly llmOutputs: MarketLlmOutputRepo;
  private readonly knowledge: MarketKnowledgeRepo;

  constructor(private readonly pool: Pool) {
    this.neighborhoods = new NeighborhoodRepo({ pool });
    this.documents = new MarketDocumentRepo({ pool });
    this.comps = new MarketCompRepo({ pool });
    this.stats = new MarketStatRepo({ pool });
    this.summaries = new NeighborhoodSummaryRepo({ pool });
    this.llmOutputs = new MarketLlmOutputRepo({ pool });
    this.knowledge = new MarketKnowledgeRepo({ pool });
  }

  listNeighborhoods() {
    return this.neighborhoods.listAll();
  }

  insertDocument(params: { filename: string; contentType: string | null; fileContent: Buffer | null }) {
    return this.documents.insert(params);
  }

  saveClassification(id: string, classification: MarketDocClassification, flagForReview: boolean) {
    return this.documents.saveClassification(id, classification, flagForReview);
  }

  setDocumentStatus(id: string, status: MarketDocument["status"], error?: string | null) {
    return this.documents.setStatus(id, status, error);
  }

  saveIngestReport(id: string, report: MarketDocIngestReport) {
    return this.documents.saveIngestReport(id, report);
  }

  saveLlmOutput(params: InsertMarketLlmOutputParams) {
    return this.llmOutputs.insert(params);
  }

  findCompsByNormalizedAddresses(addresses: string[]) {
    return this.comps.listByNormalizedAddresses(addresses);
  }

  insertComp(params: UpsertMarketCompParams) {
    return this.comps.insert(params);
  }

  replaceComp(id: string, params: UpsertMarketCompParams) {
    return this.comps.replace(id, params);
  }

  listCompsByNeighborhoods(neighborhoodIds: string[]) {
    return this.comps.listByNeighborhoods(neighborhoodIds);
  }

  insertStat(params: InsertMarketStatParams) {
    return this.stats.insert(params);
  }

  listStatsBySubmarkets(submarketIds: string[]) {
    return this.stats.listBySubmarkets(submarketIds);
  }

  deleteCompsByDocument(documentId: string) {
    return this.comps.deleteByDocument(documentId);
  }

  deleteStatsByDocument(documentId: string) {
    return this.stats.deleteByDocument(documentId);
  }

  listAllStats() {
    return this.stats.list(2000);
  }

  upsertSummary(params: UpsertNeighborhoodSummaryParams) {
    return this.summaries.upsert(params);
  }

  listAllSummaries() {
    return this.summaries.listAll();
  }

  saveDocumentBrief(id: string, brief: MarketDocumentBrief) {
    return this.documents.saveBrief(id, brief);
  }

  getLatestKnowledgeEntry() {
    return this.knowledge.latest();
  }

  appendKnowledgeEntry(params: AppendMarketKnowledgeEntryParams) {
    return this.knowledge.append(params);
  }

  async matchPropertyCoordinates(addressesNormalized: string[]): Promise<Map<string, { lat: number; lng: number }>> {
    const matches = new Map<string, { lat: number; lng: number }>();
    if (addressesNormalized.length === 0) return matches;
    const r = await this.pool.query(
      `SELECT canonical_address, lat, lng FROM properties
       WHERE lat IS NOT NULL AND lng IS NOT NULL`
    );
    const { normalizeCompAddress } = await import("./dedupe.js");
    for (const row of r.rows as Array<{ canonical_address: string; lat: number; lng: number }>) {
      const key = normalizeCompAddress(row.canonical_address ?? "");
      if (key && addressesNormalized.includes(key) && !matches.has(key)) {
        matches.set(key, { lat: Number(row.lat), lng: Number(row.lng) });
      }
    }
    return matches;
  }
}

/** In-memory store for tests and dry runs. */
export class InMemoryMarketContextStore implements MarketContextStore {
  documents: MarketDocument[] = [];
  comps: MarketComp[] = [];
  stats: MarketStat[] = [];
  summaries = new Map<string, UpsertNeighborhoodSummaryParams>();
  llmOutputs: InsertMarketLlmOutputParams[] = [];
  knowledgeEntries: MarketKnowledgeEntry[] = [];
  propertyCoordinates = new Map<string, { lat: number; lng: number }>();

  constructor(private readonly neighborhoods: NeighborhoodRecord[]) {}

  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }

  async listNeighborhoods() {
    return this.neighborhoods;
  }

  async insertDocument(params: { filename: string; contentType: string | null; fileContent: Buffer | null }) {
    const doc: MarketDocument = {
      id: this.nextId("doc"),
      filename: params.filename,
      contentType: params.contentType,
      status: "uploaded",
      source_type: "broker_provided",
      publisher: null,
      branded: false,
      document_class: "unknown",
      report_title: null,
      period_covered: null,
      geo_scope: null,
      subject_property: null,
      classifier_confidence: "low",
      evidence: [],
      flagForReview: false,
      ingestReport: null,
      documentBrief: null,
      error: null,
      createdAt: new Date().toISOString(),
    };
    this.documents.push(doc);
    return doc;
  }

  async saveClassification(id: string, classification: MarketDocClassification, flagForReview: boolean) {
    const doc = this.documents.find((d) => d.id === id);
    if (doc) Object.assign(doc, classification, { flagForReview, status: "classified" });
  }

  async setDocumentStatus(id: string, status: MarketDocument["status"], error?: string | null) {
    const doc = this.documents.find((d) => d.id === id);
    if (doc) {
      doc.status = status;
      doc.error = error ?? null;
    }
  }

  async saveIngestReport(id: string, report: MarketDocIngestReport) {
    const doc = this.documents.find((d) => d.id === id);
    if (doc) doc.ingestReport = report;
  }

  async saveLlmOutput(params: InsertMarketLlmOutputParams) {
    this.llmOutputs.push(params);
  }

  async findCompsByNormalizedAddresses(addresses: string[]) {
    const { normalizeCompAddress } = await import("./dedupe.js");
    return this.comps.filter((comp) => addresses.includes(normalizeCompAddress(comp.address)));
  }

  private compFromParams(id: string, params: UpsertMarketCompParams, createdAt: string): MarketComp {
    return {
      id,
      documentId: params.documentId,
      address: params.address,
      neighborhoodRaw: params.neighborhoodRaw,
      neighborhoodId: params.neighborhoodId,
      borough: params.borough,
      salePrice: params.salePrice,
      priceType: params.priceType,
      saleDate: params.saleDate,
      gsf: params.gsf,
      pricePsf: params.pricePsf,
      unitsTotal: params.unitsTotal,
      unitsResi: params.unitsResi,
      pctRentStabilized: params.pctRentStabilized,
      capRate: params.capRate,
      assetType: params.assetType,
      notesShort: params.notesShort,
      cherryPickRisk: params.cherryPickRisk,
      isSubjectProperty: params.isSubjectProperty,
      confidence: params.confidence,
      rawText: params.rawText,
      provenance: params.provenance,
      provenanceList: params.provenanceList,
      lat: params.lat,
      lng: params.lng,
      createdAt,
    };
  }

  async insertComp(params: UpsertMarketCompParams) {
    const comp = this.compFromParams(this.nextId("comp"), params, new Date().toISOString());
    this.comps.push(comp);
    return comp;
  }

  async replaceComp(id: string, params: UpsertMarketCompParams) {
    const index = this.comps.findIndex((comp) => comp.id === id);
    const existing = this.comps[index];
    const replaced = this.compFromParams(id, params, existing?.createdAt ?? new Date().toISOString());
    if (index >= 0) this.comps[index] = replaced;
    else this.comps.push(replaced);
    return replaced;
  }

  async listCompsByNeighborhoods(neighborhoodIds: string[]) {
    return this.comps.filter((comp) => comp.neighborhoodId != null && neighborhoodIds.includes(comp.neighborhoodId));
  }

  async insertStat(params: InsertMarketStatParams) {
    const stat: MarketStat = {
      id: this.nextId("stat"),
      documentId: params.documentId,
      metric: params.metric,
      metricType: params.metricType,
      value: params.value,
      comparisonPeriod: params.comparisonPeriod,
      geoLevel: params.geoLevel,
      geoName: params.geoName,
      submarketId: params.submarketId,
      segment: params.segment,
      period: params.period,
      provenance: params.provenance,
      createdAt: new Date().toISOString(),
    };
    this.stats.push(stat);
    return stat;
  }

  async listStatsBySubmarkets(submarketIds: string[]) {
    return this.stats.filter((stat) => stat.submarketId != null && submarketIds.includes(stat.submarketId));
  }

  async deleteCompsByDocument(documentId: string) {
    this.comps = this.comps.filter((comp) => comp.documentId !== documentId);
  }

  async deleteStatsByDocument(documentId: string) {
    this.stats = this.stats.filter((stat) => stat.documentId !== documentId);
  }

  async listAllStats() {
    return this.stats;
  }

  async upsertSummary(params: UpsertNeighborhoodSummaryParams) {
    this.summaries.set(params.neighborhoodId, params);
  }

  async listAllSummaries() {
    return [...this.summaries.values()];
  }

  async saveDocumentBrief(id: string, brief: MarketDocumentBrief) {
    const doc = this.documents.find((d) => d.id === id);
    if (doc) doc.documentBrief = brief;
  }

  async getLatestKnowledgeEntry() {
    return this.knowledgeEntries.at(-1) ?? null;
  }

  async appendKnowledgeEntry(params: AppendMarketKnowledgeEntryParams) {
    const entry: MarketKnowledgeEntry = {
      id: this.nextId("knowledge"),
      version: (this.knowledgeEntries.at(-1)?.version ?? 0) + 1,
      documentId: params.documentId,
      narrative: params.narrative,
      brief: params.brief,
      promptVersion: params.promptVersion,
      provider: params.provider,
      model: params.model,
      createdAt: new Date().toISOString(),
    };
    this.knowledgeEntries.push(entry);
    return entry;
  }

  async matchPropertyCoordinates(addressesNormalized: string[]) {
    const matches = new Map<string, { lat: number; lng: number }>();
    for (const address of addressesNormalized) {
      const hit = this.propertyCoordinates.get(address);
      if (hit) matches.set(address, hit);
    }
    return matches;
  }
}
