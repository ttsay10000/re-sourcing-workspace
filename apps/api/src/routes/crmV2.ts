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
  UiV2OutreachSendNowPayload,
  UiV2OutreachTemplatePayload,
} from "@re-sourcing/contracts";
import {
  BrokerContactRepo,
  getPool,
  InquirySendRepo,
  mapBrokerContact,
  OutreachBatchRepo,
  PropertyActionItemRepo,
  PropertyPipelineEventRepo,
  PropertyRepo,
} from "@re-sourcing/db";
import {
  getPrimaryListingForProperty,
  overwriteManualBrokerResolution,
  syncPropertySourcingWorkflow,
  syncRecipientResolution,
} from "../sourcing/workflow.js";
import { sendMessage as gmailSendMessage } from "../inquiry/gmailClient.js";

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

function normalizeTag(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, "_") : "";
}

async function markOmRequestedFromOutreach(
  pool: ReturnType<typeof getPool>,
  propertyId: string,
  actor: string,
  source: string
): Promise<void> {
  const propertyRepo = new PropertyRepo({ pool });
  const property = await propertyRepo.byId(propertyId);
  if (!property) return;
  const details = property.details && typeof property.details === "object" && !Array.isArray(property.details)
    ? (property.details as JsonRecord)
    : {};
  const existingPipeline =
    details.pipeline && typeof details.pipeline === "object" && !Array.isArray(details.pipeline)
      ? (details.pipeline as JsonRecord)
      : {};
  const currentUiStatus = normalizeTag(existingPipeline.uiV2Status);
  if (["rejected", "archived", "om_received", "dossier_generated", "offer_review", "underwriting"].includes(currentUiStatus)) {
    return;
  }
  const now = new Date().toISOString();
  await propertyRepo.mergeDetails(propertyId, {
    pipeline: {
      ...existingPipeline,
      status: "om_requested",
      uiV2Status: "outreach",
      lastActivityAt: now,
    },
  });
  await new PropertyPipelineEventRepo({ pool }).create({
    propertyId,
    eventType: "status_changed",
    actor,
    source,
    title: "Status changed to Outreach",
    metadata: {
      status: "outreach",
      previousStatus: currentUiStatus || null,
      trigger: "broker_outreach",
    },
  });
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

function requiredString(value: unknown, fieldName: string): string {
  const cleaned = cleanString(value);
  if (!cleaned) throw new RouteError(400, `${fieldName} is required.`);
  return cleaned;
}

function mapOutreachTemplate(row: Record<string, unknown>): UiV2OutreachTemplatePayload {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    subject: String(row.subject ?? ""),
    body: String(row.body ?? ""),
    createdBy: cleanString(row.created_by),
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
  };
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

Would you be able to share the OM, T-12/operating statement, current rent roll, and expense detail? If available, we would also appreciate any broker comp package or market analysis, sale/rent comps, NOI/cap-rate support, and whisper pricing color.

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
    const values: unknown[] = [];
    let qIndex: number | null = null;
    if (q) {
      values.push(`%${q.toLowerCase()}%`);
      qIndex = values.length;
    }
    values.push(limit, offset);
    const limitIndex = values.length - 1;
    const offsetIndex = values.length;
    const result = await pool.query(
      `WITH contact_rows AS (
         SELECT
           bc.*,
           COALESCE(rel.related_property_ids, ARRAY[]::text[]) AS related_property_ids,
           COALESCE(rel.related_properties, '[]'::jsonb) AS related_properties,
           COALESCE(rel.open_action_item_count, 0)::int AS open_action_item_count,
           rel.last_resolution_at,
           rel.last_action_at
         FROM broker_contacts bc
         LEFT JOIN LATERAL (
           WITH related AS (
             SELECT DISTINCT
               rr.property_id,
               p.canonical_address,
               NULLIF(split_part(p.canonical_address, ',', 1), '') AS display_address,
               rr.updated_at
             FROM property_recipient_resolution rr
             INNER JOIN properties p ON p.id = rr.property_id
             WHERE rr.contact_id = bc.id
                OR (bc.normalized_email IS NOT NULL AND LOWER(COALESCE(rr.contact_email, '')) = bc.normalized_email)
                OR bc.source_metadata->>'propertyId' = rr.property_id::text
                OR bc.source_key LIKE ('property:' || rr.property_id::text || ':%')
                OR COALESCE(bc.activity_summary->'relatedPropertyIds', '[]'::jsonb) ? rr.property_id::text
                OR EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(COALESCE(rr.candidate_contacts, '[]'::jsonb)) AS candidate
                  WHERE (
                    bc.normalized_email IS NOT NULL
                    AND LOWER(COALESCE(candidate->>'email', '')) = bc.normalized_email
                  ) OR (
                    bc.normalized_email IS NULL
                    AND LOWER(COALESCE(candidate->>'name', '')) = LOWER(COALESCE(bc.display_name, ''))
                    AND LOWER(COALESCE(candidate->>'firm', '')) = LOWER(COALESCE(bc.firm, ''))
                    AND COALESCE(bc.display_name, bc.firm) IS NOT NULL
                  )
                )
           )
           SELECT
             COALESCE(
               (SELECT ARRAY_AGG(r.property_id::text ORDER BY COALESCE(r.display_address, r.canonical_address)) FROM related r),
               ARRAY[]::text[]
             ) AS related_property_ids,
             COALESCE(
               (
                 SELECT jsonb_agg(
                   jsonb_build_object(
                     'propertyId', r.property_id::text,
                     'canonicalAddress', r.canonical_address,
                     'displayAddress', COALESCE(r.display_address, r.canonical_address)
                   )
                   ORDER BY COALESCE(r.display_address, r.canonical_address)
                 )
                 FROM related r
               ),
               '[]'::jsonb
             ) AS related_properties,
             COALESCE(
               (
                 SELECT COUNT(DISTINCT ai.id)
                 FROM related r
                 INNER JOIN property_action_items ai ON ai.property_id = r.property_id AND ai.status = 'open'
               ),
               0
             ) AS open_action_item_count,
             (SELECT MAX(r.updated_at) FROM related r) AS last_resolution_at,
             (
               SELECT MAX(ai.created_at)
               FROM related r
               INNER JOIN property_action_items ai ON ai.property_id = r.property_id AND ai.status = 'open'
             ) AS last_action_at
         ) rel ON true
       ),
       filtered_contacts AS (
         SELECT
           cr.*,
           NULLIF(
             GREATEST(
               COALESCE(cr.last_outreach_at, '-infinity'::timestamptz),
               COALESCE(cr.last_reply_at, '-infinity'::timestamptz),
               COALESCE(cr.last_resolution_at, '-infinity'::timestamptz),
               COALESCE(cr.last_action_at, '-infinity'::timestamptz),
               COALESCE(cr.updated_at, '-infinity'::timestamptz)
             ),
             '-infinity'::timestamptz
           ) AS last_activity_at
         FROM contact_rows cr
         WHERE cardinality(cr.related_property_ids) > 0
         ${
           qIndex
             ? `AND (
                 COALESCE(cr.normalized_email, '') LIKE $${qIndex}
                 OR COALESCE(cr.source_key, '') LIKE $${qIndex}
                 OR LOWER(COALESCE(cr.display_name, '')) LIKE $${qIndex}
                 OR LOWER(COALESCE(cr.firm, '')) LIKE $${qIndex}
                 OR LOWER(COALESCE(cr.phone, '')) LIKE $${qIndex}
                 OR LOWER(COALESCE(cr.notes, '')) LIKE $${qIndex}
                 OR EXISTS (
                   SELECT 1
                   FROM jsonb_array_elements(cr.related_properties) AS property
                   WHERE LOWER(COALESCE(property->>'displayAddress', '')) LIKE $${qIndex}
                      OR LOWER(COALESCE(property->>'canonicalAddress', '')) LIKE $${qIndex}
                 )
               )`
             : ""
         }
       )
       SELECT fc.*, COUNT(*) OVER() AS total_count
       FROM filtered_contacts fc
       ORDER BY fc.last_activity_at DESC NULLS LAST, fc.updated_at DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      values
    );
    const contacts = result.rows.map((row) => {
      const contact = mapBrokerContact(row);
      const relatedProperties = Array.isArray(row.related_properties) ? row.related_properties : [];
      return {
        contact,
        phone: readManualPhone(contact, null),
        relatedPropertyIds: Array.isArray(row.related_property_ids) ? row.related_property_ids : [],
        relatedProperties,
        openActionItemCount: Number(row.open_action_item_count ?? 0),
        lastActivityAt: toIso(row.last_activity_at),
      };
    });
    const total = Number(result.rows[0]?.total_count ?? 0);
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

router.get("/ui-v2/outreach-templates", async (_req: Request, res: Response) => {
  try {
    const result = await getPool().query(
      `SELECT *
       FROM outreach_email_templates
       ORDER BY lower(name)`
    );
    res.json({ templates: result.rows.map(mapOutreachTemplate) });
  } catch (err) {
    sendRouteError(res, "outreach-template-list", err);
  }
});

router.post("/ui-v2/outreach-templates", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as JsonRecord;
    const id = cleanString(body.id);
    const name = requiredString(body.name, "name");
    const subject = requiredString(body.subject, "subject");
    const templateBody = requiredString(body.body, "body");
    const pool = getPool();
    let result;
    if (id) {
      result = await pool.query(
        `UPDATE outreach_email_templates
         SET name = $2,
             subject = $3,
             body = $4,
             created_by = COALESCE($5, created_by),
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, name, subject, templateBody, cleanString(body.actorName) ?? "ui-v2"]
      );
      if (!result.rows[0]) throw new RouteError(404, "Template not found.");
    } else {
      result = await pool.query(
        `WITH existing AS (
           UPDATE outreach_email_templates
           SET subject = $2,
               body = $3,
               created_by = COALESCE($4, created_by),
               updated_at = now()
           WHERE lower(name) = lower($1)
           RETURNING *
         ),
         inserted AS (
           INSERT INTO outreach_email_templates (name, subject, body, created_by)
           SELECT $1, $2, $3, COALESCE($4, 'ui-v2')
           WHERE NOT EXISTS (SELECT 1 FROM existing)
           RETURNING *
         )
         SELECT * FROM existing
         UNION ALL
         SELECT * FROM inserted
         LIMIT 1`,
        [name, subject, templateBody, cleanString(body.actorName) ?? "ui-v2"]
      );
    }
    res.status(id ? 200 : 201).json({ template: mapOutreachTemplate(result.rows[0]) });
  } catch (err) {
    sendRouteError(res, "outreach-template-save", err);
  }
});

