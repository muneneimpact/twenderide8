-- Default new hire listings to both customer-driven and chauffeured use, with a
-- first-day payment requirement. Existing owner-selected values are preserved.
ALTER TABLE public.vehicles
  ALTER COLUMN hire_mode SET DEFAULT 'both',
  ALTER COLUMN hire_payment_policy SET DEFAULT 'daily_flexible';

-- Keep each hirer's latest private identity/licence file independent of any
-- individual booking, so it can be safely reused for future requests.
CREATE TABLE IF NOT EXISTS public.hire_customer_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_kind text NOT NULL CHECK (document_kind IN ('id', 'license')),
  file_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hire_customer_documents_requester_kind_key UNIQUE (requester_id, document_kind)
);

CREATE INDEX IF NOT EXISTS hire_customer_documents_requester_idx
  ON public.hire_customer_documents (requester_id);

ALTER TABLE public.hire_customer_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hire_customer_documents FROM anon, authenticated;
GRANT ALL ON TABLE public.hire_customer_documents TO service_role;
