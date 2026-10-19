CREATE TABLE public.driver_agreement_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agreement_version text NOT NULL,
  signer_name text,
  user_agent text,
  ip text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, agreement_version)
);
GRANT SELECT ON public.driver_agreement_acceptances TO authenticated;
GRANT ALL ON public.driver_agreement_acceptances TO service_role;
ALTER TABLE public.driver_agreement_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own driver agreement acceptance" ON public.driver_agreement_acceptances
FOR SELECT TO authenticated USING (auth.uid() = user_id);