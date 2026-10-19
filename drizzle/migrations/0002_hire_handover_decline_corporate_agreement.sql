ALTER TABLE public.hire_quotes
  ADD COLUMN IF NOT EXISTS handed_over_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_decline_reason text,
  ADD COLUMN IF NOT EXISTS pay_later_method text,
  ADD COLUMN IF NOT EXISTS pay_later_due_date date,
  ADD COLUMN IF NOT EXISTS business_email text,
  ADD COLUMN IF NOT EXISTS business_email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS business_registration_number text,
  ADD COLUMN IF NOT EXISTS business_address text,
  ADD COLUMN IF NOT EXISTS agreement_signer_name text,
  ADD COLUMN IF NOT EXISTS agreement_signature text,
  ADD COLUMN IF NOT EXISTS agreement_signed_at timestamptz;

CREATE TABLE public.business_email_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text NOT NULL,
  code_hash text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.business_email_otps TO service_role;
ALTER TABLE public.business_email_otps ENABLE ROW LEVEL SECURITY;