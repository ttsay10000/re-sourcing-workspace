import type {
  AgentEnrichmentEntry,
  BrokerContact,
  ListingRow,
  PropertyOutreachSummary,
  RecipientContactCandidate,
  RecipientResolution,
  UiV2BrokerBlock,
} from "@re-sourcing/contracts";
import {
  BrokerContactRepo,
  RecipientResolutionRepo,
  PropertySourcingStateRepo,
  PropertyOutreachFlagRepo,
  PropertyActionItemRepo,
  PropertyPipelineEventRepo,
  OutreachBatchRepo,
  MatchRepo,
  ListingRepo,
  InquirySendRepo,
  PropertyRepo,
  getPool,
} from "@re-sourcing/db";
import type { SearchOutreachRules } from "@re-sourcing/contracts";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeValidEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.includes("@") ? normalized : null;
}

function cleanOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return value ?? null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeIdentityPart(value: string | null | undefined): string | null {
  const cleaned = cleanOptionalString(value)?.toLowerCase() ?? null;
  if (!cleaned) return null;
  return cleaned.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || null;
}

function mergeRecipientCandidate(
  existing: RecipientContactCandidate | undefined,
  incoming: RecipientContactCandidate
): RecipientContactCandidate {
  return {
    email: normalizeEmail(incoming.email),
    name: existing?.name ?? incoming.name ?? null,
    firm: existing?.firm ?? incoming.firm ?? null,
    contactId: existing?.contactId ?? incoming.contactId ?? null,
  };
}

function dedupeRecipientCandidates(
  candidates: Array<RecipientContactCandidate | null | undefined>
): RecipientContactCandidate[] {
  const deduped = new Map<string, RecipientContactCandidate>();
  for (const candidate of candidates) {
    const email = candidate?.email?.trim();
    if (!email) continue;
    const normalizedEmail = normalizeEmail(email);
    deduped.set(
      normalizedEmail,
      mergeRecipientCandidate(deduped.get(normalizedEmail), {
        ...candidate,
        email: normalizedEmail,
      })
    );
  }
  return [...deduped.values()];
}

export function mergeManualOverrideCandidateContacts(params: {
  manualResolution: RecipientResolution;
  listingCandidates: RecipientContactCandidate[];
}): RecipientContactCandidate[] {
  const manualEmail = params.manualResolution.contactEmail?.trim();
  const manualMatch = params.manualResolution.candidateContacts.find(
    (candidate) => candidate.email?.trim().toLowerCase() === manualEmail?.toLowerCase()
  );
  const manualCandidate =
    manualEmail != null && manualEmail.length > 0
      ? {
          email: manualEmail,
          name: manualMatch?.name ?? null,
          firm: manualMatch?.firm ?? null,
          contactId: params.manualResolution.contactId ?? manualMatch?.contactId ?? null,
        }
      : null;

  return dedupeRecipientCandidates([manualCandidate, ...params.listingCandidates]);
}

export async function getPrimaryListingForProperty(
  propertyId: string,
  pool: import("pg").Pool = getPool()
) {
  const matchRepo = new MatchRepo({ pool });
  const listingRepo = new ListingRepo({ pool });
  const { matches } = await matchRepo.list({ propertyId, limit: 1 });
  if (!matches[0]) return null;
  return listingRepo.byId(matches[0].listingId);
}

export async function buildRecipientCandidatesForProperty(
  propertyId: string,
  pool: import("pg").Pool = getPool()
): Promise<RecipientContactCandidate[]> {
  const listing = await getPrimaryListingForProperty(propertyId, pool);
  return buildRecipientCandidatesFromListing(listing);
}

function buildRecipientCandidatesFromListing(listing: ListingRow | null): RecipientContactCandidate[] {
  const candidates = new Map<string, RecipientContactCandidate>();
  for (const entry of listing?.agentEnrichment ?? []) {
    const email = normalizeValidEmail(entry.email);
    if (!email) continue;
    if (!candidates.has(email)) {
      candidates.set(email, {
        email,
        name: entry.name ?? null,
        firm: entry.firm ?? null,
      });
    }
  }
  return [...candidates.values()];
}

