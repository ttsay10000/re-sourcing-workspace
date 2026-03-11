import OpenAI from "openai";
import type { Pool } from "pg";
import {
  deriveListingActivitySummary,
  describeListingActivity,
  type OmValidationFlag,
  type PriceHistoryEntry,
  type PropertyDetails,
  type UserProfile,
} from "@re-sourcing/contracts";
import { getPool, UserProfileRepo } from "@re-sourcing/db";
import { sendMessage } from "../inquiry/gmailClient.js";
import { getEnrichmentModel } from "../enrichment/openaiModels.js";

interface DigestPropertyRow {
  propertyId: string;
  canonicalAddress: string;
  createdAt: string;
  propertyUpdatedAt: string;
  details: PropertyDetails | null;
  listingPrice: number | null;
  listingCity: string | null;
  listingListedAt: string | null;
  listingUpdatedAt: string | null;
  listingPriceHistory: PriceHistoryEntry[] | null;
  listingExtra: Record<string, unknown> | null;
  listingLifecycleState: string | null;
  latestDealScore: number | null;
  latestEmailSentAt: string | null;
  emailsSentSince: number;
  latestAuthoritativeOmAt: string | null;
  latestDossierAt: string | null;
}

interface DigestTopDeal {
  propertyId: string;
  address: string;
  borough: string;
  dealScore: number;
  price: number | null;
  activityLine: string | null;
  takeaways: string[];
  validationFlags: string[];
}

interface DailyDigestSummary {
  since: string;
  until: string;
  newByBorough: Map<string, DigestPropertyRow[]>;
  updatedByBorough: Map<string, Array<{ row: DigestPropertyRow; flags: string[] }>>;
  emailsSent: number;
  pendingOmCount: number;
  omGeneratedCount: number;
  dossierGeneratedCount: number;
  topDeals: DigestTopDeal[];
}

export interface SendDailyDigestResult {
  sent: boolean;
  skippedReason?: string;
  summary?: {
    since: string;
    until: string;
    newProperties: number;
    updatedProperties: number;
    emailsSent: number;
    pendingOmCount: number;
    omGeneratedCount: number;
    dossierGeneratedCount: number;
    topDeals: number;
  };
}

function zonedDateTimeParts(
  now: Date,
  timezone: string
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const zoned = zonedDateTimeParts(date, timezone);
  const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  return zonedAsUtc - date.getTime();
}

function zonedLocalToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offsetMs = getTimezoneOffsetMs(utcGuess, timezone);
  return new Date(utcGuess.getTime() - offsetMs);
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeBorough(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "Unknown";
  return trimmed
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferBorough(row: DigestPropertyRow): string {
  const authoritativeBorough =
    (row.details?.omData?.authoritative?.propertyInfo as Record<string, unknown> | undefined)?.borough;
  if (typeof authoritativeBorough === "string" && authoritativeBorough.trim()) {
    return normalizeBorough(authoritativeBorough);
  }
  if (row.listingCity?.trim()) return normalizeBorough(row.listingCity);
  const fromAddress = row.canonicalAddress.split(",")[1]?.trim();
  return normalizeBorough(fromAddress);
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function parseStatusFlag(extra: Record<string, unknown> | null, lifecycleState: string | null): string | null {
  const rawStatus = extra?.status ?? extra?.listingStatus ?? extra?.sale_status ?? lifecycleState;
  if (typeof rawStatus !== "string" || !rawStatus.trim()) return null;
  const trimmed = rawStatus.trim();
  if (/contract|pending/i.test(trimmed)) return `Status updated: ${trimmed}`;
  if (/sold|closed/i.test(trimmed)) return `Status updated: ${trimmed}`;
  if (/active/i.test(trimmed)) return null;
  return `Status updated: ${trimmed}`;
}

function extractValidationMessages(details: PropertyDetails | null | undefined): string[] {
  const flags = details?.omData?.authoritative?.validationFlags;
  if (!Array.isArray(flags)) return [];
  return flags
    .map((flag) => {
      const typedFlag = flag as OmValidationFlag;
      if (typeof typedFlag.message === "string" && typedFlag.message.trim()) return typedFlag.message.trim();
      if (typeof typedFlag.field === "string" && typedFlag.field.trim()) {
        return `${typedFlag.field.trim()} remains missing in the OM extraction.`;
      }
      return null;
    })
    .filter((value): value is string => Boolean(value));
}

function buildUpdateFlags(row: DigestPropertyRow, since: Date): string[] {
  const flags: string[] = [];
  const activity = deriveListingActivitySummary({
    listedAt: row.listingListedAt,
    currentPrice: row.listingPrice,
    priceHistory: row.listingPriceHistory,
  });
  const activityLine = describeListingActivity(activity);
  const latestPriceChangeDate = activity?.latestPriceChangeDate ? new Date(`${activity.latestPriceChangeDate}T12:00:00Z`) : null;
  if (latestPriceChangeDate && latestPriceChangeDate.getTime() >= since.getTime() && activityLine) {
    flags.push(activityLine);
  } else if (row.listingUpdatedAt && new Date(row.listingUpdatedAt).getTime() >= since.getTime() && row.listingPrice != null) {
    flags.push(`Listing refreshed at ${formatCurrency(row.listingPrice)}`);
  }

  const statusFlag = parseStatusFlag(row.listingExtra, row.listingLifecycleState);
  if (statusFlag) flags.push(statusFlag);
  if (row.latestEmailSentAt) flags.push(`${row.emailsSentSince} broker email${row.emailsSentSince === 1 ? "" : "s"} sent`);
  if (row.latestAuthoritativeOmAt) flags.push("Authoritative OM ingested");
  if (row.latestDossierAt) flags.push("Deal dossier generated");
  if (flags.length === 0 && row.propertyUpdatedAt && new Date(row.propertyUpdatedAt).getTime() >= since.getTime()) {
    flags.push("Property details refreshed");
  }
  return flags;
}

function hasCurrentOm(details: PropertyDetails | null | undefined): boolean {
  return !!(details?.omData?.authoritative && typeof details.omData.authoritative === "object");
}

function buildFallbackTopDealBullets(deal: DigestTopDeal): string[] {
  const bullets: string[] = [];
  bullets.push(`Deal score ${Math.round(deal.dealScore)}/100${deal.price != null ? ` with current ask ${formatCurrency(deal.price)}` : ""}.`);
  if (deal.activityLine) bullets.push(deal.activityLine);
  if (deal.takeaways[0]) bullets.push(deal.takeaways[0]);
  else if (deal.validationFlags[0]) bullets.push(deal.validationFlags[0]);
  return bullets.slice(0, 3);
}

async function summarizeTopDealsWithLlm(topDeals: DigestTopDeal[]): Promise<Map<string, string[]>> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || topDeals.length === 0) {
    return new Map(topDeals.map((deal) => [deal.propertyId, buildFallbackTopDealBullets(deal)]));
  }

  const openai = new OpenAI({ apiKey });
  try {
    const completion = await openai.chat.completions.create({
      model: getEnrichmentModel(),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You write concise owner-facing real estate digest bullets. Return JSON only. Each property gets 2 or 3 bullets. Mention concrete numbers when available. Do not invent missing values.",
        },
        {
          role: "user",
          content: JSON.stringify({
            deals: topDeals.map((deal) => ({
              propertyId: deal.propertyId,
              address: deal.address,
              borough: deal.borough,
              dealScore: deal.dealScore,
              price: deal.price,
              listingActivity: deal.activityLine,
              takeaways: deal.takeaways,
              validationFlags: deal.validationFlags,
            })),
          }),
        },
      ],
    });
    const content = completion.choices[0]?.message?.content;
    const parsed = content ? (JSON.parse(content) as { deals?: Array<{ propertyId?: string; bullets?: string[] }> }) : null;
    const summarized = new Map<string, string[]>();
    for (const item of parsed?.deals ?? []) {
      const propertyId = typeof item.propertyId === "string" ? item.propertyId : null;
      const bullets = Array.isArray(item.bullets)
        ? item.bullets.filter((bullet): bullet is string => typeof bullet === "string" && bullet.trim().length > 0)
        : [];
      if (propertyId && bullets.length > 0) summarized.set(propertyId, bullets.slice(0, 3));
    }
    for (const deal of topDeals) {
      if (!summarized.has(deal.propertyId)) summarized.set(deal.propertyId, buildFallbackTopDealBullets(deal));
    }
    return summarized;
  } catch (err) {
    console.warn("[dailyDigest] LLM summary failed:", err instanceof Error ? err.message : err);
    return new Map(topDeals.map((deal) => [deal.propertyId, buildFallbackTopDealBullets(deal)]));
  }
}

function addToGroupedMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key) ?? [];
  existing.push(value);
  map.set(key, existing);
}

async function collectDigestRows(sinceIso: string, pool: Pool): Promise<DigestPropertyRow[]> {
  const result = await pool.query<{
    property_id: string;
    canonical_address: string;
    created_at: Date | string;
    property_updated_at: Date | string;
    details: PropertyDetails | null;
    listing_price: number | null;
    listing_city: string | null;
    listing_listed_at: Date | string | null;
    listing_updated_at: Date | string | null;
    listing_price_history: PriceHistoryEntry[] | null;
    listing_extra: Record<string, unknown> | null;
    listing_lifecycle_state: string | null;
    latest_deal_score: number | null;
    latest_email_sent_at: Date | string | null;
    emails_sent_since: string;
    latest_authoritative_om_at: Date | string | null;
    latest_dossier_at: Date | string | null;
  }>(
    `SELECT
       p.id AS property_id,
       p.canonical_address,
       p.created_at,
       p.updated_at AS property_updated_at,
       p.details,
       l.price AS listing_price,
       l.city AS listing_city,
       l.listing_listed_at,
       l.updated_at AS listing_updated_at,
       l.price_history AS listing_price_history,
       l.extra AS listing_extra,
       l.lifecycle_state AS listing_lifecycle_state,
       ds.deal_score AS latest_deal_score,
       send_stats.latest_email_sent_at,
       COALESCE(send_stats.emails_sent_since, 0)::text AS emails_sent_since,
       om_stats.latest_authoritative_om_at,
       dossier_stats.latest_dossier_at
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT l.price, l.city, l.listed_at AS listing_listed_at, l.updated_at, l.price_history, l.extra, l.lifecycle_state
       FROM listing_property_matches m
       INNER JOIN listings l ON l.id = m.listing_id
       WHERE m.property_id = p.id
       ORDER BY m.confidence DESC NULLS LAST, m.created_at DESC
       LIMIT 1
     ) l ON true
     LEFT JOIN LATERAL (
       SELECT deal_score
       FROM deal_signals
       WHERE property_id = p.id
       ORDER BY generated_at DESC
       LIMIT 1
     ) ds ON true
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) FILTER (WHERE sent_at >= $1::timestamptz) AS emails_sent_since,
         MAX(sent_at) FILTER (WHERE sent_at >= $1::timestamptz) AS latest_email_sent_at
       FROM property_inquiry_sends
       WHERE property_id = p.id
     ) send_stats ON true
     LEFT JOIN LATERAL (
       SELECT MAX(created_at) AS latest_authoritative_om_at
       FROM om_authoritative_snapshots
       WHERE property_id = p.id
         AND created_at >= $1::timestamptz
     ) om_stats ON true
     LEFT JOIN LATERAL (
       SELECT MAX(created_at) AS latest_dossier_at
       FROM documents
       WHERE property_id = p.id
         AND source = 'generated_dossier'
         AND created_at >= $1::timestamptz
     ) dossier_stats ON true
     WHERE p.created_at >= $1::timestamptz
        OR p.updated_at >= $1::timestamptz
        OR COALESCE(l.updated_at, 'epoch'::timestamptz) >= $1::timestamptz
        OR send_stats.latest_email_sent_at IS NOT NULL
        OR om_stats.latest_authoritative_om_at IS NOT NULL
        OR dossier_stats.latest_dossier_at IS NOT NULL
     ORDER BY p.updated_at DESC, p.created_at DESC`,
    [sinceIso]
  );

  return result.rows.map((row) => ({
    propertyId: row.property_id,
    canonicalAddress: row.canonical_address,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    propertyUpdatedAt: toIso(row.property_updated_at) ?? new Date().toISOString(),
    details: row.details ?? null,
    listingPrice: row.listing_price != null ? Number(row.listing_price) : null,
    listingCity: row.listing_city ?? null,
    listingListedAt: toIso(row.listing_listed_at),
    listingUpdatedAt: toIso(row.listing_updated_at),
    listingPriceHistory: row.listing_price_history ?? null,
    listingExtra: row.listing_extra ?? null,
    listingLifecycleState: row.listing_lifecycle_state ?? null,
    latestDealScore: row.latest_deal_score != null ? Number(row.latest_deal_score) : null,
    latestEmailSentAt: toIso(row.latest_email_sent_at),
    emailsSentSince: Number(row.emails_sent_since ?? 0),
    latestAuthoritativeOmAt: toIso(row.latest_authoritative_om_at),
    latestDossierAt: toIso(row.latest_dossier_at),
  }));
}