router.delete("/ui-v2/outreach-templates/:id", async (req: Request, res: Response) => {
  try {
    const id = cleanString(req.params.id);
    if (!id) throw new RouteError(400, "Template id is required.");
    const result = await getPool().query("DELETE FROM outreach_email_templates WHERE id = $1 RETURNING id", [id]);
    if (!result.rows[0]) throw new RouteError(404, "Template not found.");
    res.json({ ok: true, id });
  } catch (err) {
    sendRouteError(res, "outreach-template-delete", err);
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
    const templateId = cleanString(body.templateId);
    const templateName = cleanString(body.templateName);
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
        templateId,
        templateName,
      },
      propertyIds: [propertyId],
    });
    await markOmRequestedFromOutreach(pool, propertyId, "ui-v2", "ui-v2-outreach-draft").catch((err) => {
      console.warn("[crm-v2 outreach-draft status]", err);
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
      templateId,
      templateName,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    };
    res.status(201).json({ draft });
  } catch (err) {
    sendRouteError(res, "outreach-draft-create", err);
  }
});

router.post("/ui-v2/outreach-send-now", async (req: Request, res: Response) => {
  let batchId: string | null = null;
  try {
    const body = (req.body ?? {}) as JsonRecord;
    const propertyId = requiredString(body.propertyId, "propertyId");
    const toAddress = normalizeEmail(body.toAddress);
    const subject = requiredString(body.subject, "subject");
    const draftBody = requiredString(body.body, "body");
    if (!toAddress) throw new RouteError(400, "A valid toAddress is required.");
    const pool = getPool();
    const property = await new PropertyRepo({ pool }).byId(propertyId);
    if (!property) throw new RouteError(404, "Property not found.");
    const force = body.force === true;
    const inquiryRepo = new InquirySendRepo({ pool });
    if (!force) {
      const [lastSentAt, omResult] = await Promise.all([
        inquiryRepo.getLastSentAt(propertyId),
        pool.query<{ has_om_document: boolean }>(
          `SELECT EXISTS (
             SELECT 1
             FROM property_inquiry_documents d
             WHERE d.property_id = $1
               AND LOWER(COALESCE(d.filename, '')) ~ '(offering|memorandum|(^|[^a-z])om([^a-z]|$)|brochure|rent[ _-]?roll)'
           ) OR EXISTS (
             SELECT 1
             FROM property_uploaded_documents u
             WHERE u.property_id = $1
               AND u.category IN ('OM', 'Brochure', 'Rent Roll')
           ) OR EXISTS (
             SELECT 1
             FROM properties p
             WHERE p.id = $1
               AND COALESCE(p.details->'omData'->'authoritative', 'null'::jsonb) <> 'null'::jsonb
           ) AS has_om_document`,
          [propertyId]
        ),
      ]);
      if (omResult.rows[0]?.has_om_document) {
        throw new RouteError(409, "OM already received for this property. Use force to send anyway.");
      }
      if (lastSentAt) {
        throw new RouteError(409, "An inquiry has already been logged for this property. Use force to resend.");
      }
    }

    const contactId = cleanString(body.contactId);
    const followUpAt = cleanString(body.followUpAt);
    const templateId = cleanString(body.templateId);
    const templateName = cleanString(body.templateName);
    const outreachRepo = new OutreachBatchRepo({ pool });
    const batch = await outreachRepo.create({
      contactId,
      toAddress,
      status: "sending",
      createdBy: "ui-v2",
      metadata: {
        kind: "ui_v2_send_now",
        subject,
        body: draftBody,
        draftStatus: "sending",
        followUpAt,
        templateId,
        templateName,
      },
      propertyIds: [propertyId],
    });
    batchId = batch.id;

    const result = await gmailSendMessage(toAddress, subject, draftBody);
    const { sentAt } = await inquiryRepo.create(propertyId, result.id, {
      toAddress,
      source: "gmail_api",
      gmailThreadId: result.threadId,
      batchId: batch.id,
      sendMode: "ui_v2_send_now",
    });
    await outreachRepo.updateStatus(batch.id, {
      status: "sent",
      gmailMessageId: result.id,
      gmailThreadId: result.threadId,
      sentAt,
      metadata: { draftStatus: "sent" },
    });
    if (followUpAt) {
      await new PropertyActionItemRepo({ pool }).upsertOpen(propertyId, "confirm_follow_up", {
        priority: "medium",
        summary: "Follow up with broker",
        details: {
          contactId,
          draftId: batch.id,
          source: "ui-v2",
          sendMode: "send_now",
        },
        dueAt: followUpAt,
      });
    }
    await syncPropertySourcingWorkflow(propertyId, { pool }).catch((err) => {
      console.warn("[crm-v2 outreach-send-now workflow sync]", err);
    });
    await markOmRequestedFromOutreach(pool, propertyId, "ui-v2", "ui-v2-send-now").catch((err) => {
      console.warn("[crm-v2 outreach-send-now status]", err);
    });

    const draft: UiV2OutreachDraftPayload = {
      id: batch.id,
      propertyId,
      contactId,
      toAddress,
      subject,
      body: draftBody,
      status: "sent",
      followUpAt,
      templateId,
      templateName,
      createdAt: batch.createdAt,
      updatedAt: sentAt,
    };
    const payload: UiV2OutreachSendNowPayload = {
      draft,
      batchId: batch.id,
      messageId: result.id,
      threadId: result.threadId,
      sentAt,
    };
    res.status(201).json(payload);
  } catch (err) {
    if (batchId) {
      await new OutreachBatchRepo({ pool: getPool() }).updateStatus(batchId, {
        status: "failed",
        reviewReason: err instanceof Error ? err.message : String(err),
        metadata: { draftStatus: "failed" },
      }).catch(() => undefined);
    }
    sendRouteError(res, "outreach-send-now", err);
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
