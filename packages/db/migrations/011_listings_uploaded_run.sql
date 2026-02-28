-- When a listing was first sent to property data from a test run (for display and audit).

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS uploaded_run_id TEXT;

COMMENT ON COLUMN listings.uploaded_at IS 'When this listing was first sent to property data from a run (Send to property data).';
COMMENT ON COLUMN listings.uploaded_run_id IS 'Test run ID that first sent this listing to property data.';
