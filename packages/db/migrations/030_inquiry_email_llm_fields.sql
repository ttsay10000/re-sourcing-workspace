-- LLM-extracted fields for inquiry email body: summary, latest receipt date from broker, attachment list.

ALTER TABLE property_inquiry_emails
  ADD COLUMN IF NOT EXISTS body_summary TEXT,
  ADD COLUMN IF NOT EXISTS receipt_date_from_broker TEXT,
  ADD COLUMN IF NOT EXISTS attachments_list TEXT;

COMMENT ON COLUMN property_inquiry_emails.body_summary IS 'LLM summary of email body.';
COMMENT ON COLUMN property_inquiry_emails.receipt_date_from_broker IS 'Latest receipt date mentioned from broker/team (LLM-extracted).';
COMMENT ON COLUMN property_inquiry_emails.attachments_list IS 'List of attachment filenames or "none"; LLM or derived.';
