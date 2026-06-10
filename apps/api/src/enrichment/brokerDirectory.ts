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
     ORDER BY updated_at DESC
     LIMIT 10`,
    [normalizedName]
  );
  const compatible = result.rows.find((row) => firmsCompatible(firm, row.firm));
  if (!compatible?.normalized_email) return null;
  return {
    name: compatible.display_name ?? normalizedName,
    firm: compatible.firm,
    email: compatible.normalized_email,
    phone: compatible.phone,
    source: "directory",
    confidence: 90,
    evidence: "Reused from the broker directory (previously verified contact for this broker).",
    sourceUrl: null,
    needsReview: false,
    verificationTier: "verified",
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
