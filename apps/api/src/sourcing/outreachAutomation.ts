import { EventRepo, InquirySendRepo, OutreachBatchRepo, PropertyActionItemRepo, PropertySourcingStateRepo, getPool } from "@re-sourcing/db";
import { sendMessage } from "../inquiry/gmailClient.js";
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

function buildSubject(addresses: string[]): string {
  if (addresses.length === 1) return `OM Request - ${addresses[0]}`;
  if (addresses.length === 2) return `OM Request - ${addresses[0]} and ${addresses[1]}`;
  return `OM Request - ${addresses.length} properties`;
}

function buildBody(contactName: string | null, addresses: string[]): string {
  const greeting = contactName ? `Hi ${contactName.split(/\s+/)[0]},` : "Hi,";
  const intro =
    addresses.length === 1
      ? "Could you please send over the OM and any supporting materials for the property below?"
      : "Could you please send over the OMs and any supporting materials for the properties below?";
  const list = addresses.map((address) => `- ${address}`).join("\n");
  return `${greeting}

${intro}

${list}

If there is a better contact for any of these, please feel free to point me in the right direction.

Thank you.`;
}

export async function runDailyOutreach(): Promise<{ sent: number; reviewRequired: number; batchIds: string[] }> {
  const pool = getPool();
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

  for (const [toAddress, properties] of grouped) {
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
          : hasSentWithinOneDay
            ? "Recipient already received automated outreach within the past 24 hours"
          : hasRecentHistory && hasUnthreadedRecentSend
            ? "Recent outreach exists for this recipient, but no Gmail thread is recorded"
          : distinctThreads.length > 1
            ? "Multiple recent outreach threads exist for this recipient"
            : null;

    const batch = await batchRepo.create({
      contactId: properties[0]?.contact_id ?? null,
      toAddress,
      status: reviewReason ? "review_required" : "queued",
      createdBy: "automation",
      reviewReason,
      metadata: {
        propertyIds: properties.map((property) => property.property_id),
        suggestedThreadId: reviewReason ? null : (distinctThreads[0] ?? properties[0]?.preferred_thread_id ?? null),
      },
      propertyIds: properties.map((property) => property.property_id),
    });
    batchIds.push(batch.id);

    if (reviewReason) {
      reviewRequired++;
      for (const property of properties) {
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
        propertyIds: properties.map((property) => property.property_id),
      });
      continue;
    }

    const subject = buildSubject(properties.map((property) => property.canonical_address));
    const body = buildBody(properties[0]?.contact_name ?? null, properties.map((property) => property.canonical_address));
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

    for (const property of properties) {
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
      propertyIds: properties.map((property) => property.property_id),
      threadId: result.threadId,
    });
  }

  return { sent, reviewRequired, batchIds };
}
