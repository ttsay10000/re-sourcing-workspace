-- Persist inquiry attachments and generated documents in Postgres so hosted deployments
-- can still serve files after app restarts or ephemeral-disk wipes.

ALTER TABLE property_inquiry_documents ADD COLUMN IF NOT EXISTS file_content BYTEA;
COMMENT ON COLUMN property_inquiry_documents.file_content IS 'Optional: file bytes for serving on hosted deployments where disk does not persist. When set, download uses this instead of file_path.';

ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_content BYTEA;
COMMENT ON COLUMN documents.file_content IS 'Optional: file bytes for serving on hosted deployments where disk does not persist. When set, download uses this instead of storage_path.';
