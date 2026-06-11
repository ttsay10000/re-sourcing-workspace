/**
 * Market context repos: uploaded market documents, extracted comps/stats with
 * provenance, neighborhood lookup + summaries, and raw LLM outputs per stage.
 */
import type { PoolClient } from "pg";
import type {
  ClassifierConfidence,
  MarketComp,
  MarketDocClassification,
  MarketDocIngestReport,
  MarketDocument,
  MarketDocumentBrief,
  MarketProvenance,
  MarketStat,
  NeighborhoodRecord,
  NeighborhoodSummary,
} from "@re-sourcing/contracts";

export interface MarketContextRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

type Row = Record<string, unknown>;

function num(value: unknown): number | null {
  if (value == null) return null;
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : null;
}

function int(value: unknown): number | null {
  const n = num(value);
  return n == null ? null : Math.round(n);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : new Date(0).toISOString();
}

function dateOnly(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && value) return value.slice(0, 10);
  return null;
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function mapNeighborhood(row: Row): NeighborhoodRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    borough: String(row.borough),
    submarketId: String(row.submarket_id),
    aliases: jsonArray<string>(row.aliases),
    polygon: jsonArray<[number, number]>(row.polygon),
  };
}

function mapMarketDocument(row: Row): MarketDocument {
  return {
    id: String(row.id),
    filename: String(row.filename),
    contentType: str(row.content_type),
    status: (str(row.status) ?? "uploaded") as MarketDocument["status"],
    source_type: (str(row.source_type) ?? "broker_provided") as MarketDocument["source_type"],
    publisher: str(row.publisher),
    branded: Boolean(row.branded),
    document_class: (str(row.document_class) ?? "unknown") as MarketDocument["document_class"],
    report_title: str(row.report_title),
    period_covered: str(row.period_covered),
    geo_scope: str(row.geo_scope),
    subject_property: str(row.subject_property),
    classifier_confidence: (str(row.classifier_confidence) ?? "low") as ClassifierConfidence,
    evidence: jsonArray<string>(row.classifier_evidence),
    flagForReview: Boolean(row.flag_for_review),
    ingestReport: (row.ingest_report as MarketDocIngestReport | null) ?? null,
    documentBrief: (row.document_brief as MarketDocumentBrief | null) ?? null,
    error: str(row.error),
    createdAt: iso(row.created_at),
  };
}

function mapMarketComp(row: Row): MarketComp {
  const provenance = row.provenance as MarketProvenance;
  const provenanceList = jsonArray<MarketProvenance>(row.provenance_list);
  return {
    id: String(row.id),
    documentId: str(row.document_id),
    address: String(row.address),
    neighborhoodRaw: str(row.neighborhood_raw),
    neighborhoodId: str(row.neighborhood_id),
    borough: str(row.borough),
    salePrice: num(row.sale_price),
    priceType: (str(row.price_type) ?? "unknown") as MarketComp["priceType"],
    saleDate: dateOnly(row.sale_date),
    gsf: num(row.gsf),
    pricePsf: num(row.price_psf),
    unitsTotal: int(row.units_total),
    unitsResi: int(row.units_resi),
    pctRentStabilized: num(row.pct_rent_stabilized),
    capRate: num(row.cap_rate),
    assetType: str(row.asset_type) as MarketComp["assetType"],
    notesShort: str(row.notes_short),
    cherryPickRisk: Boolean(row.cherry_pick_risk),
    isSubjectProperty: Boolean(row.is_subject_property),
    confidence: (str(row.confidence) ?? "high") as ClassifierConfidence,
    rawText: str(row.raw_text),
    provenance,
    provenanceList: provenanceList.length > 0 ? provenanceList : [provenance],
    lat: num(row.lat),
    lng: num(row.lng),
    createdAt: iso(row.created_at),
  };
}

function mapMarketStat(row: Row): MarketStat {
  return {
    id: String(row.id),
    documentId: str(row.document_id),
    metric: String(row.metric),
    metricType: (str(row.metric_type) ?? "level") as MarketStat["metricType"],
    value: num(row.value) ?? 0,
    comparisonPeriod: str(row.comparison_period),
    geoLevel: (str(row.geo_level) ?? "submarket") as MarketStat["geoLevel"],
    geoName: String(row.geo_name),
    submarketId: str(row.submarket_id),
    segment: str(row.segment),
    period: str(row.period),
    provenance: row.provenance as MarketProvenance,
    createdAt: iso(row.created_at),
  };
}

