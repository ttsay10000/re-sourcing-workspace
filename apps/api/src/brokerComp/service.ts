import type {
  BrokerCompExtractionMethod,
  BrokerCompExtractedItem,
  BrokerCompItemType,
  BrokerCompPackageStatus,
  BrokerCompPackageType,
  BrokerCompPageRef,
  BrokerCompPageType,
  BrokerCompReviewStatus,
  BrokerCompSelectionDecision,
} from "@re-sourcing/contracts";
import {
  BrokerCompPackageRepo,
  PropertyRepo,
  PropertyUploadedDocumentRepo,
  type BrokerCompPackageDetails,
  type BrokerCompExtractedItemRecord,
  type BrokerCompPromotedItem,
} from "@re-sourcing/db";
import type { Pool } from "pg";
import { runLiveMarketAnalysis } from "../brokerComps/marketAnalysisLlm.js";
import { MARKET_PROMPT_V3_VERSION } from "../brokerComps/marketPromptV3.js";

export class BrokerCompApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export interface BrokerCompPageInput {
  pageNumber: number;
  pageType: BrokerCompPageType;
  extractionMethod?: BrokerCompExtractionMethod | null;
  pageRef?: string | null;
  rawTextExcerpt?: string | null;
  regions?: Record<string, unknown> | null;
  rawPayload?: Record<string, unknown> | null;
  normalizedPayload?: Record<string, unknown> | null;
  confidence?: number | null;
  reviewStatus?: BrokerCompReviewStatus | null;
}

export interface BrokerCompExtractedItemInput {
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
}

export interface CreateBrokerCompPackageInput {
  propertyId: string;
  sourceDocumentId: string;
  packageType: BrokerCompPackageType;
  status: BrokerCompPackageStatus;
  replaceExistingForProperty?: boolean;
  rawPayload?: Record<string, unknown> | null;
  normalizedPayload?: Record<string, unknown> | null;
  sourceName?: string | null;
  sourceMeta?: Record<string, unknown> | null;
  pageCount?: number | null;
  parserVersion?: string | null;
  packageMeta?: Record<string, unknown> | null;
  createdBy?: string | null;
  pages: BrokerCompPageInput[];
  extractedItems: BrokerCompExtractedItemInput[];
}

export interface ReviewBrokerCompItemInput {
  propertyId: string;
  packageId: string;
  itemId: string;
  reviewStatus: BrokerCompReviewStatus;
  normalizedPayload?: Record<string, unknown> | null;
  reviewedPayload?: Record<string, unknown> | null;
  pageRefs?: BrokerCompPageRef[] | null;
  confidence?: number | null;
  selectionDecision?: BrokerCompSelectionDecision | null;
  includeInDossier?: boolean;
  analystNote?: string | null;
}

export interface PromoteBrokerCompPackageInput {
  propertyId: string;
  packageId: string;
  itemIds?: string[] | null;
  promotedBy?: string | null;
}

export type BrokerCompDocumentReviewStatus = "pending" | "approved" | "rejected";

export interface ReviewBrokerCompPackageDocumentInput {
  propertyId: string;
  packageId: string;
  documentReviewStatus: BrokerCompDocumentReviewStatus;
  reviewedBy?: string | null;
  notes?: string | null;
}

export interface RefreshLiveMarketAnalysisInput {
  propertyId: string;
  requestedBy?: string | null;
  maxPackages?: number;
}

export interface LiveMarketAnalysisSnapshotResult {
  propertyId: string;
  snapshot: Record<string, unknown> | null;
  previousSnapshot: unknown;
  sourceSummary: {
    approvedDocumentReviewCount: number;
    approvedMarketCompRowCount: number;
    approvedCompItemCount: number;
    excludedOrWatchRowCount: number;
  };
}

function isDownstreamIncludedDecision(decision: BrokerCompSelectionDecision | null | undefined): boolean {
  return decision == null || decision === "include";
}

