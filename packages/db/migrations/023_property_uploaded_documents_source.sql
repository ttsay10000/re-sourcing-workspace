ALTER TABLE property_uploaded_documents ADD COLUMN IF NOT EXISTS source TEXT;
COMMENT ON COLUMN property_uploaded_documents.source IS 'Optional source of the document (e.g. Broker, Listing agent, Email from X).';
