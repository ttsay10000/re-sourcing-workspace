-- Generated property documents (dossier, Excel). Broker and user docs stay in property_inquiry_documents and property_uploaded_documents.
-- This table holds only generated_dossier and generated_excel; unified list in UI unions inquiry + uploaded + this table.

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT,
  source TEXT NOT NULL,
  uploaded_by UUID,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_property_id ON documents(property_id);
CREATE INDEX idx_documents_source ON documents(property_id, source);

COMMENT ON TABLE documents IS 'Generated property documents (deal dossier, Excel pro forma). Source: generated_dossier, generated_excel. Broker and user docs remain in property_inquiry_documents and property_uploaded_documents.';
