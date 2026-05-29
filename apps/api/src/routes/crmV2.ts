import { randomUUID } from "crypto";
import { Router, type Request, type Response } from "express";
import type {
  AgentEnrichmentEntry,
  BrokerContact,
  ListingRow,
  Property,
  RecipientContactCandidate,
  RecipientResolution,
  UiV2BrokerBlock,
  UiV2OutreachDraftPayload,
  UiV2OutreachFollowUpActionPayload,
} from "@re-sourcing/contracts";
import {
  BrokerContactRepo,
  getPool,
  mapBrokerContact,
  OutreachBatchRepo,
  PropertyActionItemRepo,
  PropertyRepo,
} from "@re-sourcing/db";
import {
  getPrimaryListingForProperty,
  overwriteManualBrokerResolution,
  syncRecipientResolution,
} from "../sourcing/workflow.js";

const router = Router();

type JsonRecord = Record<string, unknown>;

interface BrokerCandidate extends Omit<RecipientContactCandidate, "email"> {
  email?: string | null;
  phone?: string | null;
  source?: "manual" | "resolution" | "listing" | string | null;
}

interface PropertyBrokerPayload {
  broker: UiV2BrokerBlock | null;
  candidates: BrokerCandidate[];
  resolution: RecipientResolution | null;
  contact: BrokerContact | null;
  listingAgents: AgentEnrichmentEntry[];
  manualOverride: JsonRecord | null;
  openActionItemCount: number;
  lastActivityAt: string | null;
}

class RouteError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "RouteError";
  }
}