function buildNoEmailBrokerSourceKey(params: {
  propertyId: string;
  listingId?: string | null;
  entry: AgentEnrichmentEntry;
  index: number;
}): string {
  const identity = [
    normalizeIdentityPart(params.entry.name),
    normalizeIdentityPart(params.entry.firm),
    normalizeIdentityPart(params.entry.phone),
  ]
    .filter(Boolean)
    .join("-");
  const listingPart = params.listingId ? `listing:${params.listingId}` : "listing:unknown";
  return `property:${params.propertyId}:${listingPart}:broker:${identity || `agent-${params.index}`}`;
}

async function upsertNoEmailBrokerContactsForListing(params: {
  propertyId: string;
  listing: ListingRow | null;
  contactRepo: BrokerContactRepo;
}): Promise<BrokerContact[]> {
  const contacts: BrokerContact[] = [];
  const entries = params.listing?.agentEnrichment ?? [];
  for (const [index, entry] of entries.entries()) {
    if (normalizeValidEmail(entry.email)) continue;
    const name = cleanOptionalString(entry.name);
    const firm = cleanOptionalString(entry.firm);
    const phone = cleanOptionalString(entry.phone);
    if (!name && !firm && !phone) continue;
    const sourceKey = buildNoEmailBrokerSourceKey({
      propertyId: params.propertyId,
      listingId: params.listing?.id,
      entry,
      index,
    });
    contacts.push(
      await params.contactRepo.upsert({
        normalizedEmail: null,
        sourceKey,
        displayName: name,
        firm,
        phone,
        source: "llm",
        sourceMetadata: {
          kind: "listing_agent_without_email",
          needsEmail: true,
          propertyId: params.propertyId,
          listingId: params.listing?.id ?? null,
          sourceKey,
        },
        manualReviewOnly: true,
        activitySummary: {
          needsEmail: true,
          missingEmail: true,
          relatedPropertyIds: [params.propertyId],
        },
      })
    );
  }
  return contacts;
}

export async function syncRecipientResolution(
  propertyId: string,
  pool: import("pg").Pool = getPool()
): Promise<RecipientResolution> {
  const resolutionRepo = new RecipientResolutionRepo({ pool });
  const contactRepo = new BrokerContactRepo({ pool });
  const existing = await resolutionRepo.get(propertyId);
  const listing = await getPrimaryListingForProperty(propertyId, pool);
  const candidates = buildRecipientCandidatesFromListing(listing);
  const noEmailContacts = await upsertNoEmailBrokerContactsForListing({
    propertyId,
    listing,
    contactRepo,
  });

  if (existing?.status === "manual_override" && (existing.contactEmail || existing.contactId)) {
    const candidateContacts = mergeManualOverrideCandidateContacts({
      manualResolution: existing,
      listingCandidates: candidates,
    });
    return resolutionRepo.upsert({
      propertyId,
      status: "manual_override",
      contactId: existing.contactId ?? null,
      contactEmail: existing.contactEmail ?? null,
      confidence: existing.confidence ?? 100,
      resolutionReason: existing.resolutionReason ?? "Manually assigned broker recipient",
      candidateContacts,
    });
  }

  const upsertedContacts: BrokerContact[] = [];
  for (const candidate of candidates) {
    upsertedContacts.push(
      await contactRepo.upsert({
        normalizedEmail: candidate.email,
        displayName: candidate.name ?? null,
        firm: candidate.firm ?? null,
      })
    );
  }

  const byEmail = new Map(
    upsertedContacts
      .filter((contact): contact is BrokerContact & { normalizedEmail: string } => contact.normalizedEmail != null)
      .map((contact) => [contact.normalizedEmail, contact])
  );
  const candidateContacts = candidates.map((candidate) => ({
    ...candidate,
    contactId: byEmail.get(candidate.email)?.id ?? null,
  }));

  if (candidateContacts.length === 1) {
    const only = candidateContacts[0]!;
    return resolutionRepo.upsert({
      propertyId,
      status: "resolved",
      contactId: only.contactId ?? null,
      contactEmail: only.email,
      confidence: 100,
      resolutionReason: "Single broker email from listing enrichment",
      candidateContacts,
    });
  }

  if (candidateContacts.length > 1) {
    return resolutionRepo.upsert({
      propertyId,
      status: "multiple_candidates",
      contactId: null,
      contactEmail: null,
      confidence: 55,
      resolutionReason: "Multiple broker emails from listing enrichment",
      candidateContacts,
    });
  }

  if (noEmailContacts.length === 1) {
    const contact = noEmailContacts[0]!;
    return resolutionRepo.upsert({
      propertyId,
      status: "missing",
      contactId: contact.id,
      contactEmail: null,
      confidence: 40,
      resolutionReason: "Broker identified without email",
      candidateContacts: [],
    });
  }

  return resolutionRepo.upsert({
    propertyId,
    status: "missing",
    contactId: null,
    contactEmail: null,
    confidence: 0,
    resolutionReason:
      noEmailContacts.length > 1
        ? "Multiple brokers identified without email"
        : "No broker email found in listing enrichment",
    candidateContacts: [],
  });
}

