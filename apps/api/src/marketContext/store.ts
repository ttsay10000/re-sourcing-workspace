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
  MarketLlmOutputRepo,
  MarketStatRepo,
  NeighborhoodRepo,
  NeighborhoodSummaryRepo,
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
  MarketStat,
  NeighborhoodRecord,
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
  upsertSummary(params: UpsertNeighborhoodSummaryParams): Promise<void>;
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

  constructor(private readonly pool: Pool) {
    this.neighborhoods = new NeighborhoodRepo({ pool });
    this.documents = new MarketDocumentRepo({ pool });
    this.comps = new MarketCompRepo({ pool });
    this.stats = new MarketStatRepo({ pool });
    this.summaries = new NeighborhoodSummaryRepo({ pool });
    this.llmOutputs = new MarketLlmOutputRepo({ pool });
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

  upsertSummary(params: UpsertNeighborhoodSummaryParams) {
    return this.summaries.upsert(params);
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

  async upsertSummary(params: UpsertNeighborhoodSummaryParams) {
    this.summaries.set(params.neighborhoodId, params);
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
