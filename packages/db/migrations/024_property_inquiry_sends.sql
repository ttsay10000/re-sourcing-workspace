-- Outbound inquiry emails we sent (to avoid double-send and show "last sent" date).

CREATE TABLE property_inquiry_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  gmail_message_id TEXT
);

CREATE INDEX idx_property_inquiry_sends_property_id ON property_inquiry_sends(property_id);
CREATE INDEX idx_property_inquiry_sends_sent_at ON property_inquiry_sends(sent_at DESC);

COMMENT ON TABLE property_inquiry_sends IS 'Log of outbound inquiry emails sent per property; used for last-sent date and to prevent duplicate sends.';
