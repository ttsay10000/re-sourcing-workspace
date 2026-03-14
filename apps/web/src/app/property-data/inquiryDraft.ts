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

Would you be able to share the OM, current rent roll, expenses, and/or any available financials?

Thanks in advance - looking forward to taking a look.

Best,
Tyler Tsay
617 306 3336
tyler@stayhaus.co`,
  };
}
