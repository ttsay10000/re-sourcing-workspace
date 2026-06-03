import type {
  BrokerCompExtractedItem,
  BrokerCompExtractionMethod,
  BrokerCompItemType,
  BrokerCompPackage,
  BrokerCompPackagePage,
  BrokerCompPackageStatus,
  BrokerCompPackageType,
  BrokerCompPageRef,
  BrokerCompPageType,
  BrokerCompReviewStatus,
  BrokerCompSelectionDecision,
} from "@re-sourcing/contracts";
import type { PoolClient } from "pg";

export interface BrokerCompPackageRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface CreateBrokerCompPackageParams {
  propertyId: string;
  sourceDocumentId?: string | null;
  sourceDocumentType?: string | null;
  packageType?: BrokerCompPackageType;
  status?: BrokerCompPackageStatus;
  rawPayload?: Record<string, unknown> | null;
  normalizedPayload?: Record<string, unknown> | null;
  sourceName?: string | null;
  sourceMeta?: Record<string, unknown> | null;
  pageCount?: number | null;
  parserVersion?: string | null;
  packageMeta?: Record<string, unknown> | null;
  createdBy?: string | null;
  lastError?: string | null;
}

export interface UpsertBrokerCompPackagePageParams {
  packageId: string;
  pageNumber: number;
  pageType: BrokerCompPageType;
  extractionMethod?: BrokerCompExtractionMethod | null;
  confidence?: number | null;
  pageRef?: string | null;
  rawTextExcerpt?: string | null;
  regions?: Record<string, unknown> | null;
  rawPayload?: Record<string, unknown> | null;
  normalizedPayload?: Record<string, unknown> | null;
  reviewStatus?: BrokerCompReviewStatus | null;
}

export interface CreateBrokerCompExtractedItemParams {
  packageId: string;
  propertyId: string;
  itemType: BrokerCompItemType;
  rawPayload?: Record<string, unknown> | null;
  normalizedPayload?: Record<string, unknown> | null;
  reviewedPayload?: Record<string, unknown> | null;
  pageRefs?: BrokerCompPageRef[] | null;
  confidence?: number | null;
  reviewStatus?: BrokerCompReviewStatus;
  selectionDecision?: BrokerCompSelectionDecision | null;
  includeInDossier?: boolean;
  analystNote?: string | null;
  reviewedAt?: string | null;
}

export interface UpdateBrokerCompExtractedItemParams {
  rawPayload?: Record<string, unknown> | null;
  normalizedPayload?: Record<string, unknown> | null;
  reviewedPayload?: Record<string, unknown> | null;
  pageRefs?: BrokerCompPageRef[] | null;
  confidence?: number | null;
  reviewStatus?: BrokerCompReviewStatus;
  selectionDecision?: BrokerCompSelectionDecision | null;
  includeInDossier?: boolean;
  analystNote?: string | null;
  reviewedAt?: string | null;
}

export interface BrokerCompPackageRecord extends BrokerCompPackage {
  rawPayload?: Record<string, unknown> | null;
  normalizedPayload?: Record<string, unknown> | null;
  packageMeta?: Record<string, unknown> | null;
  createdBy?: string | null;
  reviewedAt?: string | null;
  promotedAt?: string | null;
}

export interface BrokerCompPackagePageRecord extends BrokerCompPackagePage {
  pageRef?: string | null;
  rawPayload?: Record<string, unknown> | null;
  normalizedPayload?: Record<string, unknown> | null;
  reviewStatus?: BrokerCompReviewStatus | null;
}

export interface BrokerCompExtractedItemRecord extends BrokerCompExtractedItem {
  reviewedPayload?: Record<string, unknown> | null;
  reviewedAt?: string | null;
  promotedAt?: string | null;
  reviewerNotes?: string | null;
}

export type BrokerCompPackageDetailItem = Omit<BrokerCompExtractedItemRecord, "reviewStatus"> & {
  reviewStatus: string;
};