export async function setManualRecipientResolution(
  propertyId: string,
  params: { email: string; name?: string | null; firm?: string | null },
  pool: import("pg").Pool = getPool()
): Promise<RecipientResolution> {
  const contactRepo = new BrokerContactRepo({ pool });
  const resolutionRepo = new RecipientResolutionRepo({ pool });
  const normalizedEmail = normalizeEmail(params.email);
  const contact = await contactRepo.upsert({
    normalizedEmail,
    displayName: params.name ?? null,
    firm: params.firm ?? null,
  });
  const contactEmail = contact.normalizedEmail ?? normalizedEmail;
  return resolutionRepo.upsert({
    propertyId,
    status: "manual_override",
    contactId: contact.id,
    contactEmail,
    confidence: 100,
    resolutionReason: "Manually assigned broker recipient",
    candidateContacts: [
      {
        email: contactEmail,
        name: contact.displayName ?? null,
        firm: contact.firm ?? null,
        contactId: contact.id,
      },
    ],
  });
}

export interface OverwriteManualBrokerResolutionParams {
  email?: string | null;
  name?: string | null;
  firm?: string | null;
  phone?: string | null;
  notes?: string | null;
  actorName?: string | null;
}

export interface OverwriteManualBrokerResolutionResult {
  contact: BrokerContact;
  resolution: RecipientResolution;
  broker: UiV2BrokerBlock;
}