function sendRouteError(res: Response, label: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[crm-v2 ${label}]`, err);
  if (err instanceof RouteError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(503).json({ error: "CRM v2 request failed.", details: message });
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value: unknown): string | null {
  const email = cleanString(value)?.toLowerCase() ?? null;
  if (!email || !email.includes("@")) return null;
  return email;
}

function parseLimit(value: unknown, fallback = 50): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

function parseOffset(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(Math.trunc(parsed), 0);
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readManualOverride(property: Property | null): JsonRecord | null {
  const value = property?.details?.brokerManualOverride;
  return isJsonRecord(value) ? value : null;
}

function readManualPhone(contact: BrokerContact | null, manualOverride: JsonRecord | null): string | null {
  const fromProperty = cleanString(manualOverride?.phone);
  if (fromProperty) return fromProperty;
  const manual = contact?.activitySummary?.manualBrokerOverride;
  if (!isJsonRecord(manual)) return null;
  return cleanString(manual.phone);
}

function hasBrokerIdentity(candidate: {
  email?: string | null;
  name?: string | null;
  firm?: string | null;
  phone?: string | null;
}): boolean {
  return Boolean(
    normalizeEmail(candidate.email) ??
      cleanString(candidate.name) ??
      cleanString(candidate.firm) ??
      cleanString(candidate.phone)
  );
}

function agentToCandidate(agent: AgentEnrichmentEntry): BrokerCandidate | null {
  const email = normalizeEmail(agent.email);
  const candidate = {
    email,
    name: cleanString(agent.name),
    firm: cleanString(agent.firm),
    phone: cleanString(agent.phone),
    source: "listing",
  } satisfies BrokerCandidate;
  if (!hasBrokerIdentity(candidate)) return null;
  return candidate;
}

function candidateIdentityKey(candidate: BrokerCandidate): string | null {
  const email = normalizeEmail(candidate.email);
  if (email) return `email:${email}`;
  const contactId = cleanString(candidate.contactId);
  if (contactId) return `contact:${contactId}`;
  const parts = [candidate.name, candidate.firm, candidate.phone]
    .map((part) => cleanString(part)?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean);
  return parts.length > 0 ? `identity:${parts.join(":")}` : null;
}

function mergeCandidate(existing: BrokerCandidate | undefined, candidate: BrokerCandidate): BrokerCandidate {
  return {
    email: existing?.email ?? candidate.email ?? null,
    name: existing?.name ?? candidate.name ?? null,
    firm: existing?.firm ?? candidate.firm ?? null,
    phone: existing?.phone ?? candidate.phone ?? null,
    contactId: existing?.contactId ?? candidate.contactId ?? null,
    source: existing?.source ?? candidate.source ?? null,
  };
}

function dedupeCandidates(candidates: Array<BrokerCandidate | null | undefined>): BrokerCandidate[] {
  const byKey = new Map<string, BrokerCandidate>();
  for (const candidate of candidates) {
    if (!candidate || !hasBrokerIdentity(candidate)) continue;
    const key = candidateIdentityKey(candidate);
    if (!key) continue;
    byKey.set(key, mergeCandidate(byKey.get(key), candidate));
  }
  return [...byKey.values()];
}

function buildManualCandidate(manualOverride: JsonRecord | null): BrokerCandidate | null {
  const email = normalizeEmail(manualOverride?.email);
  const candidate = {
    email,
    name: cleanString(manualOverride?.name),
    firm: cleanString(manualOverride?.firm),
    phone: cleanString(manualOverride?.phone),
    contactId: cleanString(manualOverride?.contactId),
    source: "manual",
  } satisfies BrokerCandidate;
  return hasBrokerIdentity(candidate) ? candidate : null;
}

function findCandidate(candidates: BrokerCandidate[], email: string | null | undefined): BrokerCandidate | null {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return candidates.find((candidate) => normalizeEmail(candidate.email) === normalized) ?? null;
}

function buildBrokerBlock(params: {
  contact: BrokerContact | null;
  resolution: RecipientResolution | null;
  property: Property;
  listing: ListingRow | null;
  candidates: BrokerCandidate[];
  openActionItemCount: number;
  lastActivityAt: string | null;
}): UiV2BrokerBlock | null {
  const manualOverride = readManualOverride(params.property);
  const resolvedEmail = normalizeEmail(manualOverride?.email) ?? normalizeEmail(params.resolution?.contactEmail);
  const matchedCandidate = findCandidate(params.candidates, resolvedEmail);
  const firstCandidate = params.candidates[0] ?? null;
  const source =
    manualOverride != null
      ? "overwrite"
      : params.resolution?.status === "manual_override"
        ? "manual"
        : params.listing?.agentEnrichment?.length
          ? "llm"
          : "sourced";
  const email = resolvedEmail ?? normalizeEmail(params.contact?.normalizedEmail) ?? firstCandidate?.email ?? null;
  if (!email && !params.contact && !matchedCandidate && !firstCandidate) return null;
  return {
    contactId:
      cleanString(manualOverride?.contactId) ??
      params.resolution?.contactId ??
      params.contact?.id ??
      matchedCandidate?.contactId ??
      null,
    name:
      cleanString(manualOverride?.name) ??
      params.contact?.displayName ??
      matchedCandidate?.name ??
      firstCandidate?.name ??
      null,
    email,
    phone: readManualPhone(params.contact, manualOverride) ?? matchedCandidate?.phone ?? firstCandidate?.phone ?? null,
    firm:
      cleanString(manualOverride?.firm) ??
      params.contact?.firm ??
      matchedCandidate?.firm ??
      firstCandidate?.firm ??
      null,
    source,
    overwrittenAt: cleanString(manualOverride?.overwrittenAt),
    overwrittenBy: cleanString(manualOverride?.overwrittenBy),
  };
}

async function loadContactForResolution(
  resolution: RecipientResolution | null,
  contactRepo: BrokerContactRepo
): Promise<BrokerContact | null> {
  if (resolution?.contactId) {
    const byId = await contactRepo.byId(resolution.contactId);
    if (byId) return byId;
  }
  if (resolution?.contactEmail) {
    return contactRepo.byEmail(resolution.contactEmail);
  }
  return null;
}

async function getPropertyLastActivityAt(
  pool: import("pg").Pool,
  propertyId: string,
  contact: BrokerContact | null
): Promise<string | null> {
  const r = await pool.query<{ last_activity_at: Date | string | null }>(
    `SELECT NULLIF(
       GREATEST(
         COALESCE(MAX(s.sent_at), '-infinity'::timestamptz),
         COALESCE(MAX(e.received_at), '-infinity'::timestamptz),
         COALESCE($2::timestamptz, '-infinity'::timestamptz),
         COALESCE($3::timestamptz, '-infinity'::timestamptz)
       ),
       '-infinity'::timestamptz
     ) AS last_activity_at
     FROM properties p
     LEFT JOIN property_inquiry_sends s ON s.property_id = p.id
     LEFT JOIN property_inquiry_email_properties link ON link.property_id = p.id
     LEFT JOIN property_inquiry_emails e ON e.id = link.inquiry_email_id
     WHERE p.id = $1`,
    [propertyId, contact?.lastOutreachAt ?? null, contact?.lastReplyAt ?? null]
  );
  return toIso(r.rows[0]?.last_activity_at);
}

async function loadPropertyBrokerPayload(propertyId: string): Promise<PropertyBrokerPayload> {
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const contactRepo = new BrokerContactRepo({ pool });
  const actionRepo = new PropertyActionItemRepo({ pool });
  const property = await propertyRepo.byId(propertyId);
  if (!property) throw new RouteError(404, "Property not found.");

  const [resolution, listing, openActionCounts] = await Promise.all([
    syncRecipientResolution(propertyId, pool),
    getPrimaryListingForProperty(propertyId, pool),
    actionRepo.countsByPropertyIds([propertyId]),
  ]);
  const contact = await loadContactForResolution(resolution, contactRepo);
  const manualOverride = readManualOverride(property);
  const listingAgents = Array.isArray(listing?.agentEnrichment) ? listing.agentEnrichment : [];
  const candidates = dedupeCandidates([
    buildManualCandidate(manualOverride),
    ...resolution.candidateContacts.map((candidate) => ({
      ...candidate,
      source: resolution.status === "manual_override" ? "manual" : "resolution",
    })),
    ...listingAgents.map(agentToCandidate),
  ]);
  const lastActivityAt = await getPropertyLastActivityAt(pool, propertyId, contact);
  return {
    broker: buildBrokerBlock({
      contact,
      resolution,
      property,
      listing,
      candidates,
      openActionItemCount: openActionCounts[propertyId] ?? 0,
      lastActivityAt,
    }),
    candidates,
    resolution,
    contact,
    listingAgents,
    manualOverride,
    openActionItemCount: openActionCounts[propertyId] ?? 0,
    lastActivityAt,
  };
}

function buildOutreachDraftText(params: {
  canonicalAddress: string;
  brokerName?: string | null;
  brokerEmail?: string | null;
}): Pick<UiV2OutreachDraftPayload, "toAddress" | "subject" | "body"> {
  const addressLine = params.canonicalAddress.split(",")[0]?.trim() || params.canonicalAddress;
  const firstName = params.brokerName?.trim().split(/\s+/)[0] ?? null;
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  return {
    toAddress: params.brokerEmail ?? "",
    subject: `Inquiry about ${addressLine}`,
    body: `${greeting}

My name is Tyler Tsay, and I'm reaching out on behalf of a client regarding the property at ${addressLine}. We are evaluating the building and would appreciate the opportunity to review further.

Would you be able to share the OM, T-12, current rent roll, expenses, and/or any available financials?

Thanks in advance - looking forward to taking a look.

Best,
Tyler Tsay
617 306 3336
tyler@stayhaus.co`,
  };
}

router.get("/ui-v2/crm", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const limit = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const q = cleanString(req.query.q);
    const filterValues: unknown[] = [];
    let where = "";
    if (q) {
      filterValues.push(`%${q.toLowerCase()}%`);
      where = `WHERE (
        COALESCE(bc.normalized_email, '') LIKE $1
        OR COALESCE(bc.source_key, '') LIKE $1
        OR LOWER(COALESCE(bc.display_name, '')) LIKE $1
        OR LOWER(COALESCE(bc.firm, '')) LIKE $1
        OR LOWER(COALESCE(bc.phone, '')) LIKE $1
        OR LOWER(COALESCE(bc.notes, '')) LIKE $1
      )`;
    }
    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM broker_contacts bc ${where}`,
      filterValues
    );
    const values = [...filterValues, limit, offset];
    const limitIndex = values.length - 1;
    const offsetIndex = values.length;
    const result = await pool.query(
      `WITH filtered_contacts AS (
         SELECT bc.*, COUNT(*) OVER() AS total_count
         FROM broker_contacts bc
         ${where}
       )
       SELECT
         fc.*,
         COALESCE(rel.related_property_ids, ARRAY[]::text[]) AS related_property_ids,
         COALESCE(rel.open_action_item_count, 0)::int AS open_action_item_count,
         NULLIF(
           GREATEST(
             COALESCE(fc.last_outreach_at, '-infinity'::timestamptz),
             COALESCE(fc.last_reply_at, '-infinity'::timestamptz),
             COALESCE(rel.last_resolution_at, '-infinity'::timestamptz),
             COALESCE(rel.last_action_at, '-infinity'::timestamptz),
             COALESCE(fc.updated_at, '-infinity'::timestamptz)
           ),
           '-infinity'::timestamptz
         ) AS last_activity_at
       FROM filtered_contacts fc
       LEFT JOIN LATERAL (
         SELECT
           ARRAY_AGG(DISTINCT rr.property_id::text) FILTER (WHERE rr.property_id IS NOT NULL) AS related_property_ids,
           COUNT(DISTINCT ai.id) AS open_action_item_count,
           MAX(rr.updated_at) AS last_resolution_at,
           MAX(ai.created_at) AS last_action_at
         FROM property_recipient_resolution rr
         LEFT JOIN property_action_items ai ON ai.property_id = rr.property_id AND ai.status = 'open'
         WHERE rr.contact_id = fc.id
            OR (fc.normalized_email IS NOT NULL AND LOWER(COALESCE(rr.contact_email, '')) = fc.normalized_email)
            OR fc.source_metadata->>'propertyId' = rr.property_id::text
            OR COALESCE(fc.activity_summary->'relatedPropertyIds', '[]'::jsonb) ? rr.property_id::text
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(rr.candidate_contacts, '[]'::jsonb)) AS candidate
              WHERE fc.normalized_email IS NOT NULL
                AND LOWER(COALESCE(candidate->>'email', '')) = fc.normalized_email
            )
       ) rel ON true
       ORDER BY last_activity_at DESC NULLS LAST, fc.updated_at DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      values
    );
    const contacts = result.rows.map((row) => {
      const contact = mapBrokerContact(row);
      return {
        contact,
        phone: readManualPhone(contact, null),
        relatedPropertyIds: Array.isArray(row.related_property_ids) ? row.related_property_ids : [],
        openActionItemCount: Number(row.open_action_item_count ?? 0),
        lastActivityAt: toIso(row.last_activity_at),
      };
    });
    const total = Number(countResult.rows[0]?.total ?? 0);
    res.json({ crm: { contacts, total, limit, offset } });
  } catch (err) {
    sendRouteError(res, "crm-list", err);
  }
});

router.get("/ui-v2/properties/:id/broker", async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    if (!propertyId) throw new RouteError(400, "Property id is required.");
    res.json(await loadPropertyBrokerPayload(propertyId));
  } catch (err) {
    sendRouteError(res, "property-broker", err);
  }
});

router.put("/ui-v2/properties/:id/broker", async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    if (!propertyId) throw new RouteError(400, "Property id is required.");
    const body = (req.body ?? {}) as JsonRecord;
    const email = normalizeEmail(body.email);
    const name = cleanString(body.name);
    const firm = cleanString(body.firm);
    const phone = cleanString(body.phone);
    if (!email && !name && !firm && !phone) {
      throw new RouteError(400, "Broker name, firm, phone, or email is required.");
    }
    await overwriteManualBrokerResolution(propertyId, {
      email,
      name,
      firm,
      phone,
      notes: cleanString(body.notes),
      actorName: cleanString(body.actorName) ?? "ui-v2",
    });
    res.json(await loadPropertyBrokerPayload(propertyId));
  } catch (err) {
    sendRouteError(res, "property-broker-overwrite", err);
  }
});

router.get("/ui-v2/properties/:id/outreach-composer", async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    if (!propertyId) throw new RouteError(400, "Property id is required.");
    const pool = getPool();
    const property = await new PropertyRepo({ pool }).byId(propertyId);
    if (!property) throw new RouteError(404, "Property not found.");
    const brokerPayload = await loadPropertyBrokerPayload(propertyId);
    const draft = buildOutreachDraftText({
      canonicalAddress: property.canonicalAddress,
      brokerName: brokerPayload.broker?.name,
      brokerEmail: brokerPayload.broker?.email,
    });
    const warnings: string[] = [];
    if (!brokerPayload.broker?.email) warnings.push("Broker email is missing.");
    if (brokerPayload.contact?.manualReviewOnly) warnings.push("Broker is marked manual-review only.");
    if (brokerPayload.contact?.doNotContactUntil) warnings.push("Broker has a do-not-contact date.");
    const suggestedRecipients = brokerPayload.contact
      ? [
          {
            contact: brokerPayload.contact,
            relatedPropertyIds: [propertyId],
            openActionItemCount: brokerPayload.openActionItemCount,
            lastActivityAt: brokerPayload.lastActivityAt,
          },
        ]
      : [];
    res.json({
      composer: {
        propertyId,
        broker: brokerPayload.broker,
        suggestedRecipients,
        subject: draft.subject,
        body: draft.body,
        warnings,
      },
    });
  } catch (err) {
    sendRouteError(res, "outreach-composer", err);
  }
});

router.post("/ui-v2/outreach-drafts", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as JsonRecord;
    const propertyId = cleanString(body.propertyId);
    const toAddress = normalizeEmail(body.toAddress);
    const subject = cleanString(body.subject);
    const draftBody = cleanString(body.body);
    if (!propertyId) throw new RouteError(400, "propertyId is required.");
    if (!toAddress) throw new RouteError(400, "A valid toAddress is required.");
    if (!subject) throw new RouteError(400, "subject is required.");
    if (!draftBody) throw new RouteError(400, "body is required.");
    const pool = getPool();
    const contactId = cleanString(body.contactId);
    const followUpAt = cleanString(body.followUpAt);
    const batch = await new OutreachBatchRepo({ pool }).create({
      contactId,
      toAddress,
      status: "review_required",
      createdBy: "ui-v2",
      reviewReason: "Draft saved from CRM composer",
      metadata: {
        kind: "ui_v2_outreach_draft",
        subject,
        body: draftBody,
        draftStatus: "draft",
        followUpAt,
      },
      propertyIds: [propertyId],
    });
    const draft: UiV2OutreachDraftPayload = {
      id: batch.id,
      propertyId,
      contactId,
      toAddress,
      subject,
      body: draftBody,
      status: "draft",
      followUpAt,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    };
    res.status(201).json({ draft });
  } catch (err) {
    sendRouteError(res, "outreach-draft-create", err);
  }
});

router.post("/ui-v2/outreach-follow-ups", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as JsonRecord;
    const propertyId = cleanString(body.propertyId);
    const action = cleanString(body.action);
    if (!propertyId) throw new RouteError(400, "propertyId is required.");
    if (!action) throw new RouteError(400, "action is required.");
    const pool = getPool();
    const actionRepo = new PropertyActionItemRepo({ pool });
    let followUp: UiV2OutreachFollowUpActionPayload;
    if (action === "schedule") {
      const followUpAt = cleanString(body.followUpAt);
      if (!followUpAt) throw new RouteError(400, "followUpAt is required when scheduling a follow-up.");
      const actionItem = await actionRepo.upsertOpen(propertyId, "confirm_follow_up", {
        priority: "medium",
        summary: "Follow up with broker",
        details: {
          contactId: cleanString(body.contactId),
          draftId: cleanString(body.draftId),
          note: cleanString(body.note),
          source: "ui-v2",
        },
        dueAt: followUpAt,
      });
      followUp = { actionItem, draft: null, status: "scheduled" };
    } else if (action === "cancel" || action === "mark_complete") {
      await actionRepo.resolve(propertyId, "confirm_follow_up");
      followUp = { actionItem: null, draft: null, status: "resolved" };
    } else if (action === "send_now") {
      followUp = {
        actionItem: null,
        draft: {
          id: cleanString(body.draftId) ?? randomUUID(),
          propertyId,
          contactId: cleanString(body.contactId),
          toAddress: normalizeEmail(body.toAddress) ?? "",
          subject: cleanString(body.subject) ?? "",
          body: cleanString(body.body) ?? "",
          status: "ready_for_review",
          followUpAt: cleanString(body.followUpAt),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        status: "ready_for_review",
      };
    } else {
      throw new RouteError(400, "Unsupported follow-up action.");
    }
    res.json({ followUp });
  } catch (err) {
    sendRouteError(res, "outreach-follow-up", err);
  }
});

export default router;
