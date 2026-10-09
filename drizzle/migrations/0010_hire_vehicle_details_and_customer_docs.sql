ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS hire_chauffeur_daily_rate numeric,
  ADD COLUMN IF NOT EXISTS hire_cancellation_policy text NOT NULL DEFAULT 'moderate',
  ADD COLUMN IF NOT EXISTS hire_insurance_type text,
  ADD COLUMN IF NOT EXISTS hire_insurance_details text,
  ADD COLUMN IF NOT EXISTS hire_minimum_age integer;

CREATE TABLE IF NOT EXISTS public.hire_customer_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL,
  document_kind text NOT NULL CHECK (document_kind IN ('id','license')),
  file_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requester_id, document_kind)
);
GRANT SELECT ON public.hire_customer_documents TO authenticated;
GRANT ALL ON public.hire_customer_documents TO service_role;
ALTER TABLE public.hire_customer_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own hire documents" ON public.hire_customer_documents
  FOR SELECT TO authenticated USING (requester_id = auth.uid() OR public.is_staff(auth.uid()));