async function buildDailyDigestSummary(since: Date, until: Date, pool: Pool): Promise<DailyDigestSummary> {
  const rows = await collectDigestRows(since.toISOString(), pool);
  const newByBorough = new Map<string, DigestPropertyRow[]>();
  const updatedByBorough = new Map<string, Array<{ row: DigestPropertyRow; flags: string[] }>>();
  let emailsSent = 0;
  let pendingOmCount = 0;
  let omGeneratedCount = 0;
  let dossierGeneratedCount = 0;

  for (const row of rows) {
    const borough = inferBorough(row);
    const isNew = new Date(row.createdAt).getTime() >= since.getTime();
    if (isNew) {
      addToGroupedMap(newByBorough, borough, row);
    } else {
      const flags = buildUpdateFlags(row, since).slice(0, 4);
      if (flags.length > 0) addToGroupedMap(updatedByBorough, borough, { row, flags });
    }

    emailsSent += row.emailsSentSince;
    if (row.latestAuthoritativeOmAt) omGeneratedCount += 1;
    if (row.latestDossierAt) dossierGeneratedCount += 1;
    if (row.emailsSentSince > 0 && !hasCurrentOm(row.details)) pendingOmCount += 1;
  }

  const topDealsBase = rows
    .filter((row) => row.latestDealScore != null)
    .sort((left, right) => (right.latestDealScore ?? 0) - (left.latestDealScore ?? 0))
    .slice(0, 5)
    .map< DigestTopDeal >((row) => ({
      propertyId: row.propertyId,
      address: row.canonicalAddress,
      borough: inferBorough(row),
      dealScore: row.latestDealScore ?? 0,
      price: row.listingPrice,
      activityLine: describeListingActivity(
        deriveListingActivitySummary({
          listedAt: row.listingListedAt,
          currentPrice: row.listingPrice,
          priceHistory: row.listingPriceHistory,
        })
      ),
      takeaways:
        Array.isArray((row.details?.omData?.authoritative as Record<string, unknown> | undefined)?.investmentTakeaways)
          ? (((row.details?.omData?.authoritative as Record<string, unknown> | undefined)?.investmentTakeaways as string[]) ?? [])
          : [],
      validationFlags: extractValidationMessages(row.details),
    }));
  const summarizedTopDeals = await summarizeTopDealsWithLlm(topDealsBase);
  const topDeals = topDealsBase.map((deal) => ({
    ...deal,
    takeaways: summarizedTopDeals.get(deal.propertyId) ?? buildFallbackTopDealBullets(deal),
  }));

  return {
    since: since.toISOString(),
    until: until.toISOString(),
    newByBorough,
    updatedByBorough,
    emailsSent,
    pendingOmCount,
    omGeneratedCount,
    dossierGeneratedCount,
    topDeals,
  };
}

function hasDigestUpdates(summary: DailyDigestSummary): boolean {
  return (
    summary.newByBorough.size > 0 ||
    summary.updatedByBorough.size > 0 ||
    summary.emailsSent > 0 ||
    summary.omGeneratedCount > 0 ||
    summary.dossierGeneratedCount > 0
  );
}

