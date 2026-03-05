-- User-uploaded documents per property (OM, Brochure, Rent Roll, etc.).

CREATE TABLE property_uploaded_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT,
  file_path TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_property_uploaded_documents_property_id ON property_uploaded_documents(property_id);
CREATE INDEX idx_property_uploaded_documents_category ON property_uploaded_documents(property_id, category);

COMMENT ON TABLE property_uploaded_documents IS 'User-uploaded documents per property; category: OM, Brochure, Rent Roll, Financial Model, T12, Other.';
COMMENT ON COLUMN property_uploaded_documents.category IS 'One of: OM, Brochure, Rent Roll, Financial Model, T12 / Operating Summary, Other';
