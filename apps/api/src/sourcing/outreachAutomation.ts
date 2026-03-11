import { EventRepo, InquirySendRepo, OutreachBatchRepo, PropertyActionItemRepo, PropertySourcingStateRepo, getPool } from "@re-sourcing/db";
import { getBodyText, getHeader, getMessage, sendMessage } from "../inquiry/gmailClient.js";
import { findBrokerPropertyConversationHistory } from "../inquiry/gmailConversationHistory.js";
import { syncPropertySourcingWorkflow } from "./workflow.js";

interface EligiblePropertyRow {
  property_id: string;
  canonical_address: string;
  contact_id: string | null;
  contact_email: string;
  contact_name: string | null;
  manual_review_only: boolean;
  do_not_contact_until: Date | string | null;
  preferred_thread_id: string | null;
}

interface HistoricalOutreachBatchRow {
  id: string;
  gmail_message_id: string | null;
  metadata: Record<string, unknown> | null;
  sent_at: Date | string | null;
}

export function normalizeOutreachAddressKey(address: string | null | undefined): string | null {
  if (typeof address !== "string") return null;
  const normalized = address.trim();
  if (!normalized) return null;

  const [addressLine] = normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const normalizedLine = (addressLine ?? normalized)
    .toLowerCase()
    .replace(/[^\da-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedLine) return null;

  const zipMatch = normalized.match(/\b(\d{5})(?:-\d{4})?\b/);
  return zipMatch?.[1] ? `${normalizedLine}|${zipMatch[1]}` : normalizedLine;
}

function extractBulletAddresses(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

export function extractOutreachAddressesFromMessage(input: {
  subject?: string | null;
  body?: string | null;
}): string[] {
  const bulletAddresses = extractBulletAddresses(input.body ?? "");
  if (bulletAddresses.length > 0) return bulletAddresses;

  const subject = input.subject?.trim() ?? "";
  const subjectMatch = subject.match(/^OM Request - (.+)$/i);
  if (!subjectMatch?.[1]) return [];
  return subjectMatch[1]
    .split(/\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function metadataCanonicalAddresses(metadata: Record<string, unknown> | null | undefined): string[] {
  const value = metadata?.canonicalAddresses;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

async function markHistoryReviewRequired(
  actionRepo: PropertyActionItemRepo,
  stateRepo: PropertySourcingStateRepo,
  propertyId: string,
  summary: string,
  details: Record<string, unknown>
): Promise<void> {
  await actionRepo.upsertOpen(propertyId, "review_thread_conflict", {
    priority: "high",
    summary,
    details,
  });
  await stateRepo.upsert({
    propertyId,
    workflowState: "review_required",
    latestRunId: null,
  });
}

async function resolveHistoricalBatchAddresses(
  batch: HistoricalOutreachBatchRow,
  batchRepo: OutreachBatchRepo
): Promise<string[] | null> {
  const existing = metadataCanonicalAddresses(batch.metadata);
  if (existing.length > 0) return existing;
  if (!batch.gmail_message_id) return null;

  try {
    const msg = await getMessage(batch.gmail_message_id);
    const recovered = extractOutreachAddressesFromMessage({
      subject: getHeader(msg, "Subject"),
      body: getBodyText(msg),
    });
    if (recovered.length === 0) return null;
    await batchRepo.updateStatus(batch.id, {
      metadata: {
        canonicalAddresses: recovered,
        canonicalAddressesRecoveredAt: new Date().toISOString(),
      },
    });
    return recovered;
  } catch (err) {
    console.error(
      "[runDailyOutreach] failed to recover historical batch addresses",
      batch.id,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

async function loadHistoricalAddressKeys(
  batchRepo: OutreachBatchRepo,
  pool: import("pg").Pool
): Promise<{ addressKeys: Set<string>; unresolvedHistory: boolean }> {
  const history = await pool.query<HistoricalOutreachBatchRow>(
    `SELECT id, gmail_message_id, metadata, sent_at
     FROM outreach_batches
     WHERE status = 'sent'
     ORDER BY sent_at DESC NULLS LAST, created_at DESC`,
    []
  );

  const addressKeys = new Set<string>();
  let unresolvedHistory = false;

  for (const row of history.rows) {
    const addresses = await resolveHistoricalBatchAddresses(row, batchRepo);
    if (!addresses || addresses.length === 0) {
      unresolvedHistory = true;
      continue;
    }
    for (const address of addresses) {
      const key = normalizeOutreachAddressKey(address);
      if (key) addressKeys.add(key);
    }
  }

  return { addressKeys, unresolvedHistory };
}

function buildSubject(addresses: string[]): string {
  if (addresses.length === 1) return `OM Request - ${addresses[0]}`;
  if (addresses.length === 2) return `OM Request - ${addresses[0]} and ${addresses[1]}`;
  return `OM Request - ${addresses.length} properties`;
}

export function buildOutreachBody(contactName: string | null, addresses: string[]): string {
  const greeting = contactName ? `Hi ${contactName.split(/\s+/)[0]},` : "Hi,";
  const list = addresses.map((address) => `- ${address}`).join("\n");
  const intro =
    addresses.length === 1
      ? "My name is Tyler Tsay, and I'm reaching out on behalf of a client regarding the property below currently on the market. We are evaluating the building and would appreciate the opportunity to review further."
      : "My name is Tyler Tsay, and I'm reaching out on behalf of a client regarding the properties below currently on the market. We are evaluating them and would appreciate the opportunity to review further.";
  const request =
    addresses.length === 1
      ? "Would you be able to share the OM, current rent roll, expenses, and/or any available financials?"
      : "Would you be able to share the OMs, current rent rolls, expenses, and/or any available financials for these properties?";
  const contactRedirect =
    addresses.length === 1
      ? "If there is a better contact for this property, please feel free to point me in the right direction."
      : "If there is a better contact for any of these, please feel free to point me in the right direction.";
  return `${greeting}

${intro}

${list}

${request}

${contactRedirect}

Thanks in advance - looking forward to taking a look.

Best,
Tyler Tsay
617 306 3336
tyler@stayhaus.co`;
}

export async function runDailyOutreach(
  options?: { propertyIds?: string[] }
): Promise<{ sent: number; reviewRequired: number; batchIds: string[] }> {
  const pool = getPool();
  const scopedPropertyIds =
    Array.isArray(options?.propertyIds) && options.propertyIds.length > 0
      ? options.propertyIds.filter((propertyId): propertyId is string => typeof propertyId === "string" && propertyId.trim().length > 0)
      : null;
  const rows = await pool.query<EligiblePropertyRow>(
    `SELECT
       p.id AS property_id,
       p.canonical_address,
       r.contact_id,
       r.contact_email,
       bc.display_name AS contact_name,
       bc.manual_review_only,
       bc.do_not_contact_until,
       bc.preferred_thread_id
     FROM properties p
     INNER JOIN property_sourcing_state s ON s.property_id = p.id
     INNER JOIN property_recipient_resolution r ON r.property_id = p.id
     LEFT JOIN broker_contacts bc ON bc.id = r.contact_id
     WHERE s.workflow_state = 'eligible_for_outreach'
       AND ($1::uuid[] IS NULL OR p.id = ANY($1::uuid[]))
       AND s.disposition = 'active'
       AND COALESCE(p.details->'omData'->'authoritative', 'null'::jsonb) = 'null'::jsonb
       AND r.status IN ('resolved', 'manual_override')
       AND r.contact_email IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM property_inquiry_sends prior_send
         WHERE prior_send.property_id = p.id
       )
       AND NOT EXISTS (
         SELECT 1
         FROM property_inquiry_email_properties prior_reply_link
         INNER JOIN property_inquiry_emails prior_reply ON prior_reply.id = prior_reply_link.inquiry_email_id
         WHERE prior_reply_link.property_id = p.id
       )
       AND NOT EXISTS (
         SELECT 1
         FROM property_inquiry_documents prior_doc
         WHERE prior_doc.property_id = p.id
       )
       AND NOT EXISTS (
         SELECT 1
         FROM property_uploaded_documents uploaded_doc
         WHERE uploaded_doc.property_id = p.id
           AND uploaded_doc.category IN ('OM', 'Brochure', 'Rent Roll')
       )
       AND NOT EXISTS (
         SELECT 1
         FROM property_action_items ai
         WHERE ai.property_id = p.id AND ai.status = 'open'
       )
     ORDER BY r.contact_email, p.created_at DESC`
    ,
    [scopedPropertyIds]
  );

  const grouped = new Map<string, EligiblePropertyRow[]>();
  for (const row of rows.rows) {
    const key = row.contact_email.trim().toLowerCase();
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  const batchRepo = new OutreachBatchRepo({ pool });
  const inquirySendRepo = new InquirySendRepo({ pool });
  const stateRepo = new PropertySourcingStateRepo({ pool });
  const actionRepo = new PropertyActionItemRepo({ pool });
  const eventRepo = new EventRepo({ pool });
  let sent = 0;
  let reviewRequired = 0;
  const batchIds: string[] = [];
  const historicalAddressState = await loadHistoricalAddressKeys(batchRepo, pool);

  for (const [toAddress, properties] of grouped) {
    const blockedByHistoricalOutreach = properties.filter((property) => {
      const key = normalizeOutreachAddressKey(property.canonical_address);
      return key != null && historicalAddressState.addressKeys.has(key);
    });
    const propertiesWithoutHistoricalBlock = properties.filter((property) => {
      const key = normalizeOutreachAddressKey(property.canonical_address);
      return key == null || !historicalAddressState.addressKeys.has(key);
    });

    for (const property of blockedByHistoricalOutreach) {
      await markHistoryReviewRequired(
        actionRepo,
        stateRepo,
        property.property_id,
        "Historical outreach already exists for this address; auto-send blocked",
        { toAddress, source: "historical_outreach_recovery" }
      );
    }

    const sendableProperties: EligiblePropertyRow[] = [];
    for (const property of propertiesWithoutHistoricalBlock) {
      try {
        const gmailHistory = await findBrokerPropertyConversationHistory({
          toAddress,
          canonicalAddress: property.canonical_address,
        });
        if (gmailHistory.matches.length > 0) {
          await markHistoryReviewRequired(
            actionRepo,
            stateRepo,
            property.property_id,
            "Existing Gmail conversation found for this broker and property; auto-send blocked",
            {
              toAddress,
              source: "gmail_conversation_history",
              query: gmailHistory.query,
              canonicalAddress: property.canonical_address,
              addressLine: gmailHistory.addressLine,
              matches: gmailHistory.matches,
            }
          );
          continue;
        }
      } catch (err) {
        await markHistoryReviewRequired(
          actionRepo,
          stateRepo,
          property.property_id,
          "Mailbox history could not be verified for this broker and property; auto-send blocked",
          {
            toAddress,
            source: "gmail_conversation_history_lookup_failed",
            canonicalAddress: property.canonical_address,
            error: err instanceof Error ? err.message : String(err),
          }
        );
        continue;
      }

      sendableProperties.push(property);
    }

    if (sendableProperties.length === 0) {
      if (properties.length > 0) reviewRequired += properties.length;
      continue;
    }

    if (sendableProperties.length < properties.length) {
      reviewRequired += properties.length - sendableProperties.length;
    }

    const recentSends = await pool.query<{ gmail_thread_id: string | null; sent_at: Date | string }>(
      `SELECT gmail_thread_id, sent_at
       FROM property_inquiry_sends
       WHERE to_address = $1
         AND sent_at >= now() - interval '7 days'
       ORDER BY sent_at DESC`,
      [toAddress]
    );
    const distinctThreads = [...new Set(recentSends.rows.map((row) => row.gmail_thread_id).filter((threadId): threadId is string => Boolean(threadId)))];
    const hasRecentHistory = recentSends.rows.length > 0;
    const hasUnthreadedRecentSend = recentSends.rows.some((row) => !row.gmail_thread_id);
    const hasSentWithinOneDay = recentSends.rows.some(
      (row) => new Date(row.sent_at).getTime() >= Date.now() - 24 * 60 * 60 * 1000
    );
    const reviewReason =
      properties.some((property) => property.manual_review_only)
        ? "Contact marked as manual-review-only"
      : properties.some((property) => property.do_not_contact_until && new Date(property.do_not_contact_until).getTime() > Date.now())
          ? "Contact is in a do-not-contact window"
        : historicalAddressState.unresolvedHistory
          ? "Historical outreach exists, but prior contacted addresses could not be reconstructed safely"
        : hasSentWithinOneDay
            ? "Recipient already received automated outreach within the past 24 hours"
          : hasRecentHistory && hasUnthreadedRecentSend
            ? "Recent outreach exists for this recipient, but no Gmail thread is recorded"
          : distinctThreads.length > 1
            ? "Multiple recent outreach threads exist for this recipient"
            : null;

    const batch = await batchRepo.create({
      contactId: sendableProperties[0]?.contact_id ?? null,
      toAddress,
      status: reviewReason ? "review_required" : "queued",
      createdBy: "automation",
      reviewReason,
      metadata: {
        propertyIds: sendableProperties.map((property) => property.property_id),
        canonicalAddresses: sendableProperties.map((property) => property.canonical_address),
        suggestedThreadId: reviewReason ? null : (distinctThreads[0] ?? sendableProperties[0]?.preferred_thread_id ?? null),
      },
      propertyIds: sendableProperties.map((property) => property.property_id),
    });
    batchIds.push(batch.id);

    if (reviewReason) {
      reviewRequired++;
      for (const property of sendableProperties) {
        await actionRepo.upsertOpen(property.property_id, "review_thread_conflict", {
          priority: "high",
          summary: reviewReason,
          details: { batchId: batch.id, toAddress },
        });
        await stateRepo.upsert({
          propertyId: property.property_id,
          workflowState: "review_required",
          latestRunId: null,
        });
      }
      await eventRepo.emit("job.job.failed", {
        batchId: batch.id,
        toAddress,
        reviewReason,
        propertyIds: sendableProperties.map((property) => property.property_id),
      });
      continue;
    }

    const subject = buildSubject(sendableProperties.map((property) => property.canonical_address));
    const body = buildOutreachBody(sendableProperties[0]?.contact_name ?? null, sendableProperties.map((property) => property.canonical_address));
    const result = await sendMessage(toAddress, subject, body, {
      threadId: distinctThreads.length === 1 ? distinctThreads[0] : null,
    });
    sent++;
    await batchRepo.updateStatus(batch.id, {
      status: "sent",
      gmailMessageId: result.id,
      gmailThreadId: result.threadId,
      sentAt: new Date().toISOString(),
    });

    for (const property of sendableProperties) {
      await inquirySendRepo.create(property.property_id, result.id, {
        toAddress,
        source: "automation",
        gmailThreadId: result.threadId,
        batchId: batch.id,
        sendMode: distinctThreads.length === 1 ? "thread_reply" : "new_thread",
      });
      await actionRepo.resolve(property.property_id, "confirm_follow_up");
      await syncPropertySourcingWorkflow(property.property_id, { pool });
    }

    await eventRepo.emit("job.job.completed", {
      batchId: batch.id,
      toAddress,
      propertyIds: sendableProperties.map((property) => property.property_id),
      threadId: result.threadId,
    });
  }

  return { sent, reviewRequired, batchIds };
}
