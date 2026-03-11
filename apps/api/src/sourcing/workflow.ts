import type {
  PropertyOutreachSummary,
  RecipientContactCandidate,
  RecipientResolution,
} from "@re-sourcing/contracts";
import {
  BrokerContactRepo,
  RecipientResolutionRepo,
  PropertySourcingStateRepo,
  PropertyOutreachFlagRepo,
  PropertyActionItemRepo,
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
  const candidates = new Map<string, RecipientContactCandidate>();
  for (const entry of listing?.agentEnrichment ?? []) {
    const email = entry.email?.trim().toLowerCase();
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

export async function syncRecipientResolution(
  propertyId: string,
  pool: import("pg").Pool = getPool()
): Promise<RecipientResolution> {
  const resolutionRepo = new RecipientResolutionRepo({ pool });
  const contactRepo = new BrokerContactRepo({ pool });
  const existing = await resolutionRepo.get(propertyId);
  const candidates = await buildRecipientCandidatesForProperty(propertyId, pool);

  if (existing?.status === "manual_override" && existing.contactEmail) {
    const candidateContacts = candidates.length > 0 ? candidates : existing.candidateContacts;
    return resolutionRepo.upsert({
      propertyId,
      status: "manual_override",
      contactId: existing.contactId ?? null,
      contactEmail: existing.contactEmail,
      confidence: existing.confidence ?? 100,
      resolutionReason: existing.resolutionReason ?? "Manually assigned broker recipient",
      candidateContacts,
    });
  }

  const upsertedContacts = [];
  for (const candidate of candidates) {
    upsertedContacts.push(
      await contactRepo.upsert({
        normalizedEmail: candidate.email,
        displayName: candidate.name ?? null,
        firm: candidate.firm ?? null,
      })
    );
  }

  const byEmail = new Map(upsertedContacts.map((contact) => [contact.normalizedEmail, contact]));
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

  return resolutionRepo.upsert({
    propertyId,
    status: "missing",
    contactId: null,
    contactEmail: null,
    confidence: 0,
    resolutionReason: "No broker email found in listing enrichment",
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
  const contact = await contactRepo.upsert({
    normalizedEmail: normalizeEmail(params.email),
    displayName: params.name ?? null,
    firm: params.firm ?? null,
  });
  return resolutionRepo.upsert({
    propertyId,
    status: "manual_override",
    contactId: contact.id,
    contactEmail: contact.normalizedEmail,
    confidence: 100,
    resolutionReason: "Manually assigned broker recipient",
    candidateContacts: [
      {
        email: contact.normalizedEmail,
        name: contact.displayName ?? null,
        firm: contact.firm ?? null,
        contactId: contact.id,
      },
    ],
  });
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

  if (resolution.status === "missing") {
    await flagRepo.upsertOpen(propertyId, "missing_broker_email", "Property needs a broker email before OM outreach can run");
    await actionRepo.upsertOpen(propertyId, "add_broker_email", {
      priority: "high",
      summary: "Add broker email before OM outreach",
    });
    await actionRepo.resolve(propertyId, "choose_recipient");
  } else if (resolution.status === "multiple_candidates") {
    await flagRepo.upsertOpen(propertyId, "manual_reconcile_needed", "Property has multiple broker candidates and needs manual review");
    await actionRepo.upsertOpen(propertyId, "choose_recipient", {
      priority: "high",
      summary: "Choose the correct broker recipient before OM outreach",
    });
    await flagRepo.resolve(propertyId, "missing_broker_email");
    await actionRepo.resolve(propertyId, "add_broker_email");
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
