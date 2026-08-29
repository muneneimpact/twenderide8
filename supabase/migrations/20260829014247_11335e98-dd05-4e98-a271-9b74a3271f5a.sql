UPDATE public.profiles p
SET phone = NULL
WHERE p.phone IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.profiles q
    WHERE q.phone = p.phone AND q.created_at < p.created_at
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_unique
  ON public.profiles (phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.phone_login_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.phone_login_otps TO service_role;
ALTER TABLE public.phone_login_otps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super admin audits phone logins"
  ON public.phone_login_otps FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_phone_login_otps_phone
  ON public.phone_login_otps (phone, created_at DESC);