export interface BrokerCompPromotedItem {
  id: string;
  propertyId: string;
  packageId: string;
  extractedItemId: string;
  sourceDocumentId?: string | null;
  packageType: BrokerCompPackageType;
  itemType: BrokerCompItemType;
  rawPayload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown>;
  reviewedPayload?: Record<string, unknown> | null;
  pageRefs: BrokerCompPageRef[];
  confidence?: number | null;
  selectionDecision?: BrokerCompSelectionDecision | null;
  includeInDossier: boolean;
  analystNote?: string | null;
  promotedBy?: string | null;
  promotedAt: string;
  createdAt: string;
}

export interface BrokerCompPackageDetails {
  package: BrokerCompPackageRecord;
  pages: BrokerCompPackagePageRecord[];
  items: BrokerCompPackageDetailItem[];
  extractedItems: BrokerCompPackageDetailItem[];
  promotedItems: BrokerCompPromotedItem[];
}

export interface PromoteBrokerCompItemParams {
  package: BrokerCompPackageRecord;
  item: BrokerCompExtractedItemRecord;
  reviewedPayload?: Record<string, unknown> | null;
  promotedBy?: string | null;
  promotedAt?: string | null;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toPageRefs(value: unknown): BrokerCompPageRef[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        if (entry == null || typeof entry !== "object" || Array.isArray(entry)) return [];
        const record = entry as Record<string, unknown>;
        const pageNumber = Number(record.pageNumber ?? record.page_number);
        if (!Number.isFinite(pageNumber)) return [];
        return [{
          pageNumber: Math.trunc(pageNumber),
          label: typeof record.label === "string" ? record.label : null,
        }];
      })
    : [];
}

