-- Attachments from inquiry emails; file stored on disk, path in file_path.

CREATE TABLE property_inquiry_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  inquiry_email_id UUID NOT NULL REFERENCES property_inquiry_emails(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT,
  file_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_property_inquiry_documents_property_id ON property_inquiry_documents(property_id);
CREATE INDEX idx_property_inquiry_documents_inquiry_email_id ON property_inquiry_documents(inquiry_email_id);

COMMENT ON TABLE property_inquiry_documents IS 'Attachment files from inquiry emails; file_path is relative or absolute path on disk.';
