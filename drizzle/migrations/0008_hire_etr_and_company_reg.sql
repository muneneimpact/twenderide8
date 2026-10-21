ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company_registration_number text;
CREATE TABLE public.hire_etr_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hire_quote_id uuid NOT NULL UNIQUE,
  requester_id uuid NOT NULL,
  company_name text NOT NULL,
  kra_pin text NOT NULL,
  billing_email text,
  status text NOT NULL DEFAULT 'requested',
  file_path text,
  uploaded_at timestamptz,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.hire_etr_requests TO authenticated;
GRANT ALL ON public.hire_etr_requests TO service_role;
ALTER TABLE public.hire_etr_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or staff read hire etr" ON public.hire_etr_requests FOR SELECT TO authenticated
USING (requester_id = auth.uid() OR public.is_staff(auth.uid()));