function mapPackage(row: Record<string, unknown>): BrokerCompPackageRecord {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    sourceDocumentId: (row.source_document_id as string) ?? null,
    sourceDocumentType: (row.source_document_type as string) ?? null,
    packageType: row.package_type as BrokerCompPackageType,
    status: row.status as BrokerCompPackageStatus,
    rawPayload: toRecordOrNull(row.raw_payload),
    normalizedPayload: toRecordOrNull(row.normalized_payload),
    sourceName: (row.source_name as string) ?? null,
    sourceMeta: row.source_meta != null ? toRecord(row.source_meta) : null,
    pageCount: row.page_count != null ? Number(row.page_count) : null,
    parserVersion: (row.parser_version as string) ?? null,
    packageMeta: toRecordOrNull(row.package_meta),
    createdBy: (row.created_by as string) ?? null,
    reviewedAt: row.reviewed_at != null ? toIso(row.reviewed_at) : null,
    promotedAt: row.promoted_at != null ? toIso(row.promoted_at) : null,
    lastError: (row.last_error as string) ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapPage(row: Record<string, unknown>): BrokerCompPackagePageRecord {
  return {
    id: row.id as string,
    packageId: row.package_id as string,
    pageNumber: Number(row.page_number),
    pageType: row.page_type as BrokerCompPageType,
    extractionMethod: (row.extraction_method as BrokerCompExtractionMethod) ?? null,
    confidence: row.confidence != null ? Number(row.confidence) : null,
    pageRef: (row.page_ref as string) ?? null,
    rawTextExcerpt: (row.raw_text_excerpt as string) ?? null,
    regions: row.regions != null ? toRecord(row.regions) : null,
    rawPayload: toRecordOrNull(row.raw_payload),
    normalizedPayload: toRecordOrNull(row.normalized_payload),
    reviewStatus: (row.review_status as BrokerCompReviewStatus) ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapItem(row: Record<string, unknown>): BrokerCompExtractedItemRecord {
  return {
    id: row.id as string,
    packageId: row.package_id as string,
    propertyId: row.property_id as string,
    itemType: row.item_type as BrokerCompItemType,
    rawPayload: toRecord(row.raw_payload),
    normalizedPayload: toRecord(row.normalized_payload),
    reviewedPayload: toRecordOrNull(row.reviewed_payload),
    pageRefs: toPageRefs(row.page_refs),
    confidence: row.confidence != null ? Number(row.confidence) : null,
    reviewStatus: row.review_status as BrokerCompReviewStatus,
    selectionDecision: (row.selection_decision as BrokerCompSelectionDecision) ?? null,
    includeInDossier: row.include_in_dossier === true,
    analystNote: (row.analyst_note as string) ?? null,
    reviewedAt: row.reviewed_at != null ? toIso(row.reviewed_at) : null,
    promotedAt: row.promoted_at != null ? toIso(row.promoted_at) : null,
    reviewerNotes: (row.reviewer_notes as string) ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapPromotedItem(row: Record<string, unknown>): BrokerCompPromotedItem {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    packageId: row.package_id as string,
    extractedItemId: row.extracted_item_id as string,
    sourceDocumentId: (row.source_document_id as string) ?? null,
    packageType: row.package_type as BrokerCompPackageType,
    itemType: row.item_type as BrokerCompItemType,
    rawPayload: toRecord(row.raw_payload),
    normalizedPayload: toRecord(row.normalized_payload),
    reviewedPayload: toRecordOrNull(row.reviewed_payload),
    pageRefs: toPageRefs(row.page_refs),
    confidence: row.confidence != null ? Number(row.confidence) : null,
    selectionDecision: (row.selection_decision as BrokerCompSelectionDecision) ?? null,
    includeInDossier: row.include_in_dossier !== false,
    analystNote: (row.analyst_note as string) ?? null,
    promotedBy: (row.promoted_by as string) ?? null,
    promotedAt: toIso(row.promoted_at),
    createdAt: toIso(row.created_at),
  };
}

export class BrokerCompPackageRepo {
  constructor(private options: BrokerCompPackageRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async createPackage(params: CreateBrokerCompPackageParams): Promise<BrokerCompPackageRecord> {
    const result = await this.client.query(
      `INSERT INTO broker_comp_packages (
        property_id,
        source_document_id,
        source_document_type,
        package_type,
        status,
        raw_payload,
        normalized_payload,
        source_name,
        source_meta,
        page_count,
        parser_version,
        package_meta,
        created_by,
        last_error
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $11, $12::jsonb, $13, $14)
      RETURNING *`,
      [
        params.propertyId,
        params.sourceDocumentId ?? null,
        params.sourceDocumentType ?? null,
        params.packageType ?? "other",
        params.status ?? "uploaded",
        params.rawPayload != null ? JSON.stringify(params.rawPayload) : null,
        params.normalizedPayload != null ? JSON.stringify(params.normalizedPayload) : null,
        params.sourceName?.trim() || null,
        params.sourceMeta != null ? JSON.stringify(params.sourceMeta) : null,
        params.pageCount ?? null,
        params.parserVersion ?? null,
        params.packageMeta != null ? JSON.stringify(params.packageMeta) : null,
        params.createdBy ?? null,
        params.lastError ?? null,
      ]
    );
    return mapPackage(result.rows[0]);
  }

  async getPackage(id: string): Promise<BrokerCompPackageRecord | null> {
    const result = await this.client.query("SELECT * FROM broker_comp_packages WHERE id = $1", [id]);
    return result.rows[0] ? mapPackage(result.rows[0]) : null;
  }

  async getPackageForProperty(propertyId: string, packageId: string): Promise<BrokerCompPackageRecord | null> {
    const result = await this.client.query(
      "SELECT * FROM broker_comp_packages WHERE property_id = $1 AND id = $2",
      [propertyId, packageId]
    );
    return result.rows[0] ? mapPackage(result.rows[0]) : null;
  }

  async listPackagesByPropertyId(propertyId: string, limit = 50): Promise<BrokerCompPackageRecord[]> {
    const result = await this.client.query(
      "SELECT * FROM broker_comp_packages WHERE property_id = $1 ORDER BY created_at DESC LIMIT $2",
      [propertyId, limit]
    );
    return result.rows.map((row: Record<string, unknown>) => mapPackage(row));
  }

  async deleteExtractedPackagesForProperty(propertyId: string): Promise<Array<{ id: string; sourceDocumentId: string | null }>> {
    const result = await this.client.query(
      `DELETE FROM broker_comp_packages
       WHERE property_id = $1
         AND package_type <> 'broker_opinion'
       RETURNING id, source_document_id`,
      [propertyId]
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      sourceDocumentId: row.source_document_id == null ? null : String(row.source_document_id),
    }));
  }

  async updatePackageStatus(
    id: string,
    status: BrokerCompPackageStatus,
    patch: {
      pageCount?: number | null;
      lastError?: string | null;
      sourceMeta?: Record<string, unknown> | null;
      reviewedAt?: string | null;
      promotedAt?: string | null;
    } = {}
  ): Promise<BrokerCompPackageRecord | null> {
    const result = await this.client.query(
      `UPDATE broker_comp_packages
       SET status = $2,
           page_count = COALESCE($3, page_count),
           last_error = $4,
           source_meta = COALESCE(source_meta, '{}'::jsonb) || COALESCE($5::jsonb, '{}'::jsonb),
           reviewed_at = COALESCE($6::timestamptz, reviewed_at),
           promoted_at = COALESCE($7::timestamptz, promoted_at),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        status,
        patch.pageCount ?? null,
        patch.lastError ?? null,
        patch.sourceMeta != null ? JSON.stringify(patch.sourceMeta) : null,
        patch.reviewedAt ?? null,
        patch.promotedAt ?? null,
      ]
    );
    return result.rows[0] ? mapPackage(result.rows[0]) : null;
  }

  async upsertPage(params: UpsertBrokerCompPackagePageParams): Promise<BrokerCompPackagePageRecord> {
    const result = await this.client.query(
      `INSERT INTO broker_comp_package_pages (
        package_id,
        page_number,
        page_type,
        extraction_method,
        confidence,
        page_ref,
        raw_text_excerpt,
        regions,
        raw_payload,
        normalized_payload,
        review_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11)
      ON CONFLICT (package_id, page_number)
      DO UPDATE SET
        page_type = EXCLUDED.page_type,
        extraction_method = EXCLUDED.extraction_method,
        confidence = EXCLUDED.confidence,
        page_ref = EXCLUDED.page_ref,
        raw_text_excerpt = EXCLUDED.raw_text_excerpt,
        regions = EXCLUDED.regions,
        raw_payload = EXCLUDED.raw_payload,
        normalized_payload = EXCLUDED.normalized_payload,
        review_status = EXCLUDED.review_status,
        updated_at = now()
      RETURNING *`,
      [
        params.packageId,
        params.pageNumber,
        params.pageType,
        params.extractionMethod ?? null,
        params.confidence ?? null,
        params.pageRef ?? null,
        params.rawTextExcerpt ?? null,
        params.regions != null ? JSON.stringify(params.regions) : null,
        params.rawPayload != null ? JSON.stringify(params.rawPayload) : null,
        params.normalizedPayload != null ? JSON.stringify(params.normalizedPayload) : null,
        params.reviewStatus ?? "pending",
      ]
    );
    return mapPage(result.rows[0]);
  }

  async listPages(packageId: string): Promise<BrokerCompPackagePageRecord[]> {
    const result = await this.client.query(
      "SELECT * FROM broker_comp_package_pages WHERE package_id = $1 ORDER BY page_number",
      [packageId]
    );
    return result.rows.map((row: Record<string, unknown>) => mapPage(row));
  }

  async createItem(params: CreateBrokerCompExtractedItemParams): Promise<BrokerCompExtractedItemRecord> {
    const result = await this.client.query(
      `INSERT INTO broker_comp_extracted_items (
        package_id,
        property_id,
        item_type,
        raw_payload,
        normalized_payload,
        reviewed_payload,
        page_refs,
        confidence,
        review_status,
        selection_decision,
        include_in_dossier,
        analyst_note,
        reviewed_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13::timestamptz)
      RETURNING *`,
      [
        params.packageId,
        params.propertyId,
        params.itemType,
        JSON.stringify(params.rawPayload ?? {}),
        JSON.stringify(params.normalizedPayload ?? {}),
        params.reviewedPayload != null ? JSON.stringify(params.reviewedPayload) : null,
        JSON.stringify(params.pageRefs ?? []),
        params.confidence ?? null,
        params.reviewStatus ?? "pending",
        params.selectionDecision ?? null,
        params.includeInDossier === true,
        params.analystNote ?? null,
        params.reviewedAt ?? null,
      ]
    );
    return mapItem(result.rows[0]);
  }

  async listItems(packageId: string): Promise<BrokerCompExtractedItemRecord[]> {
    const result = await this.client.query(
      "SELECT * FROM broker_comp_extracted_items WHERE package_id = $1 ORDER BY created_at, id",
      [packageId]
    );
    return result.rows.map((row: Record<string, unknown>) => mapItem(row));
  }

  async listItemsByPropertyId(propertyId: string): Promise<BrokerCompExtractedItemRecord[]> {
    const result = await this.client.query(
      `SELECT * FROM broker_comp_extracted_items
       WHERE property_id = $1
       ORDER BY created_at DESC, id`,
      [propertyId]
    );
    return result.rows.map((row: Record<string, unknown>) => mapItem(row));
  }

  async updateItem(id: string, params: UpdateBrokerCompExtractedItemParams): Promise<BrokerCompExtractedItemRecord | null> {
    const result = await this.client.query(
      `UPDATE broker_comp_extracted_items
       SET raw_payload = COALESCE($2::jsonb, raw_payload),
           normalized_payload = COALESCE($3::jsonb, normalized_payload),
           reviewed_payload = COALESCE($4::jsonb, reviewed_payload),
           page_refs = COALESCE($5::jsonb, page_refs),
           confidence = COALESCE($6, confidence),
           review_status = COALESCE($7, review_status),
           selection_decision = $8,
           include_in_dossier = COALESCE($9, include_in_dossier),
           analyst_note = $10,
           reviewed_at = COALESCE($11::timestamptz, reviewed_at),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        params.rawPayload != null ? JSON.stringify(params.rawPayload) : null,
        params.normalizedPayload != null ? JSON.stringify(params.normalizedPayload) : null,
        params.reviewedPayload != null ? JSON.stringify(params.reviewedPayload) : null,
        params.pageRefs != null ? JSON.stringify(params.pageRefs) : null,
        params.confidence ?? null,
        params.reviewStatus ?? null,
        params.selectionDecision ?? null,
        params.includeInDossier ?? null,
        params.analystNote ?? null,
        params.reviewedAt ?? null,
      ]
    );
    return result.rows[0] ? mapItem(result.rows[0]) : null;
  }

  async listItemsByIds(packageId: string, itemIds: string[]): Promise<BrokerCompExtractedItemRecord[]> {
    if (itemIds.length === 0) return [];
    const result = await this.client.query(
      `SELECT * FROM broker_comp_extracted_items
       WHERE package_id = $1 AND id = ANY($2::uuid[])
       ORDER BY created_at, id`,
      [packageId, itemIds]
    );
    return result.rows.map((row: Record<string, unknown>) => mapItem(row));
  }

  async listAcceptedItems(packageId: string): Promise<BrokerCompExtractedItemRecord[]> {
    const result = await this.client.query(
      `SELECT * FROM broker_comp_extracted_items
       WHERE package_id = $1 AND review_status = 'accepted'
       ORDER BY created_at, id`,
      [packageId]
    );
    return result.rows.map((row: Record<string, unknown>) => mapItem(row));
  }

  async promoteItem(params: PromoteBrokerCompItemParams): Promise<BrokerCompPromotedItem> {
    const promotedAt = params.promotedAt ?? new Date().toISOString();
    const reviewedPayload = params.reviewedPayload ?? params.item.reviewedPayload ?? null;
    const normalizedPayload = reviewedPayload ?? params.item.normalizedPayload ?? params.item.rawPayload;
    const result = await this.client.query(
      `INSERT INTO broker_comp_promoted_items (
        property_id,
        package_id,
        extracted_item_id,
        source_document_id,
        package_type,
        item_type,
        raw_payload,
        normalized_payload,
        reviewed_payload,
        page_refs,
        confidence,
        selection_decision,
        include_in_dossier,
        analyst_note,
        promoted_by,
        promoted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, true, $13, $14, $15::timestamptz)
      ON CONFLICT (extracted_item_id)
      DO UPDATE SET
        property_id = EXCLUDED.property_id,
        package_id = EXCLUDED.package_id,
        source_document_id = EXCLUDED.source_document_id,
        package_type = EXCLUDED.package_type,
        item_type = EXCLUDED.item_type,
        raw_payload = EXCLUDED.raw_payload,
        normalized_payload = EXCLUDED.normalized_payload,
        reviewed_payload = EXCLUDED.reviewed_payload,
        page_refs = EXCLUDED.page_refs,
        confidence = EXCLUDED.confidence,
        selection_decision = EXCLUDED.selection_decision,
        include_in_dossier = EXCLUDED.include_in_dossier,
        analyst_note = EXCLUDED.analyst_note,
        promoted_by = EXCLUDED.promoted_by,
        promoted_at = EXCLUDED.promoted_at
      RETURNING *`,
      [
        params.package.propertyId,
        params.package.id,
        params.item.id,
        params.package.sourceDocumentId ?? null,
        params.package.packageType,
        params.item.itemType,
        JSON.stringify(params.item.rawPayload ?? {}),
        JSON.stringify(normalizedPayload ?? {}),
        reviewedPayload != null ? JSON.stringify(reviewedPayload) : null,
        JSON.stringify(params.item.pageRefs ?? []),
        params.item.confidence ?? null,
        params.item.selectionDecision ?? "include",
        params.item.analystNote ?? null,
        params.promotedBy ?? null,
        promotedAt,
      ]
    );
    await this.client.query(
      `UPDATE broker_comp_extracted_items
       SET include_in_dossier = true,
           promoted_at = $2::timestamptz,
           updated_at = now()
       WHERE id = $1`,
      [params.item.id, promotedAt]
    );
    return mapPromotedItem(result.rows[0]);
  }

  async listPromotedItemsByPackageId(packageId: string): Promise<BrokerCompPromotedItem[]> {
    const result = await this.client.query(
      `SELECT * FROM broker_comp_promoted_items
       WHERE package_id = $1
       ORDER BY promoted_at DESC`,
      [packageId]
    );
    return result.rows.map((row: Record<string, unknown>) => mapPromotedItem(row));
  }

  async listPromotedItemsByPropertyId(propertyId: string, limit = 100): Promise<BrokerCompPromotedItem[]> {
    const result = await this.client.query(
      `SELECT * FROM broker_comp_promoted_items
       WHERE property_id = $1
       ORDER BY promoted_at DESC
       LIMIT $2`,
      [propertyId, limit]
    );
    return result.rows.map((row: Record<string, unknown>) => mapPromotedItem(row));
  }

  async getPackageDetails(packageId: string): Promise<BrokerCompPackageDetails | null> {
    const brokerCompPackage = await this.getPackage(packageId);
    if (!brokerCompPackage) return null;
    const [pages, items, promotedItems] = await Promise.all([
      this.listPages(packageId),
      this.listItems(packageId),
      this.listPromotedItemsByPackageId(packageId),
    ]);
    return {
      package: brokerCompPackage,
      pages,
      items,
      extractedItems: items,
      promotedItems,
    };
  }
}
