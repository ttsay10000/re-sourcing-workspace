-- Batch-aware inquiry email associations so one inbound reply can link to multiple properties.

CREATE TABLE IF NOT EXISTS property_inquiry_email_properties (
  inquiry_email_id UUID NOT NULL REFERENCES property_inquiry_emails(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  match_source TEXT NOT NULL DEFAULT 'legacy_property',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (inquiry_email_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_property_inquiry_email_properties_property_id
  ON property_inquiry_email_properties (property_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_inquiry_email_properties_match_source
  ON property_inquiry_email_properties (match_source);

INSERT INTO property_inquiry_email_properties (inquiry_email_id, property_id, match_source)
SELECT id, property_id, 'legacy_property'
FROM property_inquiry_emails
ON CONFLICT (inquiry_email_id, property_id) DO NOTHING;

COMMENT ON TABLE property_inquiry_email_properties IS 'Links inbound inquiry emails to one or many properties for batch-thread replies.';
COMMENT ON COLUMN property_inquiry_email_properties.match_source IS 'How the property link was inferred (subject_address, broker_email, batch_thread, legacy_property, etc.).';
