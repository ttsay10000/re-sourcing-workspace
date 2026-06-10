/**
 * Draft templates and broker-email grouping for manual inquiry sends. Pure
 * functions shared by the bulk preview/send routes and their tests.
 */
import { buildOutreachBody, buildSubject as buildOutreachSubject } from "../sourcing/outreachAutomation.js";

export function buildInquiryDraft(input: {
  canonicalAddress: string;
  recipientName?: string | null;
  to?: string | null;
}): { to: string; subject: string; body: string } {
  const addressLine = input.canonicalAddress.split(",")[0]?.trim() || input.canonicalAddress;
  const firstName = input.recipientName?.trim() ? input.recipientName.trim().split(/\s+/)[0] ?? null : null;
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  return {
    to: input.to?.trim() ?? "",
    subject: `Inquiry about ${addressLine}`,
    body: `${greeting}

My name is Tyler Tsay, and I'm reaching out on behalf of a client regarding the property at ${addressLine} currently on the market. We are evaluating the building and would appreciate the opportunity to review further.

Would you be able to share the OM, T-12/operating statement, current rent roll, and expense detail? If available, we would also appreciate any broker comp package or market analysis, sale/rent comps, NOI/cap-rate support, and whisper pricing color.

Thanks in advance - looking forward to taking a look.

Best,
Tyler Tsay
617 306 3336
tyler@stayhaus.co`,
  };
}

export interface BulkInquiryPreviewBatch {
  toAddress: string;
  contactName: string | null;
  propertyIds: string[];
  addresses: string[];
  subject: string;
  body: string;
}

/**
 * Group sendable recipients by normalized broker email and build one draft per
 * broker. Single-property batches keep the classic inquiry template; multi-
 * property batches use the bulleted OM-request template the automation path
 * already sends.
 */
export function groupInquiryRecipients(
  rows: Array<{ propertyId: string; canonicalAddress: string; email: string; name: string | null }>
): BulkInquiryPreviewBatch[] {
  const grouped = new Map<
    string,
    { contactName: string | null; items: Array<{ propertyId: string; canonicalAddress: string }> }
  >();
  for (const row of rows) {
    const key = row.email.trim().toLowerCase();
    if (!key) continue;
    const existing = grouped.get(key);
    if (existing) {
      existing.items.push({ propertyId: row.propertyId, canonicalAddress: row.canonicalAddress });
      if (!existing.contactName && row.name) existing.contactName = row.name;
    } else {
      grouped.set(key, {
        contactName: row.name,
        items: [{ propertyId: row.propertyId, canonicalAddress: row.canonicalAddress }],
      });
    }
  }
  const batches: BulkInquiryPreviewBatch[] = [];
  for (const [toAddress, group] of grouped) {
    const addresses = group.items.map((item) => item.canonicalAddress);
    if (group.items.length === 1) {
      const draft = buildInquiryDraft({
        canonicalAddress: addresses[0]!,
        recipientName: group.contactName,
        to: toAddress,
      });
      batches.push({
        toAddress,
        contactName: group.contactName,
        propertyIds: group.items.map((item) => item.propertyId),
        addresses,
        subject: draft.subject,
        body: draft.body,
      });
    } else {
      batches.push({
        toAddress,
        contactName: group.contactName,
        propertyIds: group.items.map((item) => item.propertyId),
        addresses,
        subject: buildOutreachSubject(addresses),
        body: buildOutreachBody(group.contactName, addresses),
      });
    }
  }
  return batches;
}
