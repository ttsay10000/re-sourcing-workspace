ALTER TABLE property_inquiry_sends
  ADD COLUMN IF NOT EXISTS to_address TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT;

COMMENT ON COLUMN property_inquiry_sends.to_address IS 'Normalized recipient email for the inquiry send; used for duplicate-send guardrails across properties.';
COMMENT ON COLUMN property_inquiry_sends.source IS 'Origin of the inquiry send record (e.g. gmail_api, manual).';

CREATE INDEX IF NOT EXISTS idx_property_inquiry_sends_to_address
  ON property_inquiry_sends (to_address)
  WHERE to_address IS NOT NULL;
