ALTER TABLE property_uploaded_documents
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_metadata JSONB;

COMMENT ON COLUMN property_uploaded_documents.source_url IS 'Original external URL when a document is imported from a listing/source link.';
COMMENT ON COLUMN property_uploaded_documents.source_metadata IS 'Source-specific metadata for imported/uploaded property documents.';

