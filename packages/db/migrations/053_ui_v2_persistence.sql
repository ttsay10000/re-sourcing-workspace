-- UI v2 persistence for property timeline, rejection history, and broker overrides.

ALTER TABLE broker_contacts
  ALTER COLUMN normalized_email DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source_key TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'sourced',
  ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS manual_overwritten_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_overwritten_by TEXT;

UPDATE broker_contacts
SET source_key = 'email:' || normalized_email
WHERE source_key IS NULL
  AND normalized_email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_contacts_source_key
  ON broker_contacts (source_key)
  WHERE source_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_broker_contacts_display_name
  ON broker_contacts (lower(display_name));

CREATE INDEX IF NOT EXISTS idx_broker_contacts_firm
  ON broker_contacts (lower(firm));

ALTER TABLE property_recipient_resolution
  ADD COLUMN IF NOT EXISTS manual_broker_name TEXT,
  ADD COLUMN IF NOT EXISTS manual_broker_email TEXT,
  ADD COLUMN IF NOT EXISTS manual_broker_phone TEXT,
  ADD COLUMN IF NOT EXISTS manual_broker_firm TEXT,
  ADD COLUMN IF NOT EXISTS manual_broker_notes TEXT,
  ADD COLUMN IF NOT EXISTS manual_overwrite_source TEXT,
  ADD COLUMN IF NOT EXISTS manual_overwritten_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_overwritten_by TEXT,
  ADD COLUMN IF NOT EXISTS manual_overwrite_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source_broker_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_property_recipient_resolution_manual_email
  ON property_recipient_resolution (lower(manual_broker_email))
  WHERE manual_broker_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS property_pipeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor TEXT,
  source TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL,
  body TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_pipeline_events_property_id_created_at
  ON property_pipeline_events (property_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_pipeline_events_event_type_created_at
  ON property_pipeline_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_pipeline_events_metadata
  ON property_pipeline_events USING GIN (metadata);

CREATE TABLE IF NOT EXISTS property_rejections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  reason_code TEXT NOT NULL,
  reason_label TEXT,
  note TEXT,
  actor TEXT,
  source TEXT NOT NULL DEFAULT 'user',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  rejected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  restored_at TIMESTAMPTZ,
  restored_by TEXT,
  restored_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_rejections_property_id_rejected_at
  ON property_rejections (property_id, rejected_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_rejections_reason_code
  ON property_rejections (reason_code);

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_rejections_one_active
  ON property_rejections (property_id)
  WHERE restored_at IS NULL;

COMMENT ON COLUMN broker_contacts.phone IS 'Best known broker phone number for CRM display and outreach.';
COMMENT ON COLUMN broker_contacts.source_key IS 'Stable non-email identity for first-class CRM contacts when a broker email has not been found yet.';
COMMENT ON COLUMN broker_contacts.source IS 'Source of the current contact record: sourced, llm, manual, overwrite, import, or similar.';
COMMENT ON COLUMN property_recipient_resolution.source_broker_snapshot IS 'Snapshot of sourced broker data before a manual broker overwrite.';
COMMENT ON TABLE property_pipeline_events IS 'Durable property-level activity timeline for UI v2 pipeline, CRM, import, save, broker, and rejection actions.';
COMMENT ON TABLE property_rejections IS 'Durable rejection matrix/history with at most one active rejection per property.';
