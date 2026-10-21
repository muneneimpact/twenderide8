CREATE TABLE public.business_kyc_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id UUID,
  action TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.business_kyc_edits TO authenticated;
GRANT ALL ON public.business_kyc_edits TO service_role;
ALTER TABLE public.business_kyc_edits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view company kyc edits" ON public.business_kyc_edits FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE INDEX business_kyc_edits_user_idx ON public.business_kyc_edits (user_id, created_at DESC);