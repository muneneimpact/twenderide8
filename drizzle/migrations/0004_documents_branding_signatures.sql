CREATE TABLE IF NOT EXISTS public.document_branding (
  key text PRIMARY KEY DEFAULT 'default',
  company_name text NOT NULL DEFAULT 'Twende Rides',
  tagline text DEFAULT 'Meru, Kenya',
  address text DEFAULT 'Meru Town, Kenya',
  phone text,
  email text DEFAULT 'ride@twendemeru.co.ke',
  kra_pin text,
  website text DEFAULT 'twenderides.lovable.app',
  logo_data_url text,
  extra_logos jsonb NOT NULL DEFAULT '[]'::jsonb,
  accent_color text NOT NULL DEFAULT '#0F766E',
  receipt_footer text DEFAULT 'Thank you for riding with Twende.',
  agreement_footer text DEFAULT 'This agreement is binding under the laws of Kenya.',
  agreement_extra_terms text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.document_branding TO authenticated;
GRANT ALL ON public.document_branding TO service_role;
ALTER TABLE public.document_branding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signed in read branding" ON public.document_branding FOR SELECT TO authenticated USING (true);
INSERT INTO public.document_branding (key) VALUES ('default') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.owner_signatures (
  user_id uuid PRIMARY KEY,
  signer_name text NOT NULL,
  signature text NOT NULL,
  auto_sign boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_signatures TO authenticated;
GRANT ALL ON public.owner_signatures TO service_role;
ALTER TABLE public.owner_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own signature" ON public.owner_signatures FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.hire_quotes
  ADD COLUMN IF NOT EXISTS owner_signer_name text,
  ADD COLUMN IF NOT EXISTS owner_signature text,
  ADD COLUMN IF NOT EXISTS owner_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_signed_by uuid,
  ADD COLUMN IF NOT EXISTS agreement_completed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.agreement_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hire_quote_id uuid NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_agent text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agreement_logs_quote_idx ON public.agreement_logs (hire_quote_id, created_at);
GRANT ALL ON public.agreement_logs TO service_role;
ALTER TABLE public.agreement_logs ENABLE ROW LEVEL SECURITY;