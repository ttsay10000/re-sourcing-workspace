-- Global reusable email templates for UI v2 broker outreach.

CREATE TABLE IF NOT EXISTS outreach_email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'ui-v2',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_email_templates_lower_name
  ON outreach_email_templates (lower(name));

INSERT INTO outreach_email_templates (name, subject, body, created_by)
VALUES (
  'OM request',
  'Inquiry about {{address}}',
  'Hi {{broker_first_name}},

My name is Tyler Tsay, and I''m reaching out on behalf of a client regarding the property at {{address}}. We are evaluating the building and would appreciate the opportunity to review further.

Would you be able to share the OM, T-12/operating statement, current rent roll, and expense detail? If available, we would also appreciate any broker comp package or market analysis, sale/rent comps, NOI/cap-rate support, and whisper pricing color.

Thanks in advance - looking forward to taking a look.

Best,
Tyler Tsay
617 306 3336
tyler@stayhaus.co',
  'seed'
)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE outreach_email_templates IS 'Global reusable templates available from UI v2 broker outreach composers.';
