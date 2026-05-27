export interface MatchedPropertyLink {
  propertyId: string;
  matchSource: string;
}

export interface ThreadReplyTargets {
  propertyLinks: MatchedPropertyLink[];
  batchIds: Set<string>;
}

export interface MessageMatchTargets {
  propertyLinks: MatchedPropertyLink[];
  matchedBatchId: string | null;
  matchedBatchIds: string[];
  matchSources: string[];
  processingStatus: string;
}

export function dedupePropertyLinks(propertyLinks: MatchedPropertyLink[]): MatchedPropertyLink[] {
  const deduped = new Map<string, string>();
  for (const link of propertyLinks) {
    const propertyId = link.propertyId?.trim();
    if (!propertyId || deduped.has(propertyId)) continue;
    deduped.set(propertyId, link.matchSource?.trim() || "legacy_property");
  }
  return [...deduped.entries()].map(([propertyId, matchSource]) => ({ propertyId, matchSource }));
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export function buildProcessingStatus(propertyLinks: MatchedPropertyLink[], batchIds: string[] = []): string {
  const uniqueBatchIds = sortedUnique(batchIds);
  if (uniqueBatchIds.length > 1) return "batch_matched_multi_batch";
  if (propertyLinks.length > 1) return "batch_matched_multi_property";
  const source = propertyLinks[0]?.matchSource ?? "";
  if (source === "batch_thread") return "batch_thread_matched";
  if (source === "thread_reply") return "thread_matched";
  return "saved";
}

export function mergeMessageTargets(
  directLinks: MatchedPropertyLink[],
  threadTargets?: ThreadReplyTargets | null
): MessageMatchTargets | null {
  const propertyLinks = dedupePropertyLinks([...directLinks, ...(threadTargets?.propertyLinks ?? [])]);
  if (propertyLinks.length === 0) return null;
  const matchedBatchIds = sortedUnique(threadTargets ? [...threadTargets.batchIds] : []);
  return {
    propertyLinks,
    matchedBatchId: matchedBatchIds.length === 1 ? matchedBatchIds[0] ?? null : null,
    matchedBatchIds,
    matchSources: sortedUnique(propertyLinks.map((link) => link.matchSource)),
    processingStatus: buildProcessingStatus(propertyLinks, matchedBatchIds),
  };
}