export async function overwriteManualBrokerResolution(
  propertyId: string,
  params: OverwriteManualBrokerResolutionParams,
  pool: import("pg").Pool = getPool()
): Promise<OverwriteManualBrokerResolutionResult> {
  const email = normalizeValidEmail(params.email);

  const requestedName = cleanOptionalString(params.name);
  const requestedFirm = cleanOptionalString(params.firm);
  const requestedPhone = cleanOptionalString(params.phone);
  const requestedNotes = cleanOptionalString(params.notes);
  if (!email && !requestedName && !requestedFirm && !requestedPhone) {
    throw new Error("Broker name, firm, phone, or email is required.");
  }
  const actorName = cleanOptionalString(params.actorName) ?? "ui-v2";
  const overwrittenAt = new Date().toISOString();
  const sourceKey = `property:${propertyId}:manual-broker`;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const contactRepo = new BrokerContactRepo({ pool, client });
    const resolutionRepo = new RecipientResolutionRepo({ pool, client });
    const propertyRepo = new PropertyRepo({ pool, client });
    const actionRepo = new PropertyActionItemRepo({ pool, client });
    const eventRepo = new PropertyPipelineEventRepo({ pool, client });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      throw new Error("Property not found.");
    }

    const baseContact = await contactRepo.upsert({
      normalizedEmail: email,
      sourceKey,
      displayName: requestedName,
      firm: requestedFirm,
      phone: requestedPhone,
      source: "overwrite",
      sourceMetadata: {
        kind: "manual_broker_override",
        needsEmail: !email,
        propertyId,
        sourceKey,
      },
      manualReviewOnly: !email,
      notes: requestedNotes,
      activitySummary: {
        needsEmail: !email,
        missingEmail: !email,
        manualBrokerOverride: {
          source: "ui_v2_broker_overwrite",
          propertyId,
          phone: requestedPhone,
          overwrittenAt,
          overwrittenBy: actorName,
        },
      },
    });
    const nextActivitySummary = {
      ...(baseContact.activitySummary ?? {}),
      manualBrokerOverride: {
        source: "ui_v2_broker_overwrite",
        propertyId,
        needsEmail: !email,
        missingEmail: !email,
        phone: requestedPhone,
        overwrittenAt,
        overwrittenBy: actorName,
      },
    };
    const updatedContact =
      (await contactRepo.update(baseContact.id, {
        displayName: requestedName ?? baseContact.displayName ?? null,
        firm: requestedFirm ?? baseContact.firm ?? null,
        phone: requestedPhone ?? baseContact.phone ?? null,
        notes: requestedNotes ?? baseContact.notes ?? null,
        manualReviewOnly: !email || baseContact.manualReviewOnly,
        activitySummary: nextActivitySummary,
      })) ?? baseContact;

    const brokerName = updatedContact.displayName ?? requestedName;
    const brokerFirm = updatedContact.firm ?? requestedFirm;
    const contactEmail = email ?? null;
    const candidateContacts = contactEmail
      ? [
          {
            email: contactEmail,
            name: brokerName,
            firm: brokerFirm,
            contactId: updatedContact.id,
          },
        ]
      : [];
    await resolutionRepo.setBrokerOverwrite({
      propertyId,
      contactId: updatedContact.id,
      email: contactEmail,
      name: brokerName,
      phone: requestedPhone,
      firm: brokerFirm,
      notes: requestedNotes,
      confidence: 100,
      resolutionReason: "Manually overwritten broker recipient",
      candidateContacts,
      overwriteSource: "ui-v2",
      overwrittenBy: actorName,
      overwriteMetadata: {
        needsEmail: !email,
        sourceKey,
      },
      sourceBrokerSnapshot: {
        previousBrokerManualOverride: property.details?.brokerManualOverride ?? null,
      },
    });
    const resolution = await resolutionRepo.get(propertyId);
    if (!resolution) {
      throw new Error("Failed to save broker recipient overwrite.");
    }
    await propertyRepo.mergeDetails(propertyId, {
      brokerManualOverride: {
        contactId: updatedContact.id,
        name: brokerName,
        email: contactEmail,
        phone: requestedPhone,
        firm: brokerFirm,
        notes: requestedNotes,
        source: "ui_v2_broker_overwrite",
        overwrittenAt,
        overwrittenBy: actorName,
      },
    });
    await eventRepo.create({
      propertyId,
      eventType: "broker_edited",
      actor: actorName,
      source: "ui-v2",
      title: "Broker edited",
      body: contactEmail ?? brokerName ?? brokerFirm ?? requestedPhone,
      metadata: {
        contactId: updatedContact.id,
        needsEmail: !email,
      },
    });
    if (contactEmail) {
      await Promise.all([
        actionRepo.resolve(propertyId, "add_broker_email"),
        actionRepo.resolve(propertyId, "choose_recipient"),
      ]);
    } else {
      await Promise.all([
        actionRepo.upsertOpen(propertyId, "add_broker_email", {
          priority: "high",
          summary: "Add broker email before OM outreach",
          details: {
            contactId: updatedContact.id,
            sourceKey,
          },
        }),
        actionRepo.resolve(propertyId, "choose_recipient"),
      ]);
    }

    await client.query("COMMIT");
    return {
      contact: updatedContact,
      resolution,
      broker: {
        contactId: updatedContact.id,
        name: brokerName,
        email: contactEmail,
        phone: requestedPhone,
        firm: brokerFirm,
        source: "overwrite",
        overwrittenAt,
        overwrittenBy: actorName,
      },
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function syncPropertySourcingWorkflow(
  propertyId: string,
  options?: {
    pool?: import("pg").Pool;
    originatingProfileId?: string | null;
    originatingRunId?: string | null;
    latestRunId?: string | null;
    outreachReason?: string | null;
    outreachRules?: SearchOutreachRules | null;
  }
): Promise<PropertyOutreachSummary> {
  const pool = options?.pool ?? getPool();
  const resolution = await syncRecipientResolution(propertyId, pool);
  const stateRepo = new PropertySourcingStateRepo({ pool });
  const flagRepo = new PropertyOutreachFlagRepo({ pool });
  const actionRepo = new PropertyActionItemRepo({ pool });
  const batchRepo = new OutreachBatchRepo({ pool });
  const inquirySendRepo = new InquirySendRepo({ pool });

  const propertyDocs = await pool.query<{
    has_manual_om: boolean;
    last_reply_at: Date | string | null;
  }>(
    `SELECT
       EXISTS (
         SELECT 1
         FROM property_inquiry_documents d
         WHERE d.property_id = $1
           AND LOWER(COALESCE(d.filename, '')) ~ '(offering|memorandum|(^|[^a-z])om([^a-z]|$)|brochure|rent[ _-]?roll)'
       ) OR EXISTS (
         SELECT 1
         FROM property_uploaded_documents u
         WHERE u.property_id = $1 AND u.category IN ('OM', 'Brochure', 'Rent Roll')
       ) OR EXISTS (
         SELECT 1
         FROM properties p
         WHERE p.id = $1
           AND COALESCE(p.details->'omData'->'authoritative', 'null'::jsonb) <> 'null'::jsonb
       ) AS has_manual_om,
       (
         SELECT MAX(e.received_at)
         FROM property_inquiry_email_properties link
         INNER JOIN property_inquiry_emails e ON e.id = link.inquiry_email_id
         WHERE link.property_id = $1
       ) AS last_reply_at`,
    [propertyId]
  );

  const hasManualOm = Boolean(propertyDocs.rows[0]?.has_manual_om);
  const lastReplyAtRaw = propertyDocs.rows[0]?.last_reply_at ?? null;
  const lastReplyAt = lastReplyAtRaw ? new Date(lastReplyAtRaw).toISOString() : null;
  const lastContactedAt = await inquirySendRepo.getLastSentAt(propertyId);
  const existing = await stateRepo.get(propertyId);
  const outreachBlockReason = await resolveOutreachBlockReason(propertyId, resolution, options?.outreachRules ?? null, pool);

  const needsBrokerEmail = !normalizeValidEmail(resolution.contactEmail);

  if (resolution.status === "multiple_candidates") {
    await flagRepo.upsertOpen(propertyId, "manual_reconcile_needed", "Property has multiple broker candidates and needs manual review");
    await actionRepo.upsertOpen(propertyId, "choose_recipient", {
      priority: "high",
      summary: "Choose the correct broker recipient before OM outreach",
    });
    await flagRepo.resolve(propertyId, "missing_broker_email");
    await actionRepo.resolve(propertyId, "add_broker_email");
  } else if (resolution.status === "missing" || needsBrokerEmail) {
    await flagRepo.upsertOpen(propertyId, "missing_broker_email", "Property needs a broker email before OM outreach can run");
    await actionRepo.upsertOpen(propertyId, "add_broker_email", {
      priority: "high",
      summary: "Add broker email before OM outreach",
      details: {
        contactId: resolution.contactId ?? null,
      },
    });
    await actionRepo.resolve(propertyId, "choose_recipient");
  } else {
    await flagRepo.resolve(propertyId, "missing_broker_email");
    await flagRepo.resolve(propertyId, "manual_reconcile_needed");
    await actionRepo.resolve(propertyId, "add_broker_email");
    await actionRepo.resolve(propertyId, "choose_recipient");
  }

  if (lastReplyAt && !hasManualOm) {
    await flagRepo.upsertOpen(propertyId, "reply_without_om", "Broker replied but OM still needs manual review or upload");
    await actionRepo.upsertOpen(propertyId, "reply_received_no_om", {
      priority: "high",
      summary: "Broker replied, but OM still needs manual review",
    });
    await actionRepo.upsertOpen(propertyId, "upload_om_manually", {
      priority: "high",
      summary: "Review reply and upload OM manually if available",
    });
  } else if (hasManualOm) {
    await flagRepo.resolve(propertyId, "reply_without_om");
    await actionRepo.resolve(propertyId, "reply_received_no_om");
    await actionRepo.resolve(propertyId, "upload_om_manually");
  }

  if (outreachBlockReason && !lastContactedAt && !lastReplyAt && !hasManualOm) {
    await actionRepo.upsertOpen(propertyId, "confirm_follow_up", {
      priority: "medium",
      summary: outreachBlockReason,
      details: { source: "outreach_rules" },
    });
  } else {
    await actionRepo.resolve(propertyId, "confirm_follow_up");
  }

  const openActionItems = await actionRepo.listOpenByPropertyId(propertyId);

  const disposition = existing?.disposition ?? "active";
  const held = disposition === "held" || Boolean(existing?.holdReason);
  let workflowState = existing?.workflowState ?? "new";
  if (held) workflowState = "held";
  else if (disposition === "not_a_fit" || disposition === "duplicate_ignore" || disposition === "do_not_pursue") workflowState = "not_a_fit";
  else if (disposition === "archived") workflowState = "archived";
  else if (hasManualOm) workflowState = "om_received_manual_review";
  else if (lastReplyAt) workflowState = "reply_received";
  else if (lastContactedAt) workflowState = "sent_waiting_reply";
  else if (resolution.status === "resolved" || resolution.status === "manual_override") {
    workflowState = openActionItems.length > 0 ? "review_required" : "eligible_for_outreach";
  } else {
    workflowState = "review_required";
  }

  const updatedState = await stateRepo.upsert({
    propertyId,
    workflowState,
    disposition,
    holdReason: existing?.holdReason ?? null,
    holdNote: existing?.holdNote ?? null,
    originatingProfileId:
      options?.originatingProfileId !== undefined ? options.originatingProfileId : (existing?.originatingProfileId ?? null),
    originatingRunId:
      options?.originatingRunId !== undefined ? options.originatingRunId : (existing?.originatingRunId ?? null),
    latestRunId:
      options?.latestRunId !== undefined ? options.latestRunId : (existing?.latestRunId ?? null),
    outreachReason:
      options?.outreachReason !== undefined ? options.outreachReason : (existing?.outreachReason ?? null),
    firstEligibleAt:
      workflowState === "eligible_for_outreach"
        ? (existing?.firstEligibleAt ?? new Date().toISOString())
        : (existing?.firstEligibleAt ?? null),
    lastContactedAt: lastContactedAt ?? null,
    lastReplyAt,
    manualOmReviewAt: hasManualOm ? (existing?.manualOmReviewAt ?? new Date().toISOString()) : null,
  });

  const openFlags = await flagRepo.listOpenByPropertyId(propertyId);
  const lastBatch = await batchRepo.latestByPropertyId(propertyId);
  return {
    sourcingState: updatedState,
    recipientResolution: resolution,
    openFlags,
    openActionItems,
    lastBatch,
  };
}

async function resolveOutreachBlockReason(
  propertyId: string,
  resolution: RecipientResolution,
  rules: SearchOutreachRules | null,
  pool: import("pg").Pool
): Promise<string | null> {
  if (!rules || Object.keys(rules).length === 0) return null;
  if (rules.requireResolvedRecipient && !["resolved", "manual_override"].includes(resolution.status)) {
    return "Recipient resolution must be confirmed before automated outreach";
  }
  if (rules.minimumRecipientConfidence != null && (resolution.confidence ?? 0) < rules.minimumRecipientConfidence) {
    return `Recipient confidence is below the saved-search threshold (${rules.minimumRecipientConfidence})`;
  }

  const listing = await getPrimaryListingForProperty(propertyId, pool);
  if (rules.maxPrice != null && listing?.price != null && listing.price > rules.maxPrice) {
    return `Listing price exceeds saved-search outreach cap (${rules.maxPrice})`;
  }

  const propertyRepo = new PropertyRepo({ pool });
  const property = await propertyRepo.byId(propertyId);
  const details = (property?.details ?? {}) as Record<string, unknown>;
  const rentalFinancials = (details.rentalFinancials ?? {}) as Record<string, unknown>;
  const rentalUnits = Array.isArray(rentalFinancials.rentalUnits) ? rentalFinancials.rentalUnits.length : null;
  const extra = (listing?.extra ?? {}) as Record<string, unknown>;
  const rawUnitCount = extra.unitCount ?? extra.units ?? extra.totalUnits ?? extra.unit_count;
  const inferredUnitCount =
    rentalUnits ??
    (typeof rawUnitCount === "number"
      ? rawUnitCount
      : typeof rawUnitCount === "string"
        ? Number(rawUnitCount)
        : null);
  if (rules.minUnits != null && inferredUnitCount != null && inferredUnitCount < rules.minUnits) {
    return `Unit count is below the saved-search outreach minimum (${rules.minUnits})`;
  }

  if (Array.isArray(rules.propertyTypes) && rules.propertyTypes.length > 0) {
    const propertyTypeRaw =
      extra.propertyType ??
      extra.property_type ??
      extra.buildingType ??
      extra.building_type ??
      extra.homeType ??
      extra.home_type;
    const propertyType = typeof propertyTypeRaw === "string" ? propertyTypeRaw.trim().toLowerCase() : null;
    const allowed = rules.propertyTypes.map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (propertyType && allowed.length > 0 && !allowed.includes(propertyType)) {
      return "Listing property type is outside the saved-search outreach rules";
    }
  }

  return null;
}