function renderDigestEmail(summary: DailyDigestSummary): string {
  const lines: string[] = [];
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(summary.until));
  lines.push(`Daily sourcing report for ${dateLabel}`);
  lines.push("");

  if (summary.newByBorough.size > 0) {
    lines.push("New properties added by borough");
    for (const [borough, rows] of summary.newByBorough) {
      lines.push(`- ${borough}: ${rows.length}`);
    }
    lines.push("");
  }

  if (summary.updatedByBorough.size > 0) {
    lines.push("Updated properties by borough");
    for (const [borough, rows] of summary.updatedByBorough) {
      lines.push(`- ${borough}: ${rows.length}`);
      for (const entry of rows.slice(0, 8)) {
        lines.push(`  ${entry.row.canonicalAddress}`);
        for (const flag of entry.flags) lines.push(`    • ${flag}`);
      }
    }
    lines.push("");
  }

  lines.push("Broker outreach and OM pipeline");
  lines.push(`- New emails sent: ${summary.emailsSent}`);
  lines.push(`- Pending OM after outreach: ${summary.pendingOmCount}`);
  lines.push(`- Authoritative OMs generated: ${summary.omGeneratedCount}`);
  lines.push(`- Deal dossiers generated: ${summary.dossierGeneratedCount}`);
  lines.push("");

  if (summary.topDeals.length > 0) {
    lines.push("Top deals");
    for (const deal of summary.topDeals) {
      lines.push(`- ${deal.address} (${deal.borough}) — score ${Math.round(deal.dealScore)}/100${deal.price != null ? `, ask ${formatCurrency(deal.price)}` : ""}`);
      for (const bullet of deal.takeaways.slice(0, 3)) {
        lines.push(`  • ${bullet}`);
      }
    }
  }

  return lines.join("\n").trim();
}

function parseDigestSchedule(profile: UserProfile, now: Date): { due: boolean; since: Date; until: Date } {
  const timezone = profile.dailyDigestTimezone?.trim() || "America/New_York";
  const [hoursRaw = "18", minutesRaw = "00"] = (profile.dailyDigestTimeLocal?.trim() || "18:00").split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  const local = zonedDateTimeParts(now, timezone);
  const scheduledToday = zonedLocalToUtc(local.year, local.month, local.day, hours, minutes, timezone);
  const lastSentAt = profile.lastDailyDigestSentAt ? new Date(profile.lastDailyDigestSentAt) : null;
  const due = now.getTime() >= scheduledToday.getTime() && (!lastSentAt || lastSentAt.getTime() < scheduledToday.getTime());
  const since = lastSentAt && !Number.isNaN(lastSentAt.getTime())
    ? lastSentAt
    : new Date(scheduledToday.getTime() - 24 * 60 * 60 * 1000);
  return { due, since, until: now };
}

export async function sendDailyDigest(pool: Pool = getPool()): Promise<SendDailyDigestResult> {
  const profileRepo = new UserProfileRepo({ pool });
  await profileRepo.ensureDefault();
  const profile = await profileRepo.getDefault();
  if (!profile) return { sent: false, skippedReason: "profile_missing" };
  if (profile.dailyDigestEnabled === false) return { sent: false, skippedReason: "digest_disabled" };
  if (!profile.email?.trim()) return { sent: false, skippedReason: "profile_email_missing" };

  const schedule = parseDigestSchedule(profile, new Date());
  if (!schedule.due) return { sent: false, skippedReason: "not_due" };

  const summary = await buildDailyDigestSummary(schedule.since, schedule.until, pool);
  if (!hasDigestUpdates(summary)) {
    return { sent: false, skippedReason: "no_updates" };
  }

  const subject = `Daily sourcing report - ${new Date(summary.until).toISOString().slice(0, 10)}`;
  await sendMessage(profile.email.trim(), subject, renderDigestEmail(summary));
  await profileRepo.update(profile.id, {
    lastDailyDigestSentAt: schedule.until.toISOString(),
  });

  const newProperties = [...summary.newByBorough.values()].reduce((sum, rows) => sum + rows.length, 0);
  const updatedProperties = [...summary.updatedByBorough.values()].reduce((sum, rows) => sum + rows.length, 0);
  return {
    sent: true,
    summary: {
      since: summary.since,
      until: summary.until,
      newProperties,
      updatedProperties,
      emailsSent: summary.emailsSent,
      pendingOmCount: summary.pendingOmCount,
      omGeneratedCount: summary.omGeneratedCount,
      dossierGeneratedCount: summary.dossierGeneratedCount,
      topDeals: summary.topDeals.length,
    },
  };
}
