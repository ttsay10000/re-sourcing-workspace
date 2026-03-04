-- Inquiry emails linked to properties (replies to OM/rent roll requests). Idempotent by message_id.

CREATE TABLE property_inquiry_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  subject TEXT,
  from_address TEXT,
  received_at TIMESTAMPTZ,
  body_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(message_id)
);

CREATE INDEX idx_property_inquiry_emails_property_id ON property_inquiry_emails(property_id);
CREATE INDEX idx_property_inquiry_emails_message_id ON property_inquiry_emails(message_id);
CREATE INDEX idx_property_inquiry_emails_received_at ON property_inquiry_emails(received_at);

COMMENT ON TABLE property_inquiry_emails IS 'Inbox replies matched to properties by subject address; idempotent by message_id.';
