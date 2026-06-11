/**
 * Cross-property broker contact reuse. A broker verified once (source payload,
 * promoted lookup, or manual entry) is stored in broker_contacts and reused for
 * their other listings before spending another web-search lookup.
 */
import type { AgentEnrichmentEntry } from "@re-sourcing/contracts";
import { BrokerContactRepo } from "@re-sourcing/db";
import { firmsCompatible } from "./brokerEnrichment.js";

interface DirectoryRow {
  normalized_email: string | null;
  display_name: string | null;
  firm: string | null;
  phone: string | null;
  updated_at: Date | string;
}

/**
 * Find a previously verified contact for this broker name (and compatible
 * firm) in the directory. Returns a ready-to-merge enrichment entry or null.
 *
 * broker_contacts also holds rows that recipient-resolution sync stored as
 * review-only (unvetted LLM candidates, manual_review_only = true) — those are
 * excluded here, and a hit is only auto-promotable ("verified", confidence
 * above the bar) when BOTH firms are known and compatible; name-only matches
 * come back below the promotion bar so the merge routes them to review.
 */
export async function findDirectoryContact(
  pool: import("pg").Pool,
  name: string,
  firm: string | null | undefined
): Promise<AgentEnrichmentEntry | null> {
  const normalizedName = name.trim();
  if (!normalizedName) return null;
  const result = await pool.query<DirectoryRow>(
    `SELECT normalized_email, display_name, firm, phone, updated_at
     FROM broker_contacts
     WHERE LOWER(display_name) = LOWER($1)
       AND normalized_email IS NOT NULL
       AND manual_review_only = false
       AND (do_not_contact_until IS NULL OR do_not_contact_until <= now())
     ORDER BY updated_at DESC
     LIMIT 10`,
    [normalizedName]
  );
  const compatible = result.rows.find((row) => firmsCompatible(firm, row.firm));
  if (!compatible?.normalized_email) return null;
  const firmEvidenceKnown = Boolean(firm?.trim()) && Boolean(compatible.firm?.trim());
  return {
    name: compatible.display_name ?? normalizedName,
    firm: compatible.firm,
    email: compatible.normalized_email,
    phone: compatible.phone,
    source: "directory",
    confidence: firmEvidenceKnown ? 90 : 60,
    evidence: firmEvidenceKnown
      ? "Reused from the broker directory (previously verified contact for this broker at a compatible firm)."
      : "Broker directory match by name only (firm could not be cross-checked) — confirm before sending.",
    sourceUrl: null,
    needsReview: !firmEvidenceKnown,
    verificationTier: firmEvidenceKnown ? "verified" : "needs_review",
  };
}

/**
 * Record verified lookup results in the directory so future listings by the
 * same broker resolve without another web search. Ignores entries without a
 * sendable email or below the verified tier.
 */
export async function recordVerifiedContactsInDirectory(
  pool: import("pg").Pool,
  entries: AgentEnrichmentEntry[] | null | undefined
): Promise<number> {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  const repo = new BrokerContactRepo({ pool });
  let recorded = 0;
  for (const entry of entries) {
    const email = entry.email?.trim().toLowerCase();
    if (!email) continue;
    if (entry.verificationTier != null && entry.verificationTier !== "verified") continue;
    // Legacy entries without a tier: never record review-flagged contacts.
    if (entry.needsReview === true) continue;
    try {
      await repo.upsert({
        normalizedEmail: email,
        displayName: entry.name ?? null,
        firm: entry.firm ?? null,
        phone: entry.phone ?? null,
        source: entry.source ?? "llm",
        sourceMetadata: {
          evidence: entry.evidence ?? null,
          sourceUrl: entry.sourceUrl ?? null,
          confidence: entry.confidence ?? null,
        },
      });
      recorded++;
    } catch (err) {
      console.warn(
        "[brokerDirectory] upsert failed for",
        email,
        err instanceof Error ? err.message : err
      );
    }
  }
  return recorded;
}
