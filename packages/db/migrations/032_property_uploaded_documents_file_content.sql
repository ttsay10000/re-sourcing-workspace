-- Store file content in DB so downloads work on ephemeral disks (e.g. Render).
-- When file_content IS NOT NULL, serve from DB; otherwise fall back to file_path on disk.

ALTER TABLE property_uploaded_documents ADD COLUMN IF NOT EXISTS file_content BYTEA;
COMMENT ON COLUMN property_uploaded_documents.file_content IS 'Optional: file bytes for serving on hosted deployments where disk does not persist. When set, download uses this instead of file_path.';