function reviewIncludeInDossier(
  decision: BrokerCompSelectionDecision | null | undefined,
  requested: boolean | undefined
): boolean | undefined {
  if (!isDownstreamIncludedDecision(decision)) return false;
  if (decision === "include") return requested ?? true;
  return requested;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function packageMetaRecord(details: BrokerCompPackageDetails | BrokerCompPackageDetails["package"]): Record<string, unknown> {
  const brokerPackage = "package" in details ? details.package : details;
  return toRecord(brokerPackage.packageMeta);
}

function isPackageDocumentReviewApproved(brokerCompPackage: BrokerCompPackageDetails["package"]): boolean {
  return packageMetaRecord(brokerCompPackage).documentReviewStatus === "approved";
}

function itemPayloadForAnalysis(item: BrokerCompExtractedItem | BrokerCompExtractedItemRecord): Record<string, unknown> {
  const reviewedPayload = (item as { reviewedPayload?: unknown }).reviewedPayload;
  if (isRecord(reviewedPayload)) return reviewedPayload;
  if (isRecord(item.normalizedPayload)) return item.normalizedPayload;
  if (isRecord(item.rawPayload)) return item.rawPayload;
  return {};
}

function isItemApprovedForLiveAnalysis(item: BrokerCompExtractedItem | BrokerCompExtractedItemRecord): boolean {
  return (
    (item.reviewStatus === "accepted" || item.reviewStatus === "edited") &&
    isDownstreamIncludedDecision(item.selectionDecision) &&
    item.includeInDossier === true
  );
}

const MARKET_COMPS_TABLE_ITEM_TYPES = new Set<BrokerCompItemType>([
  "sale_comp",
  "lease_comp",
  "retail_sale",
  "development_comp",
  "conversion_comp",
  "portfolio_sale",
  "recapitalization",
  "distressed_sale",
  "operating_snapshot",
  "rent_roll_row",
  "expense_row",
  "pricing_comp",
]);

function liveAnalysisItemRecord(
  detail: BrokerCompPackageDetails,
  item: BrokerCompExtractedItemRecord
): Record<string, unknown> {
  return {
    itemId: item.id,
    packageId: detail.package.id,
    sourceDocumentId: detail.package.sourceDocumentId ?? null,
    sourceName: detail.package.sourceName ?? null,
    packageType: detail.package.packageType,
    itemType: item.itemType,
    reviewStatus: item.reviewStatus,
    selectionDecision: item.selectionDecision ?? null,
    includeInDossier: item.includeInDossier,
    confidence: item.confidence ?? null,
    pageRefs: item.pageRefs ?? [],
    analystNote: item.analystNote ?? null,
    payload: itemPayloadForAnalysis(item),
  };
}

function previousSnapshotMeta(snapshot: unknown): Record<string, unknown> | null {
  if (!isRecord(snapshot)) return null;
  const meta = isRecord(snapshot.snapshotMeta) ? snapshot.snapshotMeta : null;
  return {
    schemaVersion: typeof snapshot.schemaVersion === "string" ? snapshot.schemaVersion : null,
    generatedAt: typeof meta?.generatedAt === "string" ? meta.generatedAt : null,
    promptVersion: typeof meta?.promptVersion === "string" ? meta.promptVersion : null,
  };
}

async function assertPropertyAndUploadedDocument(params: {
  pool: Pool;
  propertyId: string;
  sourceDocumentId: string;
}): Promise<void> {
  const propertyRepo = new PropertyRepo({ pool: params.pool });
  const property = await propertyRepo.byId(params.propertyId);
  if (!property) {
    throw new BrokerCompApiError(404, "Property not found.", { propertyId: params.propertyId });
  }

  const documentRepo = new PropertyUploadedDocumentRepo({ pool: params.pool });
  const document = await documentRepo.byId(params.sourceDocumentId);
  if (!document || document.propertyId !== params.propertyId) {
    throw new BrokerCompApiError(404, "Uploaded source document not found for this property.", {
      propertyId: params.propertyId,
      sourceDocumentId: params.sourceDocumentId,
    });
  }
}

async function assertPropertyExists(pool: Pool, propertyId: string): Promise<void> {
  const propertyRepo = new PropertyRepo({ pool });
  const property = await propertyRepo.byId(propertyId);
  if (!property) {
    throw new BrokerCompApiError(404, "Property not found.", { propertyId });
  }
}

async function getPropertyOrThrow(pool: Pool, propertyId: string) {
  const propertyRepo = new PropertyRepo({ pool });
  const property = await propertyRepo.byId(propertyId);
  if (!property) {
    throw new BrokerCompApiError(404, "Property not found.", { propertyId });
  }
  return property;
}

export async function createBrokerCompPackage(
  pool: Pool,
  input: CreateBrokerCompPackageInput
): Promise<BrokerCompPackageDetails> {
  await assertPropertyAndUploadedDocument({
    pool,
    propertyId: input.propertyId,
    sourceDocumentId: input.sourceDocumentId,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const repo = new BrokerCompPackageRepo({ pool, client });
    if (input.replaceExistingForProperty) {
      const replacedPackages = await repo.deleteExtractedPackagesForProperty(input.propertyId);
      const documentRepo = new PropertyUploadedDocumentRepo({ pool, client });
      for (const documentId of new Set(replacedPackages.flatMap((pkg) => (pkg.sourceDocumentId ? [pkg.sourceDocumentId] : [])))) {
        if (documentId !== input.sourceDocumentId) await documentRepo.delete(documentId);
      }
    }
    const brokerCompPackage = await repo.createPackage({
      propertyId: input.propertyId,
      sourceDocumentId: input.sourceDocumentId,
      sourceDocumentType: "uploaded",
      packageType: input.packageType,
      status: input.status,
      rawPayload: input.rawPayload,
      normalizedPayload: input.normalizedPayload,
      sourceName: input.sourceName,
      sourceMeta: input.sourceMeta,
      pageCount: input.pageCount ?? (input.pages.length > 0 ? input.pages.length : null),
      parserVersion: input.parserVersion,
      packageMeta: input.packageMeta,
      createdBy: input.createdBy,
    });

    const pages = [];
    for (const pageInput of input.pages) {
      const page = await repo.upsertPage({
        packageId: brokerCompPackage.id,
        pageNumber: pageInput.pageNumber,
        pageType: pageInput.pageType,
        extractionMethod: pageInput.extractionMethod,
        confidence: pageInput.confidence,
        pageRef: pageInput.pageRef,
        rawTextExcerpt: pageInput.rawTextExcerpt,
        regions: pageInput.regions,
        rawPayload: pageInput.rawPayload,
        normalizedPayload: pageInput.normalizedPayload,
        reviewStatus: pageInput.reviewStatus,
      });
      pages.push(page);
    }

    const items = [];
    for (const itemInput of input.extractedItems) {
      const reviewedAt =
        itemInput.reviewStatus === "accepted" || itemInput.reviewStatus === "rejected" || itemInput.reviewStatus === "edited"
          ? new Date().toISOString()
          : null;
      const item = await repo.createItem({
        packageId: brokerCompPackage.id,
        propertyId: input.propertyId,
        itemType: itemInput.itemType,
        rawPayload: itemInput.rawPayload,
        normalizedPayload: itemInput.normalizedPayload,
        reviewedPayload: itemInput.reviewedPayload,
        pageRefs: itemInput.pageRefs,
        confidence: itemInput.confidence,
        reviewStatus: itemInput.reviewStatus,
        selectionDecision: itemInput.selectionDecision,
        includeInDossier: reviewIncludeInDossier(itemInput.selectionDecision, itemInput.includeInDossier),
        analystNote: itemInput.analystNote,
        reviewedAt,
      });
      items.push(item);
    }

    await client.query("COMMIT");
    return {
      package: brokerCompPackage,
      pages,
      items,
      extractedItems: items,
      promotedItems: [],
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function listBrokerCompPackages(
  pool: Pool,
  propertyId: string,
  limit: number
): Promise<BrokerCompPackageDetails["package"][]> {
  await assertPropertyExists(pool, propertyId);
  const repo = new BrokerCompPackageRepo({ pool });
  return repo.listPackagesByPropertyId(propertyId, limit);
}

export async function getBrokerCompPackageDetails(
  pool: Pool,
  propertyId: string,
  packageId: string
): Promise<BrokerCompPackageDetails> {
  await assertPropertyExists(pool, propertyId);
  const repo = new BrokerCompPackageRepo({ pool });
  const details = await repo.getPackageDetails(packageId);
  if (!details || details.package.propertyId !== propertyId) {
    throw new BrokerCompApiError(404, "Broker comp package not found for this property.", {
      propertyId,
      packageId,
    });
  }
  return details;
}

export async function reviewBrokerCompExtractedItem(
  pool: Pool,
  input: ReviewBrokerCompItemInput
): Promise<BrokerCompPackageDetails> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const repo = new BrokerCompPackageRepo({ pool, client });
    const brokerCompPackage = await repo.getPackageForProperty(input.propertyId, input.packageId);
    if (!brokerCompPackage) {
      throw new BrokerCompApiError(404, "Broker comp package not found for this property.", {
        propertyId: input.propertyId,
        packageId: input.packageId,
      });
    }

    const reviewedAt = new Date().toISOString();
    const reviewed = await repo.updateItem(input.itemId, {
      reviewStatus: input.reviewStatus,
      normalizedPayload: input.normalizedPayload,
      reviewedPayload: input.reviewedPayload,
      pageRefs: input.pageRefs,
      confidence: input.confidence,
      selectionDecision: input.selectionDecision,
      includeInDossier: reviewIncludeInDossier(input.selectionDecision, input.includeInDossier),
      analystNote: input.analystNote,
      reviewedAt,
    });
    if (!reviewed || reviewed.packageId !== input.packageId) {
      throw new BrokerCompApiError(404, "Broker comp extracted item not found for this package.", {
        packageId: input.packageId,
        itemId: input.itemId,
      });
    }

    const items = await repo.listItems(input.packageId);
    const allReviewed =
      items.length > 0 && items.every((item) => item.reviewStatus !== "pending");
    if (allReviewed) {
      await repo.updatePackageStatus(input.packageId, isPackageDocumentReviewApproved(brokerCompPackage) ? "approved" : "needs_review", {
        reviewedAt: isPackageDocumentReviewApproved(brokerCompPackage) ? reviewedAt : null,
      });
    } else if (brokerCompPackage.status === "uploaded" || brokerCompPackage.status === "classified") {
      await repo.updatePackageStatus(input.packageId, "needs_review");
    }

    await client.query("COMMIT");
    return getBrokerCompPackageDetails(pool, input.propertyId, input.packageId);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function reviewBrokerCompPackageDocument(
  pool: Pool,
  input: ReviewBrokerCompPackageDocumentInput
): Promise<BrokerCompPackageDetails> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const repo = new BrokerCompPackageRepo({ pool, client });
    const brokerCompPackage = await repo.getPackageForProperty(input.propertyId, input.packageId);
    if (!brokerCompPackage) {
      throw new BrokerCompApiError(404, "Broker comp package not found for this property.", {
        propertyId: input.propertyId,
        packageId: input.packageId,
      });
    }

    const items = await repo.listItems(input.packageId);
    const allRowsReviewed = items.length > 0 && items.every((item) => item.reviewStatus !== "pending");
    const reviewedAt = new Date().toISOString();
    const documentApproved = input.documentReviewStatus === "approved";
    const nextPackageStatus: BrokerCompPackageStatus = documentApproved && allRowsReviewed ? "approved" : "needs_review";
    const existingMeta = packageMetaRecord(brokerCompPackage);

    await repo.updatePackageMeta(input.packageId, {
      status: nextPackageStatus,
      reviewedAt: documentApproved && allRowsReviewed ? reviewedAt : null,
      packageMeta: {
        documentReviewStatus: input.documentReviewStatus,
        documentReviewReviewedAt: reviewedAt,
        documentReviewReviewedBy: input.reviewedBy ?? null,
        documentReviewApprovedAt: documentApproved ? reviewedAt : null,
        documentReviewApprovedBy: documentApproved ? input.reviewedBy ?? null : null,
        documentReviewNotes: input.notes ?? null,
        documentReviewApprovalGate: {
          requiredForLiveAnalysis: true,
          rowApprovalRequiredForLiveAnalysis: true,
          allRowsReviewed,
          approvedReviewPresent: isRecord(existingMeta.gptDocumentReview),
        },
      },
      sourceMeta: {
        documentReviewStatus: input.documentReviewStatus,
      },
    });

    await client.query("COMMIT");
    return getBrokerCompPackageDetails(pool, input.propertyId, input.packageId);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function getLiveMarketAnalysisSnapshot(
  pool: Pool,
  propertyId: string
): Promise<LiveMarketAnalysisSnapshotResult> {
  const property = await getPropertyOrThrow(pool, propertyId);
  const details = toRecord(property.details);
  const marketAnalysis = toRecord(details.marketAnalysis);
  const snapshot = isRecord(marketAnalysis.liveSnapshot)
    ? marketAnalysis.liveSnapshot
    : isRecord(marketAnalysis.latestSnapshot)
      ? marketAnalysis.latestSnapshot
      : null;
  const snapshotMeta = isRecord(snapshot?.snapshotMeta) ? snapshot.snapshotMeta : {};
  const sourceCount = (key: string): number => {
    const value = snapshotMeta[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  return {
    propertyId,
    snapshot,
    previousSnapshot: snapshot,
    sourceSummary: {
      approvedDocumentReviewCount: sourceCount("approvedDocumentReviewCount"),
      approvedMarketCompRowCount: sourceCount("approvedMarketCompRowCount"),
      approvedCompItemCount: sourceCount("approvedCompItemCount"),
      excludedOrWatchRowCount: sourceCount("excludedOrWatchRowCount"),
    },
  };
}

export async function refreshLiveMarketAnalysis(
  pool: Pool,
  input: RefreshLiveMarketAnalysisInput
): Promise<LiveMarketAnalysisSnapshotResult> {
  const property = await getPropertyOrThrow(pool, input.propertyId);
  const packageRepo = new BrokerCompPackageRepo({ pool });
  const packages = await packageRepo.listPackagesByPropertyId(input.propertyId, input.maxPackages ?? 100);
  const packageDetails = await Promise.all(packages.map((pkg) => packageRepo.getPackageDetails(pkg.id)));
  const details = packageDetails.filter((detail): detail is BrokerCompPackageDetails => detail != null);

  const approvedReviewDetails = details.filter((detail) => {
    const meta = packageMetaRecord(detail);
    return meta.documentReviewStatus === "approved" && isRecord(meta.gptDocumentReview);
  });
  if (approvedReviewDetails.length === 0) {
    throw new BrokerCompApiError(400, "Approve at least one GPT document review before refreshing live market analysis.", {
      propertyId: input.propertyId,
      packageCount: details.length,
    });
  }

  const approvedDocumentReviews = approvedReviewDetails.map((detail) => {
    const meta = packageMetaRecord(detail);
    return {
      packageId: detail.package.id,
      sourceDocumentId: detail.package.sourceDocumentId ?? null,
      sourceName: detail.package.sourceName ?? null,
      packageType: detail.package.packageType,
      parserVersion: detail.package.parserVersion ?? null,
      createdAt: detail.package.createdAt,
      updatedAt: detail.package.updatedAt,
      documentReviewApprovedAt: meta.documentReviewApprovedAt ?? null,
      promptVersion: meta.promptVersion ?? MARKET_PROMPT_V3_VERSION,
      review: meta.gptDocumentReview,
    };
  });

  const approvedCompItems = approvedReviewDetails.flatMap((detail) =>
    detail.items
      .filter((item) => isItemApprovedForLiveAnalysis(item as BrokerCompExtractedItemRecord))
      .map((item) => liveAnalysisItemRecord(detail, item as BrokerCompExtractedItemRecord))
  );
  const approvedMarketCompsTableRows = approvedReviewDetails.flatMap((detail) =>
    detail.items
      .filter((item) => MARKET_COMPS_TABLE_ITEM_TYPES.has(item.itemType))
      .filter((item) => isItemApprovedForLiveAnalysis(item as BrokerCompExtractedItemRecord))
      .map((item) => liveAnalysisItemRecord(detail, item as BrokerCompExtractedItemRecord))
  );
  const excludedOrWatchRows = approvedReviewDetails.flatMap((detail) =>
    detail.items
      .filter((item) => !isItemApprovedForLiveAnalysis(item as BrokerCompExtractedItemRecord))
      .slice(0, 200)
      .map((item) => liveAnalysisItemRecord(detail, item as BrokerCompExtractedItemRecord))
  );

  const propertyDetails = toRecord(property.details);
  const marketAnalysis = toRecord(propertyDetails.marketAnalysis);
  const previousSnapshot = marketAnalysis.liveSnapshot ?? marketAnalysis.latestSnapshot ?? null;
  const result = await runLiveMarketAnalysis({
    propertyContextJson: {
      propertyId: property.id,
      canonicalAddress: property.canonicalAddress,
      promptVersion: MARKET_PROMPT_V3_VERSION,
      defaultLens: "NYC multifamily and mixed-use acquisitions; Manhattan below 96th Street priority; small under-9/under-10 unit mostly free-market buildings; mixed-use retail underwritten conservatively.",
    },
    approvedDocumentReviews,
    approvedMarketCompsTableRows,
    approvedCompItems,
    excludedOrWatchRows,
    previousSnapshot,
  });

  if (!result.parsed) {
    throw new BrokerCompApiError(503, "Live market analysis refresh did not return valid JSON.", {
      propertyId: input.propertyId,
      model: result.model,
      finishReason: result.finishReason,
      parseError: result.parseError ?? "Unknown parse error.",
    });
  }

  const generatedAt = new Date().toISOString();
  const parsedSnapshot = result.parsed;
  const snapshot: Record<string, unknown> = {
    ...parsedSnapshot,
    schemaVersion: typeof parsedSnapshot.schemaVersion === "string" ? parsedSnapshot.schemaVersion : "live_market_analysis_v3",
    snapshotMeta: {
      ...(isRecord(parsedSnapshot.snapshotMeta) ? parsedSnapshot.snapshotMeta : {}),
      promptVersion: MARKET_PROMPT_V3_VERSION,
      generatedAt,
      model: result.model,
      finishReason: result.finishReason,
      requestedBy: input.requestedBy ?? null,
      approvedDocumentReviewCount: approvedDocumentReviews.length,
      approvedMarketCompRowCount: approvedMarketCompsTableRows.length,
      approvedCompItemCount: approvedCompItems.length,
      excludedOrWatchRowCount: excludedOrWatchRows.length,
      previousSnapshot: previousSnapshotMeta(previousSnapshot),
    },
  };

  const existingSnapshots = Array.isArray(marketAnalysis.snapshots)
    ? marketAnalysis.snapshots.filter((entry) => entry != null).slice(-19)
    : [];
  const nextMarketAnalysis = {
    ...marketAnalysis,
    liveSnapshot: snapshot,
    latestSnapshot: snapshot,
    snapshots: [...existingSnapshots, snapshot],
    liveSnapshotUpdatedAt: generatedAt,
    promptVersion: MARKET_PROMPT_V3_VERSION,
  };
  const propertyRepo = new PropertyRepo({ pool });
  await propertyRepo.mergeDetails(input.propertyId, { marketAnalysis: nextMarketAnalysis });

  return {
    propertyId: input.propertyId,
    snapshot,
    previousSnapshot,
    sourceSummary: {
      approvedDocumentReviewCount: approvedDocumentReviews.length,
      approvedMarketCompRowCount: approvedMarketCompsTableRows.length,
      approvedCompItemCount: approvedCompItems.length,
      excludedOrWatchRowCount: excludedOrWatchRows.length,
    },
  };
}

export async function promoteBrokerCompPackageItems(
  pool: Pool,
  input: PromoteBrokerCompPackageInput
): Promise<{
  ok: true;
  propertyId: string;
  packageId: string;
  promotedItems: BrokerCompPromotedItem[];
}> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const repo = new BrokerCompPackageRepo({ pool, client });
    const brokerCompPackage = await repo.getPackageForProperty(input.propertyId, input.packageId);
    if (!brokerCompPackage) {
      throw new BrokerCompApiError(404, "Broker comp package not found for this property.", {
        propertyId: input.propertyId,
        packageId: input.packageId,
      });
    }

    const requestedIds = input.itemIds ?? null;
    const items = requestedIds?.length
      ? await repo.listItemsByIds(input.packageId, requestedIds)
      : await repo.listAcceptedItems(input.packageId);

    if (requestedIds?.length && items.length !== requestedIds.length) {
      throw new BrokerCompApiError(404, "One or more broker comp extracted items were not found.", {
        packageId: input.packageId,
        requested: requestedIds.length,
        found: items.length,
      });
    }
    const blocked = items.filter((item) => item.reviewStatus !== "accepted" && item.reviewStatus !== "edited");
    if (blocked.length > 0) {
      throw new BrokerCompApiError(400, "Only accepted or edited broker comp items can be promoted.", {
        itemIds: blocked.map((item) => item.id),
      });
    }
    const excluded = items.filter((item) => !isDownstreamIncludedDecision(item.selectionDecision));
    if (excluded.length > 0) {
      throw new BrokerCompApiError(400, "Only included broker comp items can be promoted downstream.", {
        itemIds: excluded.map((item) => item.id),
        selectionDecisions: excluded.map((item) => item.selectionDecision ?? "include"),
      });
    }
    if (items.length === 0) {
      throw new BrokerCompApiError(400, "No included accepted broker comp items are available to promote.", {
        packageId: input.packageId,
      });
    }

    const promotedAt = new Date().toISOString();
    const promotedItems = [];
    for (const item of items) {
      const promoted = await repo.promoteItem({
        package: brokerCompPackage,
        item,
        promotedBy: input.promotedBy,
        promotedAt,
      });
      promotedItems.push(promoted);
    }
    await repo.updatePackageStatus(input.packageId, "approved", {
      reviewedAt: promotedAt,
      promotedAt,
    });

    await client.query("COMMIT");
    return {
      ok: true,
      propertyId: input.propertyId,
      packageId: input.packageId,
      promotedItems,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function listBrokerCompPromotedItems(
  pool: Pool,
  propertyId: string,
  limit: number
): Promise<BrokerCompPromotedItem[]> {
  await assertPropertyExists(pool, propertyId);
  const repo = new BrokerCompPackageRepo({ pool });
  return repo.listPromotedItemsByPropertyId(propertyId, limit);
}