function mapNeighborhoodSummary(row: Row): NeighborhoodSummary & { topComps: MarketComp[] } {
  return {
    neighborhoodId: String(row.neighborhood_id),
    compCount12mo: int(row.comp_count_12mo) ?? 0,
    nResearch: int(row.n_research) ?? 0,
    nBroker: int(row.n_broker) ?? 0,
    nCherryPickExcluded: int(row.n_cherry_pick_excluded) ?? 0,
    nAskingExcluded: int(row.n_asking_excluded) ?? 0,
    medianCapRate: num(row.median_cap_rate),
    capRateRange: (row.cap_rate_range as [number, number] | null) ?? null,
    medianPsf: num(row.median_psf),
    psfRange: (row.psf_range as [number, number] | null) ?? null,
    regulatorySkew: str(row.regulatory_skew),
    bullets: jsonArray<string>(row.bullets),
    fallbackContext: str(row.fallback_context),
    dataFreshness: dateOnly(row.data_freshness),
    sources: jsonArray<string>(row.sources),
    topComps: jsonArray<MarketComp>(row.top_comps),
    updatedAt: iso(row.updated_at),
  };
}

export class NeighborhoodRepo {
  constructor(private options: MarketContextRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async listAll(): Promise<NeighborhoodRecord[]> {
    const r = await this.client.query(
      "SELECT id, name, borough, submarket_id, aliases, polygon FROM neighborhoods ORDER BY name"
    );
    return r.rows.map((row: Row) => mapNeighborhood(row));
  }
}

export interface InsertMarketDocumentParams {
  filename: string;
  contentType?: string | null;
  fileContent?: Buffer | null;
}

export class MarketDocumentRepo {
  constructor(private options: MarketContextRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async insert(params: InsertMarketDocumentParams): Promise<MarketDocument> {
    const r = await this.client.query(
      `INSERT INTO market_documents (filename, content_type, file_content)
       VALUES ($1, $2, $3)
       RETURNING id, filename, content_type, status, source_type, publisher, branded, document_class,
                 report_title, period_covered, geo_scope, subject_property, classifier_confidence,
                 classifier_evidence, flag_for_review, ingest_report, document_brief, error, created_at`,
      [params.filename, params.contentType ?? null, params.fileContent ?? null]
    );
    return mapMarketDocument(r.rows[0]);
  }

  async saveClassification(
    id: string,
    classification: MarketDocClassification,
    flagForReview: boolean
  ): Promise<void> {
    await this.client.query(
      `UPDATE market_documents SET
         status = 'classified', source_type = $2, publisher = $3, branded = $4, document_class = $5,
         report_title = $6, period_covered = $7, geo_scope = $8, subject_property = $9,
         classifier_confidence = $10, classifier_evidence = $11::jsonb, flag_for_review = $12
       WHERE id = $1`,
      [
        id,
        classification.source_type,
        classification.publisher,
        classification.branded,
        classification.document_class,
        classification.report_title,
        classification.period_covered,
        classification.geo_scope,
        classification.subject_property,
        classification.classifier_confidence,
        JSON.stringify(classification.evidence),
        flagForReview,
      ]
    );
  }

  async setStatus(id: string, status: MarketDocument["status"], error?: string | null): Promise<void> {
    await this.client.query("UPDATE market_documents SET status = $2, error = $3 WHERE id = $1", [
      id,
      status,
      error ?? null,
    ]);
  }

  async saveIngestReport(id: string, report: MarketDocIngestReport): Promise<void> {
    await this.client.query("UPDATE market_documents SET ingest_report = $2::jsonb WHERE id = $1", [
      id,
      JSON.stringify(report),
    ]);
  }

  async saveBrief(id: string, brief: MarketDocumentBrief): Promise<void> {
    await this.client.query("UPDATE market_documents SET document_brief = $2::jsonb WHERE id = $1", [
      id,
      JSON.stringify(brief),
    ]);
  }

  async byId(id: string): Promise<MarketDocument | null> {
    const r = await this.client.query(
      `SELECT id, filename, content_type, status, source_type, publisher, branded, document_class,
              report_title, period_covered, geo_scope, subject_property, classifier_confidence,
              classifier_evidence, flag_for_review, ingest_report, document_brief, error, created_at
       FROM market_documents WHERE id = $1`,
      [id]
    );
    return r.rows[0] ? mapMarketDocument(r.rows[0]) : null;
  }

  async list(limit = 100): Promise<MarketDocument[]> {
    const r = await this.client.query(
      `SELECT id, filename, content_type, status, source_type, publisher, branded, document_class,
              report_title, period_covered, geo_scope, subject_property, classifier_confidence,
              classifier_evidence, flag_for_review, ingest_report, document_brief, error, created_at
       FROM market_documents ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return r.rows.map((row: Row) => mapMarketDocument(row));
  }

  async getFileContent(id: string): Promise<Buffer | null> {
    const r = await this.client.query("SELECT file_content FROM market_documents WHERE id = $1", [id]);
    const row = r.rows[0];
    if (!row?.file_content) return null;
    return row.file_content instanceof Buffer ? row.file_content : Buffer.from(row.file_content);
  }
}

export interface UpsertMarketCompParams {
  documentId: string | null;
  address: string;
  addressNormalized: string;
  neighborhoodRaw: string | null;
  neighborhoodId: string | null;
  borough: string | null;
  salePrice: number | null;
  priceType: MarketComp["priceType"];
  saleDate: string | null;
  gsf: number | null;
  pricePsf: number | null;
  unitsTotal: number | null;
  unitsResi: number | null;
  pctRentStabilized: number | null;
  capRate: number | null;
  assetType: MarketComp["assetType"];
  notesShort: string | null;
  cherryPickRisk: boolean;
  isSubjectProperty: boolean;
  confidence: ClassifierConfidence;
  rawText: string | null;
  provenance: MarketProvenance;
  provenanceList: MarketProvenance[];
  lat: number | null;
  lng: number | null;
}

export interface ListMarketCompsFilters {
  neighborhoodId?: string | null;
  sourceType?: string | null;
  priceType?: string | null;
  unresolvedOnly?: boolean;
  limit?: number;
}

export class MarketCompRepo {
  constructor(private options: MarketContextRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  private static readonly COLUMNS = `id, document_id, address, address_normalized, neighborhood_raw,
    neighborhood_id, borough, sale_price, price_type, sale_date, gsf, price_psf, units_total,
    units_resi, pct_rent_stabilized, cap_rate, asset_type, notes_short, cherry_pick_risk,
    is_subject_property, confidence, raw_text, provenance, provenance_list, lat, lng, created_at`;

  async insert(params: UpsertMarketCompParams): Promise<MarketComp> {
    const r = await this.client.query(
      `INSERT INTO market_comps (document_id, address, address_normalized, neighborhood_raw,
         neighborhood_id, borough, sale_price, price_type, sale_date, gsf, price_psf, units_total,
         units_resi, pct_rent_stabilized, cap_rate, asset_type, notes_short, cherry_pick_risk,
         is_subject_property, confidence, raw_text, provenance, provenance_list, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::jsonb,$24,$25)
       RETURNING ${MarketCompRepo.COLUMNS}`,
      [
        params.documentId,
        params.address,
        params.addressNormalized,
        params.neighborhoodRaw,
        params.neighborhoodId,
        params.borough,
        params.salePrice,
        params.priceType,
        params.saleDate,
        params.gsf,
        params.pricePsf,
        params.unitsTotal,
        params.unitsResi,
        params.pctRentStabilized,
        params.capRate,
        params.assetType,
        params.notesShort,
        params.cherryPickRisk,
        params.isSubjectProperty,
        params.confidence,
        params.rawText,
        JSON.stringify(params.provenance),
        JSON.stringify(params.provenanceList),
        params.lat,
        params.lng,
      ]
    );
    return mapMarketComp(r.rows[0]);
  }

  /** Full-row replace used when a dedupe merge picks new winning fields. */
  async replace(id: string, params: UpsertMarketCompParams): Promise<MarketComp> {
    const r = await this.client.query(
      `UPDATE market_comps SET document_id=$2, address=$3, address_normalized=$4, neighborhood_raw=$5,
         neighborhood_id=$6, borough=$7, sale_price=$8, price_type=$9, sale_date=$10, gsf=$11,
         price_psf=$12, units_total=$13, units_resi=$14, pct_rent_stabilized=$15, cap_rate=$16,
         asset_type=$17, notes_short=$18, cherry_pick_risk=$19, is_subject_property=$20,
         confidence=$21, raw_text=$22, provenance=$23::jsonb, provenance_list=$24::jsonb,
         lat=$25, lng=$26, updated_at=now()
       WHERE id = $1
       RETURNING ${MarketCompRepo.COLUMNS}`,
      [
        id,
        params.documentId,
        params.address,
        params.addressNormalized,
        params.neighborhoodRaw,
        params.neighborhoodId,
        params.borough,
        params.salePrice,
        params.priceType,
        params.saleDate,
        params.gsf,
        params.pricePsf,
        params.unitsTotal,
        params.unitsResi,
        params.pctRentStabilized,
        params.capRate,
        params.assetType,
        params.notesShort,
        params.cherryPickRisk,
        params.isSubjectProperty,
        params.confidence,
        params.rawText,
        JSON.stringify(params.provenance),
        JSON.stringify(params.provenanceList),
        params.lat,
        params.lng,
      ]
    );
    return mapMarketComp(r.rows[0]);
  }

  /** Retry path: clear comps this document created (merged rows keep their original document_id and survive). */
  async deleteByDocument(documentId: string): Promise<void> {
    await this.client.query(`DELETE FROM market_comps WHERE document_id = $1`, [documentId]);
  }

  /** Dedupe candidates: existing comps sharing a normalized address. */
  async listByNormalizedAddresses(addresses: string[]): Promise<MarketComp[]> {
    if (addresses.length === 0) return [];
    const r = await this.client.query(
      `SELECT ${MarketCompRepo.COLUMNS} FROM market_comps WHERE address_normalized = ANY($1)`,
      [addresses]
    );
    return r.rows.map((row: Row) => mapMarketComp(row));
  }

  async listByNeighborhoods(neighborhoodIds: string[]): Promise<MarketComp[]> {
    if (neighborhoodIds.length === 0) return [];
    const r = await this.client.query(
      `SELECT ${MarketCompRepo.COLUMNS} FROM market_comps WHERE neighborhood_id = ANY($1)
       ORDER BY sale_date DESC NULLS LAST`,
      [neighborhoodIds]
    );
    return r.rows.map((row: Row) => mapMarketComp(row));
  }

  async list(filters: ListMarketCompsFilters = {}): Promise<MarketComp[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    if (filters.neighborhoodId) {
      values.push(filters.neighborhoodId);
      where.push(`neighborhood_id = $${values.length}`);
    }
    if (filters.sourceType) {
      values.push(filters.sourceType);
      where.push(`provenance->>'source_type' = $${values.length}`);
    }
    if (filters.priceType) {
      values.push(filters.priceType);
      where.push(`price_type = $${values.length}`);
    }
    if (filters.unresolvedOnly) {
      where.push("neighborhood_id IS NULL");
    }
    values.push(Math.max(1, Math.min(filters.limit ?? 500, 2000)));
    const sql = `SELECT ${MarketCompRepo.COLUMNS} FROM market_comps
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY sale_date DESC NULLS LAST, created_at DESC
      LIMIT $${values.length}`;
    const r = await this.client.query(sql, values);
    return r.rows.map((row: Row) => mapMarketComp(row));
  }
}

export interface InsertMarketStatParams {
  documentId: string | null;
  metric: string;
  metricType: MarketStat["metricType"];
  value: number;
  comparisonPeriod: string | null;
  geoLevel: MarketStat["geoLevel"];
  geoName: string;
  submarketId: string | null;
  segment: string | null;
  period: string | null;
  provenance: MarketProvenance;
}

export class MarketStatRepo {
  constructor(private options: MarketContextRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async insert(params: InsertMarketStatParams): Promise<MarketStat> {
    const r = await this.client.query(
      `INSERT INTO market_stats (document_id, metric, metric_type, value, comparison_period,
         geo_level, geo_name, submarket_id, segment, period, provenance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       RETURNING id, document_id, metric, metric_type, value, comparison_period, geo_level,
                 geo_name, submarket_id, segment, period, provenance, created_at`,
      [
        params.documentId,
        params.metric,
        params.metricType,
        params.value,
        params.comparisonPeriod,
        params.geoLevel,
        params.geoName,
        params.submarketId,
        params.segment,
        params.period,
        JSON.stringify(params.provenance),
      ]
    );
    return mapMarketStat(r.rows[0]);
  }

  /** Retry path: clear this document's partial writes before re-ingesting. */
  async deleteByDocument(documentId: string): Promise<void> {
    await this.client.query(`DELETE FROM market_stats WHERE document_id = $1`, [documentId]);
  }

  async listBySubmarkets(submarketIds: string[]): Promise<MarketStat[]> {
    if (submarketIds.length === 0) return [];
    const r = await this.client.query(
      `SELECT id, document_id, metric, metric_type, value, comparison_period, geo_level,
              geo_name, submarket_id, segment, period, provenance, created_at
       FROM market_stats WHERE submarket_id = ANY($1)
       ORDER BY created_at DESC`,
      [submarketIds]
    );
    return r.rows.map((row: Row) => mapMarketStat(row));
  }

  async list(limit = 500): Promise<MarketStat[]> {
    const r = await this.client.query(
      `SELECT id, document_id, metric, metric_type, value, comparison_period, geo_level,
              geo_name, submarket_id, segment, period, provenance, created_at
       FROM market_stats ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return r.rows.map((row: Row) => mapMarketStat(row));
  }
}

export interface UpsertNeighborhoodSummaryParams extends Omit<NeighborhoodSummary, "updatedAt"> {
  topComps: MarketComp[];
}

export class NeighborhoodSummaryRepo {
  constructor(private options: MarketContextRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async upsert(params: UpsertNeighborhoodSummaryParams): Promise<void> {
    await this.client.query(
      `INSERT INTO neighborhood_summaries (neighborhood_id, comp_count_12mo, n_research, n_broker,
         n_cherry_pick_excluded, n_asking_excluded, median_cap_rate, cap_rate_range, median_psf,
         psf_range, regulatory_skew, bullets, fallback_context, data_freshness, sources, top_comps, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12::jsonb,$13,$14,$15::jsonb,$16::jsonb,now())
       ON CONFLICT (neighborhood_id) DO UPDATE SET
         comp_count_12mo = EXCLUDED.comp_count_12mo,
         n_research = EXCLUDED.n_research,
         n_broker = EXCLUDED.n_broker,
         n_cherry_pick_excluded = EXCLUDED.n_cherry_pick_excluded,
         n_asking_excluded = EXCLUDED.n_asking_excluded,
         median_cap_rate = EXCLUDED.median_cap_rate,
         cap_rate_range = EXCLUDED.cap_rate_range,
         median_psf = EXCLUDED.median_psf,
         psf_range = EXCLUDED.psf_range,
         regulatory_skew = EXCLUDED.regulatory_skew,
         bullets = EXCLUDED.bullets,
         fallback_context = EXCLUDED.fallback_context,
         data_freshness = EXCLUDED.data_freshness,
         sources = EXCLUDED.sources,
         top_comps = EXCLUDED.top_comps,
         updated_at = now()`,
      [
        params.neighborhoodId,
        params.compCount12mo,
        params.nResearch,
        params.nBroker,
        params.nCherryPickExcluded,
        params.nAskingExcluded,
        params.medianCapRate,
        params.capRateRange ? JSON.stringify(params.capRateRange) : null,
        params.medianPsf,
        params.psfRange ? JSON.stringify(params.psfRange) : null,
        params.regulatorySkew,
        JSON.stringify(params.bullets),
        params.fallbackContext,
        params.dataFreshness,
        JSON.stringify(params.sources),
        JSON.stringify(params.topComps),
      ]
    );
  }

  async listAll(): Promise<Array<NeighborhoodSummary & { topComps: MarketComp[] }>> {
    const r = await this.client.query(
      `SELECT neighborhood_id, comp_count_12mo, n_research, n_broker, n_cherry_pick_excluded,
              n_asking_excluded, median_cap_rate, cap_rate_range, median_psf, psf_range,
              regulatory_skew, bullets, fallback_context, data_freshness, sources, top_comps, updated_at
       FROM neighborhood_summaries`
    );
    return r.rows.map((row: Row) => mapNeighborhoodSummary(row));
  }

  async byId(neighborhoodId: string): Promise<(NeighborhoodSummary & { topComps: MarketComp[] }) | null> {
    const r = await this.client.query(
      `SELECT neighborhood_id, comp_count_12mo, n_research, n_broker, n_cherry_pick_excluded,
              n_asking_excluded, median_cap_rate, cap_rate_range, median_psf, psf_range,
              regulatory_skew, bullets, fallback_context, data_freshness, sources, top_comps, updated_at
       FROM neighborhood_summaries WHERE neighborhood_id = $1`,
      [neighborhoodId]
    );
    return r.rows[0] ? mapNeighborhoodSummary(r.rows[0]) : null;
  }
}

export interface InsertMarketLlmOutputParams {
  documentId: string | null;
  neighborhoodId?: string | null;
  stage: "classify" | "extract" | "synthesize" | "knowledge";
  promptVersion: string;
  provider: string | null;
  model: string | null;
  rawOutput: string | null;
  parsed: Record<string, unknown> | null;
}

export class MarketLlmOutputRepo {
  constructor(private options: MarketContextRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async insert(params: InsertMarketLlmOutputParams): Promise<void> {
    await this.client.query(
      `INSERT INTO market_llm_outputs (document_id, neighborhood_id, stage, prompt_version, provider, model, raw_output, parsed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        params.documentId,
        params.neighborhoodId ?? null,
        params.stage,
        params.promptVersion,
        params.provider,
        params.model,
        params.rawOutput,
        params.parsed != null ? JSON.stringify(params.parsed) : null,
      ]
    );
  }
}
