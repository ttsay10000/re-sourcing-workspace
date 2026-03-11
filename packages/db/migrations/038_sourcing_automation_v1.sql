-- Saved-search automation, outreach CRM, and sourcing action items (v1).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS property_types TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS schedule_cadence TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York',
  ADD COLUMN IF NOT EXISTS run_time_local TIME,
  ADD COLUMN IF NOT EXISTS weekly_run_day SMALLINT,
  ADD COLUMN IF NOT EXISTS monthly_run_day SMALLINT,
  ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outreach_rules JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE ingestion_runs
  ADD COLUMN IF NOT EXISTS trigger_source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_profiles_enabled_next_run_at
  ON profiles (enabled, next_run_at);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_trigger_source
  ON ingestion_runs (trigger_source);

CREATE TABLE IF NOT EXISTS broker_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  firm TEXT,
  preferred_thread_id TEXT,
  last_outreach_at TIMESTAMPTZ,
  last_reply_at TIMESTAMPTZ,
  do_not_contact_until TIMESTAMPTZ,
  manual_review_only BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  activity_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS property_sourcing_state (
  property_id UUID PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  workflow_state TEXT NOT NULL DEFAULT 'new',
  disposition TEXT NOT NULL DEFAULT 'active',
  hold_reason TEXT,
  hold_note TEXT,
  originating_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  originating_run_id UUID REFERENCES ingestion_runs(id) ON DELETE SET NULL,
  latest_run_id UUID REFERENCES ingestion_runs(id) ON DELETE SET NULL,
  outreach_reason TEXT,
  first_eligible_at TIMESTAMPTZ,
  last_contacted_at TIMESTAMPTZ,
  last_reply_at TIMESTAMPTZ,
  manual_om_review_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_sourcing_state_workflow
  ON property_sourcing_state (workflow_state);

CREATE INDEX IF NOT EXISTS idx_property_sourcing_state_disposition
  ON property_sourcing_state (disposition);

CREATE TABLE IF NOT EXISTS property_recipient_resolution (
  property_id UUID PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'missing',
  contact_id UUID REFERENCES broker_contacts(id) ON DELETE SET NULL,
  contact_email TEXT,
  confidence INTEGER,
  resolution_reason TEXT,
  candidate_contacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_recipient_resolution_status
  ON property_recipient_resolution (status);

CREATE TABLE IF NOT EXISTS outreach_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES broker_contacts(id) ON DELETE SET NULL,
  to_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_by TEXT NOT NULL DEFAULT 'automation',
  review_reason TEXT,
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  sent_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_batches_status
  ON outreach_batches (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_batches_to_address
  ON outreach_batches (to_address, created_at DESC);

CREATE TABLE IF NOT EXISTS outreach_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES outreach_batches(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_outreach_batch_items_property_id
  ON outreach_batch_items (property_id, created_at DESC);

CREATE TABLE IF NOT EXISTS property_outreach_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  flag_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  summary TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_outreach_flags_property_id
  ON property_outreach_flags (property_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_outreach_flags_unique_open
  ON property_outreach_flags (property_id, flag_type)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS property_action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'medium',
  summary TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_action_items_property_id
  ON property_action_items (property_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_action_items_unique_open
  ON property_action_items (property_id, action_type)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS inbox_sync_state (
  provider TEXT PRIMARY KEY,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE property_inquiry_sends
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES outreach_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT,
  ADD COLUMN IF NOT EXISTS send_mode TEXT;

ALTER TABLE property_inquiry_emails
  ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT,
  ADD COLUMN IF NOT EXISTS matched_batch_id UUID REFERENCES outreach_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'matched';

CREATE INDEX IF NOT EXISTS idx_property_inquiry_sends_batch_id
  ON property_inquiry_sends (batch_id);

CREATE INDEX IF NOT EXISTS idx_property_inquiry_emails_matched_batch_id
  ON property_inquiry_emails (matched_batch_id);

INSERT INTO broker_contacts (normalized_email, display_name, firm)
SELECT DISTINCT
  LOWER(TRIM(agent->>'email')) AS normalized_email,
  NULLIF(TRIM(agent->>'name'), '') AS display_name,
  NULLIF(TRIM(agent->>'firm'), '') AS firm
FROM listings l
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.agent_enrichment, '[]'::jsonb)) AS agent
WHERE jsonb_typeof(COALESCE(l.agent_enrichment, '[]'::jsonb)) = 'array'
  AND NULLIF(TRIM(agent->>'email'), '') IS NOT NULL
ON CONFLICT (normalized_email) DO UPDATE
SET
  display_name = COALESCE(EXCLUDED.display_name, broker_contacts.display_name),
  firm = COALESCE(EXCLUDED.firm, broker_contacts.firm),
  updated_at = now();

INSERT INTO property_sourcing_state (
  property_id,
  workflow_state,
  disposition,
  last_contacted_at,
  last_reply_at,
  manual_om_review_at
)
SELECT
  p.id,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM property_inquiry_documents d
      WHERE d.property_id = p.id
    ) OR EXISTS (
      SELECT 1
      FROM property_uploaded_documents u
      WHERE u.property_id = p.id
        AND u.category IN ('OM', 'Brochure')
    ) THEN 'om_received_manual_review'
    WHEN EXISTS (
      SELECT 1
      FROM property_inquiry_emails e
      WHERE e.property_id = p.id
    ) THEN 'reply_received'
    WHEN EXISTS (
      SELECT 1
      FROM property_inquiry_sends s
      WHERE s.property_id = p.id
    ) THEN 'sent_waiting_reply'
    ELSE 'new'
  END AS workflow_state,
  'active' AS disposition,
  (
    SELECT MAX(s.sent_at)
    FROM property_inquiry_sends s
    WHERE s.property_id = p.id
  ) AS last_contacted_at,
  (
    SELECT MAX(e.received_at)
    FROM property_inquiry_emails e
    WHERE e.property_id = p.id
  ) AS last_reply_at,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM property_inquiry_documents d
      WHERE d.property_id = p.id
    ) OR EXISTS (
      SELECT 1
      FROM property_uploaded_documents u
      WHERE u.property_id = p.id
        AND u.category IN ('OM', 'Brochure')
    ) THEN now()
    ELSE NULL
  END AS manual_om_review_at
FROM properties p
ON CONFLICT (property_id) DO NOTHING;

WITH property_candidate_contacts AS (
  SELECT
    m.property_id,
    LOWER(TRIM(agent->>'email')) AS normalized_email,
    NULLIF(TRIM(agent->>'name'), '') AS display_name,
    NULLIF(TRIM(agent->>'firm'), '') AS firm
  FROM listing_property_matches m
  JOIN listings l ON l.id = m.listing_id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.agent_enrichment, '[]'::jsonb)) AS agent
  WHERE jsonb_typeof(COALESCE(l.agent_enrichment, '[]'::jsonb)) = 'array'
    AND NULLIF(TRIM(agent->>'email'), '') IS NOT NULL
),
property_candidate_rollup AS (
  SELECT
    property_id,
    COUNT(*) AS candidate_count,
    MIN(normalized_email) AS single_email,
    jsonb_agg(
      jsonb_build_object(
        'email', normalized_email,
        'name', display_name,
        'firm', firm
      )
      ORDER BY normalized_email
    ) AS candidate_contacts
  FROM property_candidate_contacts
  GROUP BY property_id
)
INSERT INTO property_recipient_resolution (
  property_id,
  status,
  contact_id,
  contact_email,
  confidence,
  resolution_reason,
  candidate_contacts
)
SELECT
  p.id,
  CASE
    WHEN rollup.candidate_count = 1 THEN 'resolved'
    WHEN rollup.candidate_count > 1 THEN 'multiple_candidates'
    ELSE 'missing'
  END AS status,
  CASE
    WHEN rollup.candidate_count = 1 THEN bc.id
    ELSE NULL
  END AS contact_id,
  CASE
    WHEN rollup.candidate_count = 1 THEN rollup.single_email
    ELSE NULL
  END AS contact_email,
  CASE
    WHEN rollup.candidate_count = 1 THEN 100
    WHEN rollup.candidate_count > 1 THEN 55
    ELSE 0
  END AS confidence,
  CASE
    WHEN rollup.candidate_count = 1 THEN 'Single broker email from listing enrichment'
    WHEN rollup.candidate_count > 1 THEN 'Multiple broker emails from listing enrichment'
    ELSE 'No broker email found in listing enrichment'
  END AS resolution_reason,
  COALESCE(rollup.candidate_contacts, '[]'::jsonb) AS candidate_contacts
FROM properties p
LEFT JOIN property_candidate_rollup rollup ON rollup.property_id = p.id
LEFT JOIN broker_contacts bc ON bc.normalized_email = rollup.single_email
ON CONFLICT (property_id) DO NOTHING;

INSERT INTO property_outreach_flags (property_id, flag_type, summary)
SELECT
  resolution.property_id,
  CASE
    WHEN resolution.status = 'missing' THEN 'missing_broker_email'
    ELSE 'manual_reconcile_needed'
  END AS flag_type,
  CASE
    WHEN resolution.status = 'missing' THEN 'Property needs a broker email before OM outreach can run'
    ELSE 'Property has multiple broker candidates and needs manual recipient review'
  END AS summary
FROM property_recipient_resolution resolution
WHERE resolution.status IN ('missing', 'multiple_candidates')
ON CONFLICT DO NOTHING;

INSERT INTO property_action_items (property_id, action_type, priority, summary)
SELECT
  resolution.property_id,
  CASE
    WHEN resolution.status = 'missing' THEN 'add_broker_email'
    ELSE 'choose_recipient'
  END AS action_type,
  'high' AS priority,
  CASE
    WHEN resolution.status = 'missing' THEN 'Add broker email before OM outreach'
    ELSE 'Choose the correct broker recipient before OM outreach'
  END AS summary
FROM property_recipient_resolution resolution
WHERE resolution.status IN ('missing', 'multiple_candidates')
ON CONFLICT DO NOTHING;

INSERT INTO property_outreach_flags (property_id, flag_type, summary)
SELECT
  state.property_id,
  'reply_without_om',
  'Broker replied but OM requires manual review or upload'
FROM property_sourcing_state state
WHERE state.workflow_state = 'reply_received'
ON CONFLICT DO NOTHING;

INSERT INTO property_action_items (property_id, action_type, priority, summary)
SELECT
  state.property_id,
  'upload_om_manually',
  'high',
  'Review broker reply and upload OM manually if available'
FROM property_sourcing_state state
WHERE state.workflow_state = 'reply_received'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE broker_contacts IS 'Normalized broker/contact directory used by automated outreach.';
COMMENT ON TABLE property_sourcing_state IS 'Per-property sourcing and outreach workflow state, disposition, and provenance.';
COMMENT ON TABLE property_recipient_resolution IS 'Chosen broker recipient or unresolved broker candidates for each property.';
COMMENT ON TABLE outreach_batches IS 'Bundled outreach emails, usually one per recipient per daily run.';
COMMENT ON TABLE outreach_batch_items IS 'Properties included in a single outreach batch.';
COMMENT ON TABLE property_outreach_flags IS 'System-generated sourcing flags that may block automation.';
COMMENT ON TABLE property_action_items IS 'Operator-facing next steps derived from sourcing state and flags.';
COMMENT ON TABLE inbox_sync_state IS 'Cursor table for inbox synchronization windows.';
