import type {
  BrokerCompExtractionMethod,
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
  type BrokerCompPromotedItem,
} from "@re-sourcing/db";
import type { Pool } from "pg";

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
        includeInDossier: itemInput.includeInDossier,
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
      includeInDossier: input.includeInDossier,
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
      await repo.updatePackageStatus(input.packageId, "approved", { reviewedAt });
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
    const blocked = items.filter((item) => item.reviewStatus !== "accepted");
    if (blocked.length > 0) {
      throw new BrokerCompApiError(400, "Only accepted broker comp items can be promoted.", {
        itemIds: blocked.map((item) => item.id),
      });
    }
    if (items.length === 0) {
      throw new BrokerCompApiError(400, "No accepted broker comp items are available to promote.", {
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
